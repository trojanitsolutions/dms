"""Jinja helpers for dms print formats (registered in hooks.jinja)."""

import os

import frappe

from dms.api.item_image_cache import CACHE_PREFIX, cached_drive_urls
from dms.api.sales import _convert_drive_url_to_embed, _drive_file_id, _is_probable_image


def get_item_attachments(item_code):
	"""Item.image first, then the Item's File attachments (newest first), deduped by URL.

	Returns [{"url", "file_name", "is_image"}]. Drive links resolve to the local cached copy
	when present, otherwise to the Drive thumbnail. Local Drive cache Files are skipped.
	"""
	if not item_code:
		return []

	sources = []
	image = frappe.db.get_value("Item", item_code, "image")
	if image:
		sources.append((image, None))

	files = frappe.get_all(
		"File",
		filters={
			"attached_to_doctype": "Item",
			"attached_to_name": item_code,
			"is_folder": 0,
			"file_name": ["not like", f"{CACHE_PREFIX}%"],
		},
		fields=["file_url", "file_name"],
		order_by="creation desc",
	)
	sources.extend((f.file_url, f.file_name) for f in files if f.file_url)

	drive_ids = [fid for fid in (_drive_file_id(url) for url, _ in sources) if fid]
	cached = cached_drive_urls(drive_ids)

	seen, attachments = set(), []
	for url, file_name in sources:
		if url in seen:
			continue
		seen.add(url)
		file_id = _drive_file_id(url)
		resolved = (cached.get(file_id) or _convert_drive_url_to_embed(url)) if file_id else url
		attachments.append(
			{
				"url": resolved,
				"file_name": file_name or os.path.basename(url.split("?")[0]),
				"is_image": _is_probable_image(url),
			}
		)
	return attachments
