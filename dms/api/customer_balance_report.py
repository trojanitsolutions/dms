"""Customer Balance report endpoints for the field sales portal (/sales-customer-balance)."""

import frappe

from dms.api.reports import _parse_filters, _require_report_role


@frappe.whitelist()
def get_customer_balance(filters=None):
	_require_report_role()
	filters = _parse_filters(filters)

	from dms.dms.report.customer_balance.customer_balance import execute

	columns, data, _msg, _chart, report_summary = execute(filters)
	return {"columns": columns, "data": data, "report_summary": report_summary}


@frappe.whitelist()
def export_customer_balance(filters=None):
	_require_report_role()
	filters = _parse_filters(filters)
	# Export all matching rows, not only the current page.
	filters.pop("page_length", None)
	selected = set(filters.pop("selected", None) or [])

	from frappe.desk.utils import provide_binary_file
	from frappe.utils.xlsxutils import make_xlsx

	from dms.dms.report.customer_balance.customer_balance import execute

	columns, data, _msg, _chart, _summary = execute(filters)
	columns = [col for col in columns if not col.get("hidden")]
	if selected:
		data = [row for row in data if row.get("customer") in selected]
		# Renumber so the exported Sl No runs 1..n.
		for sl_no, row in enumerate(data, start=1):
			row["sl_no"] = sl_no

	header = [col["label"] for col in columns]
	rows = [[row.get(col["fieldname"], "") for col in columns] for row in data]

	content = make_xlsx([header, *rows], "Customer Balance").getvalue()
	provide_binary_file("Customer Balance Report", "xlsx", content)


@frappe.whitelist()
def search_customer_groups(txt: str = ""):
	"""Return up to 20 leaf Customer Groups whose name contains `txt`, for the Customer Group picker.

	The report matches the group exactly, so parent groups would always return no rows.
	"""
	_require_report_role()
	groups = frappe.get_list(
		"Customer Group",
		filters={"name": ["like", f"%{txt.strip()}%"], "is_group": 0},
		fields=["name"],
		order_by="name",
		limit_page_length=20,
	)
	return [{"value": g.name, "label": g.name} for g in groups]
