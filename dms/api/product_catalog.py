"""Product Catalog endpoints for the field sales portal (/sales-product-catalog)."""

import base64
import mimetypes
import os

import frappe
import requests
from frappe.utils import cint, fmt_money, formatdate, today

from dms.api.reports import _require_report_role
from dms.api.sales import _get_default_company, _resolve_item_images

MAX_IMAGE_BYTES = 5 * 1024 * 1024
IMAGE_TIMEOUT = 10
CARDS_PER_ROW = 3
CARDS_PER_PAGE = 9
# Fixed page size and margins: the template's mm layout is sized for A4 with these margins.
PDF_OPTIONS = {
	"page-size": "A4",
	"margin-top": "12mm",
	"margin-bottom": "15mm",
	"margin-left": "12mm",
	"margin-right": "12mm",
	"footer-right": "Page [page] of [topage]",
	"footer-font-size": "8",
}


@frappe.whitelist(methods=["GET"])
def get_catalog(item_group: str = "", search: str = "", include_price=0):
	_require_report_role()
	include_price = cint(include_price)
	price_list, currency = _get_price_list()
	items = _get_catalog_items(item_group, search, include_price, price_list, currency)
	return {"items": items, "price_list": price_list if include_price else None, "currency": currency}


@frappe.whitelist(methods=["GET"])
def export_catalog_pdf(item_group: str = "", search: str = "", include_price=0):
	_require_report_role()
	include_price = cint(include_price)
	price_list, currency = _get_price_list()
	items = _get_catalog_items(item_group, search, include_price, price_list, currency)
	for item in items:
		item["image_data"] = _image_data_uri(item.get("image"))
		if include_price:
			item["price_display"] = f"{item.get('currency') or ''} {fmt_money(item.get('price') or 0)}".strip()

	company = _get_default_company()
	company_logo = frappe.db.get_value("Company", company, "company_logos") if company else None
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
			"company_logo": _image_data_uri(company_logo),
			"date": formatdate(today()),
		},
	)

	from frappe.utils.pdf import get_pdf

	frappe.local.response.filename = "Product Catalog.pdf"
	frappe.local.response.filecontent = get_pdf(html, PDF_OPTIONS.copy())
	frappe.local.response.type = "pdf"


@frappe.whitelist(methods=["GET"])
def get_item_groups():
	_require_report_role()
	return frappe.get_all("Item Group", filters={"is_group": 0}, pluck="name", order_by="name")


def _chunk(rows, size):
	return [rows[i : i + size] for i in range(0, len(rows), size)]


def _get_price_list():
	price_list = frappe.db.get_single_value("Selling Settings", "selling_price_list") or "Standard Selling"
	currency = frappe.db.get_value("Price List", price_list, "currency") or frappe.db.get_default("currency")
	return price_list, currency


def _get_catalog_items(item_group, search, include_price, price_list, currency):
	"""Enabled sales items with their image, and their selling price when include_price is set."""
	filters = {"disabled": 0, "is_sales_item": 1}
	if item_group and item_group != "All":
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
			row["price"] = _get_selling_rate(item, price_list)
			row["currency"] = currency
		rows.append(row)
	return rows


def _get_selling_rate(item, price_list):
	"""Same price resolution as the order flow (dms.api.sales.get_items)."""
	from erpnext.stock.get_item_details import get_item_price

	rates = get_item_price(
		{"price_list": price_list, "uom": item.stock_uom or "", "transaction_date": today()},
		item.name,
		ignore_party=True,
	)
	if rates and rates[0].get("price_list_rate"):
		return float(rates[0].get("price_list_rate"))
	return float(item.standard_rate or 0)


def _image_data_uri(url):
	"""Embed an image as a data: URI so wkhtmltopdf does not fetch URLs. None if it cannot be read."""
	if not url:
		return None
	try:
		content, content_type = _read_image(url)
	except Exception:
		frappe.log_error(title="DMS Product Catalog: image not embedded", message=f"{url}\n{frappe.get_traceback()}")
		return None
	if not content or not (content_type or "").startswith("image/"):
		return None
	return f"data:{content_type};base64,{base64.b64encode(content).decode()}"


def _read_image(url):
	if url.startswith(("http://", "https://")):
		resp = requests.get(url, timeout=IMAGE_TIMEOUT, stream=True)
		resp.raise_for_status()
		content_type = resp.headers.get("Content-Type", "").split(";")[0].strip()
		content = resp.raw.read(MAX_IMAGE_BYTES + 1, decode_content=True)
		if len(content) > MAX_IMAGE_BYTES:
			return None, None
		return content, content_type

	path = url.split("?")[0]
	if path.startswith("/private/files/"):
		full_path = frappe.get_site_path("private", "files", path[len("/private/files/") :])
	elif path.startswith("/files/"):
		full_path = frappe.get_site_path("public", "files", path[len("/files/") :])
	else:
		return None, None
	files_root = os.path.realpath(frappe.get_site_path())
	full_path = os.path.realpath(full_path)
	if not full_path.startswith(files_root) or not os.path.isfile(full_path):
		return None, None
	if os.path.getsize(full_path) > MAX_IMAGE_BYTES:
		return None, None
	with open(full_path, "rb") as f:
		return f.read(), mimetypes.guess_type(full_path)[0]
