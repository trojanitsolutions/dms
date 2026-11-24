"""Customer Invoice Balance endpoints for the field sales portal (/sales-customer-invoice-balance)."""

import frappe
from frappe import _
from frappe.utils import flt, formatdate, today

from dms.api.reports import _parse_filters, _require_report_role

ALLOWED_FILTERS = ("company", "customer", "customer_group", "from_date", "to_date", "show_paid_invoices")
TITLE = "Customer Invoice Balance"
MONEY = ("invoice_amount", "paid_amount", "outstanding_amount")


def _clean(filters):
	filters = _parse_filters(filters)
	return {key: filters.get(key) for key in ALLOWED_FILTERS if filters.get(key)}


def _run(clean):
	"""Run the Customer Invoice Balance report with the portal's filters, for all matching rows."""
	from dms.dms.report.customer_invoice_balance.customer_invoice_balance import execute

	columns, data, _msg, _chart, report_summary = execute(dict(clean))
	return columns, data, report_summary


@frappe.whitelist(methods=["GET"])
def get_customer_invoice_balance(filters=None):
	_require_report_role()
	columns, data, report_summary = _run(_clean(filters))
	return {
		"columns": [col for col in columns if not col.get("hidden")],
		"data": data,
		"report_summary": report_summary,
	}


@frappe.whitelist(methods=["GET"])
def export_customer_invoice_balance(filters=None, file_format="xlsx"):
	_require_report_role()
	if file_format not in ("xlsx", "pdf"):
		frappe.throw(_("Unsupported export format"))
	clean = _clean(filters)
	selected = set(_parse_filters(filters).get("selected") or [])

	columns, data, _summary = _run(clean)
	if selected:
		data = [row for row in data if row.get("invoice") in selected]
		# Renumber so the exported Sl No runs 1..n.
		for sl_no, row in enumerate(data, start=1):
			row["sl_no"] = sl_no
	totals = {field: sum(flt(row.get(field)) for row in data) for field in MONEY}

	if file_format == "xlsx":
		_export_xlsx(columns, data, totals)
	else:
		_export_pdf(clean, columns, data, totals)


@frappe.whitelist(methods=["GET"])
def get_print_data(filters=None):
	"""Return the print format set for this report in Sales Management Settings, with the rows for it.

	`print_format` is None when no format is set; the page then uses the plain PDF export.
	"""
	_require_report_role()
	from dms.api.reports import _get_report_print_format

	print_format = _get_report_print_format(TITLE)
	if not print_format:
		return {"print_format": None}

	from dms.dms.report.customer_invoice_balance.customer_invoice_balance import get_statement_details

	# Read the format directly: Desk's get_print_format_data also needs Desk report rights on
	# Sales Invoice, which Sales Reps do not have. They already see these rows on the portal page.
	template = frappe.db.get_value(
		"Print Format",
		{"name": print_format, "disabled": 0, "print_format_for": "Report"},
		["html", "css"],
		as_dict=True,
	)
	if not template:
		frappe.throw(_("{0} is not an enabled Print Format for a Report").format(frappe.bold(print_format)))
	clean = _clean(filters)
	selected = set(_parse_filters(filters).get("selected") or [])
	_columns, data, _summary = _run(clean)
	if selected:
		data = [row for row in data if row.get("invoice") in selected]
	details = get_statement_details(clean.get("company"), clean.get("customer"))
	company = details.get("company") or {}
	if company.get("logo"):
		company["logo"] = _logo_data_uri(company.get("name")) or company["logo"]
	return {
		"print_format": print_format,
		"html": template["html"],
		"css": template["css"],
		"data": data,
		"statement_details": details,
	}


def _logo_data_uri(company: str | None) -> str | None:
	"""Return the company logo as a data URI.

	The PDF tool (wkhtmltopdf) may not be able to fetch the logo over the network.
	A logo inside the HTML always shows.
	"""
	import base64
	import mimetypes

	file_url = frappe.db.get_value("Company", company, "company_logos") if company else None
	file_name = file_url and frappe.db.get_value("File", {"file_url": file_url}, "name")
	if not file_name:
		return None
	try:
		content = frappe.get_doc("File", file_name).get_content()
	except Exception:
		return None
	if isinstance(content, str):
		content = content.encode()
	mime = mimetypes.guess_type(file_url)[0] or "image/png"
	return f"data:{mime};base64,{base64.b64encode(content).decode()}"


def _export_xlsx(columns, data, totals):
	from frappe.desk.utils import provide_binary_file
	from frappe.utils.xlsxutils import make_xlsx

	# Keep the customer columns in the file even when the screen hides them for one customer.
	columns = [
		col for col in columns if not col.get("hidden") or col["fieldname"] in ("customer", "customer_name")
	]
	header = [col["label"] for col in columns]
	rows = [[row.get(col["fieldname"], "") for col in columns] for row in data]
	total_row = [totals.get(col["fieldname"], _("Total") if col["fieldname"] == "invoice" else "") for col in columns]

	content = make_xlsx([header, *rows, total_row], TITLE).getvalue()
	provide_binary_file(f"{TITLE} Report", "xlsx", content)


def _export_pdf(clean, columns, data, totals):
	from frappe.desk.utils import provide_binary_file
	from frappe.utils.pdf import get_pdf

	from dms.api.customer_ledger_report import _chrome_pdf, _money
	from dms.dms.report.customer_invoice_balance.customer_invoice_balance import (
		get_currency,
		get_customer_details,
	)

	company = clean.get("company") or frappe.defaults.get_user_default("Company")
	currency = (data[0].get("currency") if data else None) or get_currency(company)
	# With one customer picked, the customer is shown once above the table, not on every row.
	columns = [col for col in columns if not col.get("hidden")]
	numeric = {col["fieldname"] for col in columns if col["fieldtype"] in ("Currency", "Int")}

	def cell(row, col):
		value = row.get(col["fieldname"])
		if col["fieldtype"] == "Currency":
			return _money(value, row.get("currency") or currency)
		if col["fieldtype"] == "Date":
			return formatdate(value) if value else ""
		return "" if value is None else value

	cards = [
		{"label": _("Total Invoice Amount"), "value": _money(totals["invoice_amount"], currency)},
		{"label": _("Paid / Adjusted"), "value": _money(totals["paid_amount"], currency)},
		{"label": _("Total Outstanding"), "value": _money(totals["outstanding_amount"], currency), "cls": "red"},
		{"label": _("Invoices"), "value": len(data)},
	]
	if not clean.get("customer"):
		cards.append({"label": _("Customers"), "value": len({row.get("customer") for row in data})})

	period = " – ".join(formatdate(clean[key]) for key in ("from_date", "to_date") if clean.get(key))
	html = frappe.render_template(
		"dms/templates/customer_invoice_balance_pdf.html",
		{
			"title": TITLE,
			"company": company or "",
			"period": period,
			"generated": formatdate(today()),
			"customer": get_customer_details(clean.get("customer")),
			"cards": cards,
			"columns": columns,
			"numeric": numeric,
			"rows": [[cell(row, col) for col in columns] for row in data],
			"totals": [
				_money(totals[col["fieldname"]], currency)
				if col["fieldname"] in totals
				else (_("Total") if col["fieldname"] == "invoice" else "")
				for col in columns
			],
		},
	)
	try:
		content = get_pdf(html, {"orientation": "Landscape", "page-size": "A4"})
	except OSError:
		# wkhtmltopdf cannot start (e.g. an Intel build on Apple Silicon): try headless Chrome.
		content = _chrome_pdf(html)
	if not content:
		frappe.log_error(title="Customer Invoice Balance PDF export failed")
		frappe.throw(
			_("PDF export is not available: the PDF generator (wkhtmltopdf) cannot run on the server. Contact your administrator.")
		)
	provide_binary_file(f"{TITLE} Report", "pdf", content)
