"""Product Catalog endpoints for the field sales portal (/sales-product-catalog).

The PDF export is built in a background job: a full catalog (over 1,500 items, about 180
pages) takes longer than a web request may run. The page starts the job, polls its status,
and then downloads the finished PDF.
"""

import base64
import hashlib
import io
import os
from concurrent.futures import ThreadPoolExecutor

import frappe
import requests
from frappe.utils import cint, fmt_money, formatdate, now_datetime, today

from dms.api.reports import _require_report_role
from dms.api.sales import _get_default_company, _resolve_item_images

MAX_IMAGE_BYTES = 15 * 1024 * 1024
IMAGE_TIMEOUT = 10
IMAGE_WORKERS = 8
THUMB_PX = 400  # about 170 dpi for a 58 mm card: sharp in print, small in the PDF
THUMB_QUALITY = 75
CARDS_PER_ROW = 3
CARDS_PER_PAGE = 9
EXPORT_JOB_TIMEOUT = 30 * 60
STATUS_TTL = 2 * 60 * 60
# Fixed page size and margins: the template's mm layout is sized for A4 with these margins.
PDF_OPTIONS = {
	"page-size": "A4",
	"margin-top": "12mm",
	"margin-bottom": "15mm",
	"margin-left": "12mm",
	"margin-right": "12mm",
	"footer-right": "Page [page] of [topage]",
	"footer-font-size": "8",
	"image-quality": "80",
}


@frappe.whitelist(methods=["GET"])
def get_catalog(item_group: str = "", search: str = "", include_price=0):
	_require_report_role()
	include_price = cint(include_price)
	price_list, currency = _get_price_list()
	items = _get_catalog_items(item_group, search, include_price, price_list, currency)
	return {"items": items, "price_list": price_list if include_price else None, "currency": currency}


@frappe.whitelist(methods=["GET"])
def get_item_groups():
	_require_report_role()
	return frappe.get_all("Item Group", filters={"is_group": 0}, pluck="name", order_by="name")


# ---------------------------------------------------------------- PDF export (background job)


@frappe.whitelist(methods=["POST"])
def start_catalog_export(item_group: str = "", search: str = "", include_price=0, item_codes=None):
	"""Queue the PDF build for the current user. One export per user runs at a time.

	When `item_codes` (a JSON list) is given, only those items are exported and the group and
	search filters are ignored.
	"""
	_require_report_role()
	item_codes = _parse_item_codes(item_codes)
	user = frappe.session.user
	status = _get_status(user)
	if status and status.get("status") in ("queued", "running") and not _is_stale(status):
		return status

	status = {"status": "queued", "started": str(now_datetime())}
	_set_status(user, status)
	frappe.enqueue(
		"dms.api.product_catalog.build_catalog_export",
		queue="long",
		timeout=EXPORT_JOB_TIMEOUT,
		job_id=f"dms-product-catalog-{user}",
		deduplicate=True,
		user=user,
		item_group=item_group,
		search=search,
		include_price=cint(include_price),
		item_codes=item_codes,
	)
	return status


@frappe.whitelist(methods=["GET"])
def get_catalog_export_status():
	_require_report_role()
	return _get_status(frappe.session.user) or {"status": "none"}


@frappe.whitelist(methods=["GET"])
def download_catalog_export():
	"""Return the current user's last finished export."""
	_require_report_role()
	path = _export_path(frappe.session.user)
	if not os.path.isfile(path):
		frappe.throw("No catalog export is ready. Please export again.", frappe.DoesNotExistError)
	with open(path, "rb") as f:
		frappe.local.response.filecontent = f.read()
	frappe.local.response.filename = "Product Catalog.pdf"
	frappe.local.response.type = "pdf"


def build_catalog_export(user, item_group="", search="", include_price=0, item_codes=None):
	"""Background job: build the PDF and store it for `user` to download."""
	frappe.set_user(user)
	_set_status(user, {"status": "running", "started": str(now_datetime())})
	try:
		content = _build_pdf(item_group, search, include_price, item_codes)
		path = _export_path(user)
		os.makedirs(os.path.dirname(path), exist_ok=True)
		with open(path, "wb") as f:
			f.write(content)
		_set_status(user, {"status": "done", "finished": str(now_datetime()), "size": len(content)})
	except Exception:
		frappe.log_error(title="DMS Product Catalog: export failed")
		_set_status(user, {"status": "failed"})


def _build_pdf(item_group, search, include_price, item_codes=None):
	from frappe.utils.pdf import get_pdf

	include_price = cint(include_price)
	price_list, currency = _get_price_list()
	items = _get_catalog_items(item_group, search, include_price, price_list, currency, item_codes)
	if item_codes:
		item_group = ""  # a hand-picked selection, not one group

	company = _get_default_company()
	company_logo = frappe.db.get_value("Company", company, "company_logos") if company else None
	thumbs = _get_thumbnails([i.get("image") for i in items] + [company_logo])

	for item in items:
		item["image_data"] = thumbs.get(item.get("image"))
		if include_price:
			item["price_display"] = f"{item.get('currency') or ''} {fmt_money(item.get('price') or 0)}".strip()

	html = frappe.render_template(
		"dms/templates/product_catalog_pdf.html",
		{
			"items": items,
			# Fixed pages of 3 rows x 3 cards, so no card is split across two PDF pages.
			"pages": [_chunk(page, CARDS_PER_ROW) for page in _chunk(items, CARDS_PER_PAGE)],
			"include_price": include_price,
			"price_list": price_list,
			"item_group": item_group if item_group and item_group != "All" else "",
			"company": company,
			"company_logo": thumbs.get(company_logo),
			"date": formatdate(today()),
		},
	)
	return get_pdf(html, PDF_OPTIONS.copy())


def _status_key(user):
	return f"dms_product_catalog_export:{user}"


def _get_status(user):
	return frappe.cache.get_value(_status_key(user))


def _set_status(user, status):
	frappe.cache.set_value(_status_key(user), status, expires_in_sec=STATUS_TTL)


def _is_stale(status):
	"""True when a queued/running export is older than the job timeout (the worker died)."""
	from frappe.utils import get_datetime, time_diff_in_seconds

	started = status.get("started")
	return not started or time_diff_in_seconds(now_datetime(), get_datetime(started)) > EXPORT_JOB_TIMEOUT + 60


def _export_path(user):
	# Outside public/ and private/files/, so it is only reachable through download_catalog_export.
	name = hashlib.sha1(user.encode()).hexdigest()
	return frappe.get_site_path("private", "dms_catalog_exports", f"{name}.pdf")


# ---------------------------------------------------------------- items and prices


def _chunk(rows, size):
	return [rows[i : i + size] for i in range(0, len(rows), size)]


def _parse_item_codes(item_codes):
	codes = frappe.parse_json(item_codes) if item_codes else []
	if not isinstance(codes, list):
		frappe.throw("item_codes must be a list.")
	return [str(c) for c in codes if c]


def _get_price_list():
	price_list = frappe.db.get_single_value("Selling Settings", "selling_price_list") or "Standard Selling"
	currency = frappe.db.get_value("Price List", price_list, "currency") or frappe.db.get_default("currency")
	return price_list, currency


def _get_catalog_items(item_group, search, include_price, price_list, currency, item_codes=None):
	"""Enabled sales items with their image, and their selling price when include_price is set.

	With `item_codes`, only those items (still enabled sales items); group and search are ignored.
	"""
	filters = {"disabled": 0, "is_sales_item": 1}
	if item_codes:
		filters["name"] = ["in", item_codes]
		item_group = search = ""
	elif item_group and item_group != "All":
		filters["item_group"] = item_group

	kwargs = {
		"filters": filters,
		"fields": ["name", "item_name", "item_group", "stock_uom", "standard_rate", "image", "description"],
		"order_by": "item_name",
		"limit_page_length": 0,
	}
	search = (search or "").strip()
	if search:
		kwargs["or_filters"] = [
			["item_name", "like", f"%{search}%"],
			["name", "like", f"%{search}%"],
			["item_group", "like", f"%{search}%"],
			["description", "like", f"%{search}%"],
		]

	items = frappe.get_all("Item", **kwargs)
	if not items:
		return []

	images = _resolve_item_images(items)
	prices = _get_selling_rates(items, price_list) if include_price else {}
	rows = []
	for item in items:
		row = {
			"item_code": item.name,
			"item_name": item.item_name or item.name,
			"item_group": item.item_group,
			"stock_uom": item.stock_uom,
			"image": images.get(item.name),
		}
		if include_price:
			row["price"] = prices.get(item.name) or float(item.standard_rate or 0)
			row["currency"] = currency
		rows.append(row)
	return rows


def _get_selling_rates(items, price_list):
	"""{item_code: rate} in the stock UOM, from the generic (no customer) Item Price rows.

	Same rules as the order flow (dms.api.sales.get_items). Uses ERPNext's bulk query when this
	version has it, else one query per item.
	"""
	ctx = {"price_list": price_list, "transaction_date": today()}
	try:
		from erpnext.stock.get_item_details import get_item_prices_for_stock_uom
	except ImportError:
		get_item_prices_for_stock_uom = None

	if get_item_prices_for_stock_uom:
		prices = get_item_prices_for_stock_uom(ctx, [i.name for i in items])
		return {code: float(p.price_list_rate or 0) for code, p in prices.items()}

	from erpnext.stock.get_item_details import get_item_price

	rates = {}
	for item in items:
		found = get_item_price({**ctx, "uom": item.stock_uom or ""}, item.name, ignore_party=True)
		if found:
			rates[item.name] = float(found[0].get("price_list_rate") or 0)
	return rates


# ---------------------------------------------------------------- images


def _get_thumbnails(urls):
	"""{url: JPEG data URI} for the given image URLs; unreadable images are left out.

	Images are shrunk to THUMB_PX and cached on disk, so later exports skip the download and
	resize. Work runs in threads; the threads do not touch frappe.local, so all site paths
	are resolved here first.
	"""
	site_path = os.path.realpath(frappe.get_site_path())
	cache_dir = os.path.join(site_path, "private", "dms_catalog_thumbs")
	os.makedirs(cache_dir, exist_ok=True)

	unique = list({u for u in urls if u})
	with ThreadPoolExecutor(max_workers=IMAGE_WORKERS) as pool:
		results = list(pool.map(lambda u: _thumbnail(u, site_path, cache_dir), unique))

	thumbs, errors = {}, []
	for url, (data, error) in zip(unique, results):
		if data:
			thumbs[url] = "data:image/jpeg;base64," + base64.b64encode(data).decode()
		elif error:
			errors.append(f"{url}: {error}")
	if errors:
		frappe.log_error(
			title=f"DMS Product Catalog: {len(errors)} image(s) not embedded",
			message="\n".join(errors[:200]),
		)
	return thumbs


def _thumbnail(url, site_path, cache_dir):
	"""(jpeg bytes, None) or (None, error). Runs in a worker thread: no frappe calls."""
	try:
		local_path = _local_image_path(url, site_path)
		if local_path:
			stat = os.stat(local_path)
			key = f"{local_path}|{stat.st_mtime_ns}|{stat.st_size}"
		elif url.startswith(("http://", "https://")):
			key = url
		else:
			return None, None

		cache_file = os.path.join(cache_dir, hashlib.sha1(key.encode()).hexdigest() + ".jpg")
		if os.path.isfile(cache_file):
			with open(cache_file, "rb") as f:
				return f.read(), None

		content = _read_local(local_path) if local_path else _download(url)
		data = _shrink(content)
		tmp = f"{cache_file}.{os.getpid()}.tmp"
		with open(tmp, "wb") as f:
			f.write(data)
		os.replace(tmp, cache_file)
		return data, None
	except Exception as e:
		return None, f"{type(e).__name__}: {e}"


def _local_image_path(url, site_path):
	"""Disk path for a /files/ or /private/files/ URL inside this site; None for other URLs."""
	path = url.split("?")[0]
	if path.startswith("/private/files/"):
		full = os.path.join(site_path, "private", "files", path[len("/private/files/") :])
	elif path.startswith("/files/"):
		full = os.path.join(site_path, "public", "files", path[len("/files/") :])
	else:
		return None
	full = os.path.realpath(full)
	if not full.startswith(site_path + os.sep) or not os.path.isfile(full):
		raise ValueError("file not found")
	return full


def _read_local(path):
	if os.path.getsize(path) > MAX_IMAGE_BYTES:
		raise ValueError("file too large")
	with open(path, "rb") as f:
		return f.read()


def _download(url):
	resp = requests.get(url, timeout=IMAGE_TIMEOUT, stream=True)
	resp.raise_for_status()
	content_type = resp.headers.get("Content-Type", "").split(";")[0].strip()
	if not content_type.startswith("image/"):
		raise ValueError(f"not an image ({content_type or 'no content type'})")
	content = resp.raw.read(MAX_IMAGE_BYTES + 1, decode_content=True)
	if len(content) > MAX_IMAGE_BYTES:
		raise ValueError("file too large")
	return content


def _shrink(content):
	from PIL import Image, ImageOps

	with Image.open(io.BytesIO(content)) as img:
		img = ImageOps.exif_transpose(img)
		img.thumbnail((THUMB_PX, THUMB_PX))
		if img.mode in ("RGBA", "LA", "P"):
			img = img.convert("RGBA")
			background = Image.new("RGB", img.size, (255, 255, 255))
			background.paste(img, mask=img.getchannel("A"))
			img = background
		elif img.mode != "RGB":
			img = img.convert("RGB")
		out = io.BytesIO()
		img.save(out, "JPEG", quality=THUMB_QUALITY, optimize=True)
		return out.getvalue()
