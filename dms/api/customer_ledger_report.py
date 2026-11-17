"""Customer Ledger endpoints for the field sales portal (/sales-customer-ledger).

Read-only wrapper around ERPNext's "Customer Ledger Summary" report, with Excel and PDF export.
"""

import frappe
from frappe import _
from frappe.utils import add_months, flt, fmt_money, formatdate, nowdate, today

from dms.api.reports import _parse_filters, _require_report_role
from dms.api.sales import _get_default_company

ALLOWED_FILTERS = ("company", "from_date", "to_date", "party", "customer_group")
TITLE = "Customer Ledger Summary"


def _run(filters):
	"""Run the ERPNext report with the portal's filters; return (filters, visible columns, rows)."""
	clean = {k: filters.get(k) for k in ALLOWED_FILTERS if filters.get(k)}
	# The report matches `party` by exact Customer ID. Anything else typed in the Customer box
	# (a name, or part of a name or ID) is matched against the rows after the report runs.
	text = str(clean.get("party") or "").strip()
	if text and not frappe.db.exists("Customer", text):
		clean.pop("party")
	else:
		text = ""
	clean.setdefault("company", _get_default_company())
	clean.setdefault("from_date", add_months(nowdate(), -1))
	clean.setdefault("to_date", nowdate())
	if not clean.get("company"):
		frappe.throw(_("No default company is set"))

	from erpnext.accounts.report.customer_ledger_summary.customer_ledger_summary import execute

	result = execute(dict(clean))
	columns, data = (result[0], result[1]) if result else ([], [])
	columns = [c for c in columns if not c.get("hidden") and c.get("fieldname") != "currency"]
	data = data or []
	if text:
		clean["party"] = text
		needle = text.lower()
		data = [
			row for row in data
			if needle in str(row.get("party") or "").lower() or needle in str(row.get("party_name") or "").lower()
		]
	return clean, columns, data


MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def _find_chrome():
	"""Path of an installed Chrome/Chromium, or None. Never downloads anything."""
	import os
	import platform
	import shutil

	from frappe.utils.print_utils import EXECUTABLE_PATHS

	configured = frappe.get_common_site_config().get("chromium_path")
	if configured and (path := shutil.which(configured)):
		return path
	parts = EXECUTABLE_PATHS.get(platform.system().lower())
	if parts:
		bundled = os.path.join(frappe.utils.get_bench_path(), "chromium", *parts)
		if os.access(bundled, os.X_OK):
			return bundled
	for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
		if path := shutil.which(name):
			return path
	return MAC_CHROME if os.access(MAC_CHROME, os.X_OK) else None


def _chrome_pdf(html):
	"""Print `html` to PDF bytes with headless Chrome; None if no browser or it fails."""
	import os
	import subprocess
	import tempfile

	chrome = _find_chrome()
	if not chrome:
		return None
	with tempfile.TemporaryDirectory() as tmp:
		source, target = os.path.join(tmp, "ledger.html"), os.path.join(tmp, "out.pdf")
		with open(source, "w", encoding="utf-8") as f:
			f.write(html)
		args = [
			chrome, "--headless", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer",
			f"--user-data-dir={os.path.join(tmp, 'profile')}", f"--print-to-pdf={target}", f"file://{source}",
		]
		try:
			subprocess.run(args, timeout=60, capture_output=True, check=False)
		except (OSError, subprocess.TimeoutExpired):
			return None
		if not os.path.exists(target):
			return None
		with open(target, "rb") as f:
			content = f.read()
	return content if content.startswith(b"%PDF") else None


def _money(value, currency):
	return f"{currency or ''} {fmt_money(flt(value), precision=2)}".strip()


@frappe.whitelist(methods=["GET"])
def get_customer_ledger(filters=None):
	_require_report_role()
	clean, columns, data = _run(_parse_filters(filters))
	return {"filters": clean, "columns": columns, "data": data}


@frappe.whitelist(methods=["GET"])
def export_customer_ledger(filters=None, file_format="xlsx"):
	_require_report_role()
	if file_format not in ("xlsx", "pdf"):
		frappe.throw(_("Unsupported export format"))
	filters = _parse_filters(filters)
	selected = set(filters.pop("selected", None) or [])

	clean, columns, data = _run(filters)
	if selected:
		data = [row for row in data if row.get("party") in selected]

	money = [c["fieldname"] for c in columns if c.get("fieldtype") == "Currency"]
	totals = {f: sum(flt(row.get(f)) for row in data) for f in money}
	period = f"{formatdate(clean['from_date'])} – {formatdate(clean['to_date'])}"

	from frappe.desk.utils import provide_binary_file

	if file_format == "xlsx":
		from frappe.utils.xlsxutils import make_xlsx

		first = columns[0]["fieldname"] if columns else None
		header = [c["label"] for c in columns]
		rows = [[row.get(c["fieldname"], "") for c in columns] for row in data]
		total_row = [totals.get(c["fieldname"], _("Total") if c["fieldname"] == first else "") for c in columns]
		title = [f"{TITLE} — {clean['company']} — {period}"]
		content = make_xlsx([title, [], header, *rows, total_row], TITLE).getvalue()
		provide_binary_file(TITLE, "xlsx", content)
		return

	from frappe.utils.pdf import get_pdf

	currency = (data[0].get("currency") if data else None) or frappe.get_cached_value(
		"Company", clean["company"], "default_currency"
	)

	def cell(row, col):
		value = row.get(col["fieldname"])
		if col.get("fieldtype") == "Currency":
			return _money(value, row.get("currency") or currency)
		return "" if value is None else value

	html = frappe.render_template(
		"dms/templates/customer_ledger_pdf.html",
		{
			"title": TITLE,
			"company": clean["company"],
			"period": period,
			"generated": formatdate(today()),
			"columns": columns,
			"money": set(money),
			"rows": [[cell(row, c) for c in columns] for row in data],
			"totals": [
				_money(totals[c["fieldname"]], currency) if c["fieldname"] in totals else ""
				for c in columns
			],
		},
	)
	try:
		content = get_pdf(html, {"orientation": "Landscape", "page-size": "A4"})
	except OSError:
		# wkhtmltopdf cannot start (e.g. an Intel build on Apple Silicon): try headless Chrome.
		content = _chrome_pdf(html)
	if not content:
		frappe.log_error(title="Customer Ledger PDF export failed")
		frappe.throw(_("PDF export is not available: the PDF generator (wkhtmltopdf) cannot run on the server. Contact your administrator."))
	provide_binary_file(TITLE, "pdf", content)
