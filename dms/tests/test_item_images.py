from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from dms.api import item_image_cache
from dms.api.sales import _drive_file_id, _resolve_item_images

REAL_ENQUEUE = item_image_cache.enqueue_drive_cache
DRIVE_ID = "1AbC-dEf_123"
DRIVE_URL = f"https://drive.google.com/file/d/{DRIVE_ID}/view?usp=sharing"


def _make_item(code, image=None):
	if frappe.db.exists("Item", code):
		frappe.delete_doc("Item", code, force=True)
	return frappe.get_doc(
		{
			"doctype": "Item",
			"item_code": code,
			"item_name": code,
			"item_group": "All Item Groups",
			"stock_uom": "Nos",
			"is_stock_item": 0,
			"image": image,
		}
	).insert(ignore_permissions=True)


def _attach(code, url, creation=None):
	f = frappe.get_doc(
		{"doctype": "File", "file_url": url, "attached_to_doctype": "Item", "attached_to_name": code}
	).insert(ignore_permissions=True)
	if creation:
		frappe.db.set_value("File", f.name, "creation", creation, update_modified=False)
	return f


class TestItemImages(IntegrationTestCase):
	def setUp(self):
		patcher = patch("dms.api.item_image_cache.enqueue_drive_cache")
		self.enqueue = patcher.start()
		self.addCleanup(patcher.stop)
		frappe.cache.delete_value(item_image_cache._failed_key(DRIVE_ID))
		self._delete_cached_files()
		self.addCleanup(self._delete_cached_files)

	def _delete_cached_files(self):
		for name in frappe.get_all("File", {"file_name": ["like", f"{item_image_cache.CACHE_PREFIX}%"]}, pluck="name"):
			frappe.delete_doc("File", name, force=True, ignore_permissions=True)

	def resolve(self, *codes):
		return _resolve_item_images([{"name": c, "image": frappe.db.get_value("Item", c, "image")} for c in codes])

	def test_drive_file_id(self):
		self.assertEqual(_drive_file_id(DRIVE_URL), DRIVE_ID)
		self.assertEqual(_drive_file_id(f"https://drive.google.com/open?id={DRIVE_ID}"), DRIVE_ID)
		self.assertIsNone(_drive_file_id("/files/a.png"))
		self.assertIsNone(_drive_file_id(None))

	def test_item_image_field_wins_over_attachment(self):
		_make_item("_T-IMG-A", image="https://example.com/main.png")
		_attach("_T-IMG-A", "https://example.com/other.png")
		self.assertEqual(self.resolve("_T-IMG-A")["_T-IMG-A"], "https://example.com/main.png")

	def test_newest_image_attachment_used_without_image_field(self):
		_make_item("_T-IMG-B")
		_attach("_T-IMG-B", "https://example.com/old.png", creation="2020-01-01 00:00:00")
		_attach("_T-IMG-B", "https://example.com/new.png", creation="2024-01-01 00:00:00")
		_attach("_T-IMG-B", "https://example.com/spec.pdf", creation="2025-01-01 00:00:00")
		self.assertEqual(self.resolve("_T-IMG-B")["_T-IMG-B"], "https://example.com/new.png")

	def test_no_image(self):
		_make_item("_T-IMG-C")
		self.assertIsNone(self.resolve("_T-IMG-C")["_T-IMG-C"])

	def test_uncached_drive_image_falls_back_and_queues(self):
		_make_item("_T-IMG-D", image=DRIVE_URL)
		self.enqueue.reset_mock()
		url = self.resolve("_T-IMG-D")["_T-IMG-D"]
		self.assertEqual(url, f"https://drive.google.com/thumbnail?id={DRIVE_ID}&sz=w1000")
		self.enqueue.assert_called_once_with({"_T-IMG-D": DRIVE_ID})

	def test_cached_drive_image_served_locally(self):
		_make_item("_T-IMG-E", image=DRIVE_URL)
		self.enqueue.reset_mock()
		with patch.object(item_image_cache, "_download", return_value=(b"\x89PNG fake", ".png")):
			item_image_cache.cache_drive_image("_T-IMG-E", DRIVE_ID)
		url = self.resolve("_T-IMG-E")["_T-IMG-E"]
		self.assertTrue(url.startswith(f"/files/{item_image_cache.CACHE_PREFIX}{DRIVE_ID}"), url)
		self.enqueue.assert_called_once_with({})

	def test_item_save_queues_drive_cache(self):
		_make_item("_T-IMG-G", image=DRIVE_URL)
		self.enqueue.assert_called_once_with({"_T-IMG-G": DRIVE_ID}, after_commit=True)

	def test_failed_download_creates_no_file_and_backs_off(self):
		_make_item("_T-IMG-F", image=DRIVE_URL)
		with patch.object(item_image_cache, "_download", side_effect=ValueError("not shared")):
			item_image_cache.cache_drive_image("_T-IMG-F", DRIVE_ID)
		self.assertEqual(item_image_cache.cached_drive_urls([DRIVE_ID]), {})
		self.assertTrue(frappe.cache.get_value(item_image_cache._failed_key(DRIVE_ID)))

	def test_queue_error_never_breaks_catalog(self):
		with patch("frappe.enqueue", side_effect=frappe.QueueOverloaded("full")) as enqueue:
			REAL_ENQUEUE({"_T-IMG-H": DRIVE_ID})  # must not raise
		enqueue.assert_called_once()
