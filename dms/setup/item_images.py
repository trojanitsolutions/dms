"""Set Item images from the zip bundled in the app (dms/item_images/item_images.zip).

"{code}-img1.jpg" becomes Item.image; img2, img3, ... are attached to the Item as extra Files.
Run by the patch dms.patches.v1_0.sync_item_images; to sync a new zip, add a new patch line
(see patches.txt). Every run writes a log under private/files/dms_image_sync/ so that
rollback() can undo exactly that run.
"""

import hashlib
import json
import os
import re
import zipfile
from collections import defaultdict

import frappe
from frappe.utils import now_datetime

from dms.setup.item_image_names import is_image_entry, parse_image_name

FILE_PREFIX = "dms-bundle-"
LOG_DIR = "dms_image_sync"
BATCH_SIZE = 50
MAX_BYTES = 5 * 1024 * 1024
_BUNDLE_FILE_RE = re.compile(r"-img(?P<n>\d+)-(?P<sha>[0-9a-f]{8})\.jpg$")


def zip_path():
	return frappe.get_app_path("dms", "item_images", "item_images.zip")


def sync_item_images(path=None):
	"""Sync all images in the zip. Returns the run log (dict); see _Run for its keys."""
	path = path or zip_path()
	if not os.path.exists(path):
		return None
	run = _Run()
	with zipfile.ZipFile(path) as zf:
		by_code = _group_entries(zf)
		items = {name.upper(): name for name in frappe.get_all("Item", pluck="name")}
		existing = _existing_bundle_files()
		for i, (code, entries) in enumerate(sorted(by_code.items()), 1):
			item = items.get(code.upper())
			if not item:
				run.missing.append(code)
			else:
				_sync_item(zf, item, entries, existing.get(item, {}), run)
			if i % BATCH_SIZE == 0:
				run.save_and_commit()
	run.finish()
	return run.log


@frappe.whitelist()
def rollback(run_id=None):
	"""Undo one sync run (default: the latest one that is not rolled back yet).

	Item.image goes back to its old value only when it still holds the value this run set,
	so later manual changes are kept. Files the run created are deleted.
	"""
	frappe.only_for("System Manager")
	run_id = run_id or _latest_run_id()
	if not run_id:
		frappe.throw("No item image sync run to roll back.")
	log = _read_log(run_id)
	if log.get("rolled_back"):
		return {"run_id": run_id, "restored": 0, "kept": [], "already_rolled_back": True}

	restored, kept = 0, []
	for change in log["changes"]:
		item = change["item"]
		if change.get("new_image") is not None and frappe.db.exists("Item", item):
			if frappe.db.get_value("Item", item, "image") == change["new_image"]:
				frappe.db.set_value("Item", item, "image", change["old_image"])
				restored += 1
			else:
				kept.append(item)
		for file_name in change["created_files"]:
			if frappe.db.exists("File", file_name):
				frappe.delete_doc("File", file_name, force=True, ignore_permissions=True)

	log["rolled_back"] = str(now_datetime())
	_write_log(log)
	frappe.db.commit()
	return {"run_id": run_id, "restored": restored, "kept": kept}


@frappe.whitelist()
def list_runs():
	frappe.only_for("System Manager")
	runs = []
	for run_id in _run_ids():
		log = _read_log(run_id)
		runs.append(
			{
				"run_id": run_id,
				"changes": len(log["changes"]),
				"missing": len(log["missing"]),
				"rolled_back": log.get("rolled_back"),
			}
		)
	return runs


def _sync_item(zf, item, entries, existing, run):
	"""entries: {n: ZipInfo}; existing: {n: (file docname, sha8, file_url)} from earlier runs."""
	frappe.db.savepoint("dms_item_image")
	try:
		created, urls = [], {}
		for n, info in sorted(entries.items()):
			if info.file_size > MAX_BYTES:
				raise ValueError(f"{info.filename} is larger than {MAX_BYTES} bytes")
			content = zf.read(info)
			sha8 = hashlib.sha256(content).hexdigest()[:8]
			if n in existing and existing[n][1] == sha8:
				urls[n] = existing[n][2]
				continue
			f = _insert_file(item, n, sha8, content)
			created.append(f.name)
			urls[n] = f.file_url

		main_n = min(entries)
		main_is_new = main_n not in existing or existing[main_n][2] != urls[main_n]
		old_image = frappe.db.get_value("Item", item, "image")
		new_image = None
		if (main_is_new or not old_image) and old_image != urls[main_n]:
			new_image = urls[main_n]
			frappe.db.set_value("Item", item, "image", new_image)
		if created or new_image:
			run.changes.append(
				{"item": item, "old_image": old_image, "new_image": new_image, "created_files": created}
			)
	except Exception:
		frappe.db.rollback(save_point="dms_item_image")
		run.failed.append(item)
		frappe.log_error(title=f"DMS item image sync failed: {item}", message=frappe.get_traceback())


def _insert_file(item, n, sha8, content):
	safe = re.sub(r"[^A-Za-z0-9_-]", "_", item)
	return frappe.get_doc(
		{
			"doctype": "File",
			"file_name": f"{FILE_PREFIX}{safe}-img{n}-{sha8}.jpg",
			"attached_to_doctype": "Item",
			"attached_to_name": item,
			"is_private": 0,
			"content": content,
		}
	).insert(ignore_permissions=True)


def _group_entries(zf):
	by_code = defaultdict(dict)
	for info in zf.infolist():
		if is_image_entry(info.filename):
			code, n = parse_image_name(info.filename)
			by_code[code].setdefault(n, info)
	return by_code


def _existing_bundle_files():
	"""{item: {n: (docname, sha8, file_url)}} for the newest bundle File per item and number."""
	rows = frappe.get_all(
		"File",
		filters={"attached_to_doctype": "Item", "file_name": ["like", f"{FILE_PREFIX}%"]},
		fields=["name", "file_name", "file_url", "attached_to_name"],
		order_by="creation asc",
	)
	existing = defaultdict(dict)
	for r in rows:
		match = _BUNDLE_FILE_RE.search(r.file_name)
		if match:
			existing[r.attached_to_name][int(match.group("n"))] = (r.name, match.group("sha"), r.file_url)
	return existing


class _Run:
	"""Run log: run_id, started, finished, changes [{item, old_image, new_image, created_files}],
	missing (zip codes with no Item), failed (items with errors), rolled_back."""

	def __init__(self):
		self.log = {
			"run_id": now_datetime().strftime("%Y%m%d-%H%M%S-%f"),
			"started": str(now_datetime()),
			"finished": None,
			"changes": [],
			"missing": [],
			"failed": [],
			"rolled_back": None,
		}
		self.changes, self.missing, self.failed = self.log["changes"], self.log["missing"], self.log["failed"]

	def save_and_commit(self):
		# The log is written before the commit: a log entry whose change never committed is
		# harmless to roll back, but a committed change with no log entry could not be undone.
		_write_log(self.log)
		frappe.db.commit()

	def finish(self):
		self.log["finished"] = str(now_datetime())
		self.save_and_commit()
		if self.missing or self.failed:
			frappe.log_error(
				title=f"DMS item image sync {self.log['run_id']}: {len(self.missing)} codes without Item",
				message=json.dumps({"missing": self.missing, "failed": self.failed}, indent=1),
			)
			frappe.db.commit()


def _log_dir():
	path = frappe.get_site_path("private", "files", LOG_DIR)
	os.makedirs(path, exist_ok=True)
	return path


def _write_log(log):
	path = os.path.join(_log_dir(), f"{log['run_id']}.json")
	tmp = f"{path}.tmp"
	with open(tmp, "w") as f:
		json.dump(log, f, indent=1)
	os.replace(tmp, path)


def _read_log(run_id):
	path = os.path.join(_log_dir(), f"{os.path.basename(run_id)}.json")
	if not os.path.exists(path):
		frappe.throw(f"No item image sync run {run_id}.")
	with open(path) as f:
		return json.load(f)


def _run_ids():
	return sorted((f[:-5] for f in os.listdir(_log_dir()) if f.endswith(".json")), reverse=True)


def _latest_run_id():
	for run_id in _run_ids():
		if not _read_log(run_id).get("rolled_back"):
			return run_id
	return None
