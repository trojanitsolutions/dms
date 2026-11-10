import io
import os
import shutil
import tempfile
import zipfile
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from dms.setup import item_images
from dms.setup.item_image_names import is_image_entry, parse_image_name
from dms.tests.test_item_images import _make_item

OLD_URL = "https://example.com/old.png"


def _jpeg(color):
	from PIL import Image

	buf = io.BytesIO()
	Image.new("RGB", (4, 4), color).save(buf, "JPEG")
	return buf.getvalue()


class TestItemImageNames(IntegrationTestCase):
	def test_parse_real_names(self):
		cases = {
			"photos/LXS-034-IMG1.jpg": ("LXS-034", 1),
			"photos/LXR-060-IMG3.png": ("LXR-060", 3),
			"photos/AS-207MIX-img1.jpg": ("AS-207MIX", 1),
			"photos/LXR-004-img.jpg": ("LXR-004", 1),
			"photos/LXQ-215-IMG-1.jpg": ("LXQ-215", 1),
			"photos/LXS-SKPD-A3-IMG1..JPG": ("LXS-SKPD-A3", 1),
			"photos/LXS-164-img1jpg.jpg": ("LXS-164", 1),
			"photos/LXR-010-img1.pg.jpg": ("LXR-010", 1),
			"photos/LXQ-333.IMG1.jpg": ("LXQ-333", 1),
			"photos/LXQ-173=IMG5.png": ("LXQ-173", 5),
			"photos/LXS-001-IMG12.jpg": ("LXS-001", 12),
			"photos/BLA4P80SQ10*10PC.jpg": ("BLA4P80SQ10*10PC", 1),
			"photos/lxf-148-12.JPG": ("lxf-148-12", 1),
		}
		for path, expected in cases.items():
			self.assertEqual(parse_image_name(path), expected, path)

	def test_junk_entries_skipped(self):
		self.assertTrue(is_image_entry("photos/LXS-185-IMG1.heic"))
		for path in ("photos/", "__MACOSX/photos/._A-IMG1.jpg", "photos/._A-IMG1.jpg", "photos/.DS_Store"):
			self.assertFalse(is_image_entry(path), path)


class TestItemBundleImages(IntegrationTestCase):
	def setUp(self):
		self.tmp = tempfile.mkdtemp()
		self.addCleanup(shutil.rmtree, self.tmp)
		log_dir = os.path.join(self.tmp, "logs")
		os.makedirs(log_dir)
		patcher = patch.object(item_images, "_log_dir", return_value=log_dir)
		patcher.start()
		self.addCleanup(patcher.stop)
		self.addCleanup(self._delete_bundle_files)
		_make_item("_T-BND-A", image=OLD_URL)
		_make_item("_T-BND-B")

	def _delete_bundle_files(self):
		for name in frappe.get_all("File", {"file_name": ["like", f"{item_images.FILE_PREFIX}%"]}, pluck="name"):
			frappe.delete_doc("File", name, force=True, ignore_permissions=True)

	def _zip(self, files):
		path = os.path.join(self.tmp, "bundle.zip")
		with zipfile.ZipFile(path, "w") as zf:
			for name, data in files.items():
				zf.writestr(name, data)
		return path

	def _bundle_files(self, item):
		return frappe.get_all(
			"File",
			{"attached_to_name": item, "file_name": ["like", f"{item_images.FILE_PREFIX}%"]},
			pluck="file_url",
		)

	def test_sync_sets_main_image_and_attaches_rest(self):
		path = self._zip(
			{
				"_T-BND-A-img1.jpg": _jpeg("red"),
				"_T-BND-A-img2.jpg": _jpeg("blue"),
				"_t-bnd-b-img1.jpg": _jpeg("green"),  # code case differs from the Item
				"_T-NO-SUCH-img1.jpg": _jpeg("white"),
			}
		)
		log = item_images.sync_item_images(path)

		image_a = frappe.db.get_value("Item", "_T-BND-A", "image")
		self.assertTrue(image_a.startswith(f"/files/{item_images.FILE_PREFIX}_T-BND-A-img1-"), image_a)
		self.assertEqual(len(self._bundle_files("_T-BND-A")), 2)
		self.assertTrue(frappe.db.get_value("Item", "_T-BND-B", "image"))
		self.assertEqual(log["missing"], ["_T-NO-SUCH"])
		self.assertEqual(log["failed"], [])

	def test_rerun_with_same_zip_changes_nothing(self):
		path = self._zip({"_T-BND-A-img1.jpg": _jpeg("red"), "_T-BND-A-img2.jpg": _jpeg("blue")})
		item_images.sync_item_images(path)
		log = item_images.sync_item_images(path)
		self.assertEqual(log["changes"], [])
		self.assertEqual(len(self._bundle_files("_T-BND-A")), 2)

	def test_changed_image_replaces_main_image(self):
		item_images.sync_item_images(self._zip({"_T-BND-A-img1.jpg": _jpeg("red")}))
		first = frappe.db.get_value("Item", "_T-BND-A", "image")
		item_images.sync_item_images(self._zip({"_T-BND-A-img1.jpg": _jpeg("black")}))
		second = frappe.db.get_value("Item", "_T-BND-A", "image")
		self.assertNotEqual(first, second)

	def test_unchanged_image_keeps_manual_edit(self):
		path = self._zip({"_T-BND-A-img1.jpg": _jpeg("red")})
		item_images.sync_item_images(path)
		frappe.db.set_value("Item", "_T-BND-A", "image", "https://example.com/manual.png")
		item_images.sync_item_images(path)
		self.assertEqual(frappe.db.get_value("Item", "_T-BND-A", "image"), "https://example.com/manual.png")

	def test_rollback_restores_old_image_and_deletes_files(self):
		log = item_images.sync_item_images(
			self._zip({"_T-BND-A-img1.jpg": _jpeg("red"), "_T-BND-A-img2.jpg": _jpeg("blue")})
		)
		result = item_images.rollback(log["run_id"])

		self.assertEqual(result["restored"], 1)
		self.assertEqual(frappe.db.get_value("Item", "_T-BND-A", "image"), OLD_URL)
		self.assertEqual(self._bundle_files("_T-BND-A"), [])
		self.assertTrue(item_images.rollback(log["run_id"])["already_rolled_back"])

	def test_rollback_keeps_image_changed_after_sync(self):
		log = item_images.sync_item_images(self._zip({"_T-BND-A-img1.jpg": _jpeg("red")}))
		frappe.db.set_value("Item", "_T-BND-A", "image", "https://example.com/manual.png")
		result = item_images.rollback(log["run_id"])
		self.assertEqual(result["kept"], ["_T-BND-A"])
		self.assertEqual(frappe.db.get_value("Item", "_T-BND-A", "image"), "https://example.com/manual.png")

	def test_rollback_defaults_to_latest_run(self):
		item_images.sync_item_images(self._zip({"_T-BND-A-img1.jpg": _jpeg("red")}))
		second = item_images.sync_item_images(self._zip({"_T-BND-B-img1.jpg": _jpeg("red")}))
		self.assertEqual(item_images.rollback()["run_id"], second["run_id"])
