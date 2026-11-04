"""Local copies of Google Drive item images.

Drive's thumbnail endpoint throttles bursts and needs the viewer's Google session for some
files, so the sales catalog loads Drive images unreliably. Each Drive image is downloaded once
in the background and stored as a public File on the Item; the catalog then serves it from
this site.
"""

import mimetypes

import frappe
import requests

CACHE_PREFIX = "dms-drive-"
MAX_BYTES = 5 * 1024 * 1024
DOWNLOAD_TIMEOUT = 20
FAILED_RETRY_SEC = 6 * 60 * 60


def cached_drive_urls(file_ids):
	"""{drive file id: local file_url} for Drive images already cached."""
	if not file_ids:
		return {}
	rows = frappe.db.sql(
		"""SELECT file_name, file_url
		   FROM `tabFile`
		   WHERE attached_to_doctype = 'Item'
		     AND file_name LIKE %(prefix)s""",
		{"prefix": f"{CACHE_PREFIX}%"},
		as_dict=True,
	)
	wanted = set(file_ids)
	cached = {}
	for r in rows:
		file_id = r.file_name[len(CACHE_PREFIX) :].rsplit(".", 1)[0]
		if file_id in wanted:
			cached[file_id] = r.file_url
	return cached


def enqueue_drive_cache(pending, after_commit=False):
	"""Queue ONE job that downloads all pending Drive images ({item_code: file_id}).

	One deduplicated job per call, never one job per item: a catalog with many Drive images
	must not flood the queue. Caching is best effort, so a queue error is logged, not raised;
	it must never break the catalog or an Item save. after_commit only inside a write
	transaction; GET requests never commit, so an after-commit job would never run.
	"""
	pending = {code: fid for code, fid in pending.items() if not frappe.cache.get_value(_failed_key(fid))}
	if not pending:
		return
	try:
		frappe.enqueue(
			"dms.api.item_image_cache.cache_drive_images",
			queue="long",
			job_id=f"{CACHE_PREFIX}batch",
			deduplicate=True,
			enqueue_after_commit=after_commit,
			pending=pending,
		)
	except Exception:
		frappe.log_error(title="DMS Drive image cache: could not queue job", message=frappe.get_traceback())


def cache_drive_images(pending):
	cached = cached_drive_urls(list(pending.values()))
	for item_code, file_id in pending.items():
		if file_id in cached or frappe.cache.get_value(_failed_key(file_id)):
			continue
		cache_drive_image(item_code, file_id)
		cached[file_id] = True
		frappe.db.commit()


def cache_drive_image(item_code, file_id):
	if cached_drive_urls([file_id]):
		return
	try:
		content, ext = _download(file_id)
	except Exception:
		frappe.cache.set_value(_failed_key(file_id), 1, expires_in_sec=FAILED_RETRY_SEC)
		frappe.log_error(title=f"DMS Drive image cache failed: {item_code}", message=frappe.get_traceback())
		return
	frappe.get_doc(
		{
			"doctype": "File",
			"file_name": f"{CACHE_PREFIX}{file_id}{ext}",
			"attached_to_doctype": "Item",
			"attached_to_name": item_code,
			"is_private": 0,
			"content": content,
		}
	).insert(ignore_permissions=True)


def queue_on_item_update(doc, method=None):
	"""Item on_update: cache a Drive image as soon as it is set on the Item."""
	from dms.api.sales import _drive_file_id

	file_id = _drive_file_id(doc.image)
	if file_id and not cached_drive_urls([file_id]):
		enqueue_drive_cache({doc.name: file_id}, after_commit=True)


def _download(file_id):
	resp = requests.get(
		"https://drive.google.com/thumbnail",
		params={"id": file_id, "sz": "w1000"},
		timeout=DOWNLOAD_TIMEOUT,
		stream=True,
	)
	resp.raise_for_status()
	content_type = resp.headers.get("Content-Type", "").split(";")[0].strip()
	if not content_type.startswith("image/"):
		raise ValueError(f"Drive returned {content_type or 'no content type'}, not an image (is the file shared?)")
	content = b""
	for chunk in resp.iter_content(64 * 1024):
		content += chunk
		if len(content) > MAX_BYTES:
			raise ValueError(f"Drive image larger than {MAX_BYTES} bytes")
	ext = ".jpg" if content_type == "image/jpeg" else mimetypes.guess_extension(content_type) or ".jpg"
	return content, ext


def _failed_key(file_id):
	return f"{CACHE_PREFIX}failed:{file_id}"
