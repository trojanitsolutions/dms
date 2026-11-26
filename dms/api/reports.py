import frappe
from frappe import _
from frappe.utils import nowdate

from dms.utils import get_owner_filter


def _require_accounts_manager():
	if frappe.session.user == "Guest":
		frappe.throw(_("Not logged in"), frappe.AuthenticationError)
	if not frappe.db.exists("Has Role", {"parent": frappe.session.user, "role": "Accounts Manager"}):
		frappe.throw(_("Access Denied"), frappe.PermissionError)


def _require_report_role(allowed=("Accounts Manager", "Sales Rep", "System Manager", "Administrator")):
	if frappe.session.user == "Guest":
		frappe.throw(_("Not logged in"), frappe.AuthenticationError)
	roles = set(frappe.get_roles(frappe.session.user))
	if not (set(allowed) & roles):
		frappe.throw(_("Access Denied"), frappe.PermissionError)


def _parse_filters(filters):
	return frappe.parse_json(filters) if isinstance(filters, str) else (filters or {})


@frappe.whitelist()
def get_sales_availability(filters=None):
	_require_accounts_manager()
	filters = _parse_filters(filters)

	from dms.dms.report.sales_booking_availablility.sales_booking_availablility import execute

	columns, data, _msg, _chart, report_summary = execute(filters)
	return {"columns": columns, "data": data, "report_summary": report_summary}


@frappe.whitelist()
def export_sales_availability(filters=None):
	_require_accounts_manager()
	filters = _parse_filters(filters)
	level = filters.pop("level", "")

	from frappe.desk.utils import provide_binary_file
	from frappe.utils.xlsxutils import make_xlsx

	from dms.dms.report.sales_booking_availablility.sales_booking_availablility import execute

	columns, data, _msg, _chart, _summary = execute(filters)
	if level:
		data = [row for row in data if str(row.get("indent")) == level]

	header = [_("#"), *(col["label"] for col in columns)]
	rows = [
		[i + 1, *(row.get(col["fieldname"], "") for col in columns)] for i, row in enumerate(data)
	]

	content = make_xlsx([header, *rows], "Sales Availability").getvalue()
	provide_binary_file("Sales Availability Report", "xlsx", content)


@frappe.whitelist()
def search_customers(txt: str = ""):
	"""Return up to 20 enabled customers whose ID or name contains `txt`, for the Customer picker."""
	_require_report_role()
	search = f"%{txt.strip()}%"
	customers = frappe.get_list(
		"Customer",
		filters={"disabled": 0},
		or_filters={"name": ["like", search], "customer_name": ["like", search]},
		fields=["name", "customer_name"],
		order_by="customer_name",
		limit_page_length=20,
	)
	return [
		{"value": c.name, "label": c.customer_name or c.name, "description": c.name} for c in customers
	]


@frappe.whitelist()
def search_customer_addresses(txt: str = "", customer: str = ""):
	"""Return up to 20 customer addresses whose title, line or city contains `txt`, for the Address picker.

	With `customer`, only that customer's addresses.
	"""
	_require_report_role()
	search = f"%{txt.strip()}%"
	filters = [["Dynamic Link", "link_doctype", "=", "Customer"], ["disabled", "=", 0]]
	if customer:
		filters.append(["Dynamic Link", "link_name", "=", customer])
	addresses = frappe.get_list(
		"Address",
		filters=filters,
		or_filters={"name": ["like", search], "address_line1": ["like", search], "city": ["like", search]},
		fields=["name", "address_title", "address_type", "address_line1", "city"],
		order_by="address_title",
		limit_page_length=20,
		distinct=True,
	)
	return [
		{
			"value": a.name,
			"label": a.name,
			"description": ", ".join(filter(None, [a.address_type, a.address_line1, a.city])),
		}
		for a in addresses
	]


@frappe.whitelist()
def search_sales_orders(txt: str = "", company: str = "", customer: str = ""):
	"""Return up to 20 submitted or cancelled Sales Orders whose ID or customer name contains `txt`."""
	_require_report_role()
	search = f"%{txt.strip()}%"
	filters = {"docstatus": ["in", [1, 2]]}
	if company:
		filters["company"] = company
	if customer:
		filters["customer"] = customer
	owner = get_owner_filter()
	if owner:
		filters["owner"] = owner
	orders = frappe.get_list(
		"Sales Order",
		filters=filters,
		or_filters={"name": ["like", search], "customer_name": ["like", search]},
		fields=["name", "customer_name"],
		order_by="transaction_date desc, name desc",
		limit_page_length=20,
	)
	return [{"value": o.name, "label": o.name, "description": o.customer_name} for o in orders]


@frappe.whitelist()
def search_sales_persons(txt: str = ""):
	"""Return up to 20 enabled Sales Persons (groups included) whose ID or name contains `txt`."""
	_require_report_role()
	search = f"%{txt.strip()}%"
	persons = frappe.get_list(
		"Sales Person",
		filters={"enabled": 1},
		or_filters={"name": ["like", search], "sales_person_name": ["like", search]},
		fields=["name", "sales_person_name"],
		order_by="name",
		limit_page_length=20,
	)
	return [
		{"value": p.name, "label": p.sales_person_name or p.name, "description": p.name} for p in persons
	]


@frappe.whitelist()
def get_customer_balance(filters=None):
	_require_accounts_manager()
	filters = _parse_filters(filters)

	from dms.dms.report.customer_balance.customer_balance import execute

	columns, data, _msg, _chart, report_summary = execute(filters)
	return {"columns": columns, "data": data, "report_summary": report_summary}


@frappe.whitelist()
def export_customer_balance(filters=None):
	_require_accounts_manager()
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

	header = [col["label"] for col in columns]
	rows = [[row.get(col["fieldname"], "") for col in columns] for row in data]

	content = make_xlsx([header, *rows], "Customer Balance").getvalue()
	provide_binary_file("Customer Balance Report", "xlsx", content)


@frappe.whitelist()
def get_customer_invoice_balance(filters=None):
	_require_accounts_manager()
	filters = _parse_filters(filters)

	from dms.dms.report.customer_invoice_balance.customer_invoice_balance import execute

	columns, data, _msg, _chart, report_summary = execute(filters)
	return {"columns": columns, "data": data, "report_summary": report_summary}


@frappe.whitelist()
def export_customer_invoice_balance(filters=None):
	_require_accounts_manager()
	filters = _parse_filters(filters)
	# Export all matching rows, not only the current page.
	filters.pop("page_length", None)
	selected = set(filters.pop("selected", None) or [])

	from frappe.desk.utils import provide_binary_file
	from frappe.utils.xlsxutils import make_xlsx

	from dms.dms.report.customer_invoice_balance.customer_invoice_balance import execute

	columns, data, _msg, _chart, _summary = execute(filters)
	# Keep the customer columns in the file even when the screen hides them for one customer.
	columns = [
		col for col in columns if not col.get("hidden") or col["fieldname"] in ("customer", "customer_name")
	]
	if selected:
		data = [row for row in data if row.get("invoice") in selected]

	header = [col["label"] for col in columns]
	rows = [[row.get(col["fieldname"], "") for col in columns] for row in data]

	content = make_xlsx([header, *rows], "Customer Invoice Balance").getvalue()
	provide_binary_file("Customer Invoice Balance Report", "xlsx", content)


def _get_report_print_format(report: str) -> str | None:
	"""Return the print format set for a report in Sales Management Settings."""
	return frappe.db.get_value(
		"Dms Report Table",
		{"parent": "Sales Management Settings", "parenttype": "Sales Management Settings", "reports": report},
		"print_format",
	)


@frappe.whitelist()
def get_report_print_format_name(report: str):
	_require_report_role()
	return _get_report_print_format(report)


@frappe.whitelist()
def get_customer_invoice_balance_print(filters=None):
	"""Return the configured print format and the rows to render with it in the browser."""
	_require_accounts_manager()
	filters = _parse_filters(filters)
	# Print all matching rows, not only the current page.
	filters.pop("page_length", None)
	selected = set(filters.pop("selected", None) or [])

	from frappe.desk.query_report import get_print_format_data

	from dms.dms.report.customer_invoice_balance.customer_invoice_balance import (
		execute,
		get_statement_details,
	)

	print_format = _get_report_print_format("Customer Invoice Balance")
	if not print_format:
		frappe.throw(_("No print format is set for this report in Sales Management Settings"))
	template = get_print_format_data(print_format)

	_columns, data, _msg, _chart, _summary = execute(filters)
	if selected:
		data = [row for row in data if row.get("invoice") in selected]

	return {
		"print_format": print_format,
		"html": template["html"],
		"css": template["css"],
		"data": data,
		"statement_details": get_statement_details(filters.get("company"), filters.get("customer")),
	}


@frappe.whitelist()
def get_sales_order_status(filters=None):
	_require_report_role()
	filters = _parse_filters(filters)

	from dms.dms.report.sales_order_status.sales_order_status import execute

	columns, data, _msg, _chart, report_summary = execute(filters)
	return {"columns": columns, "data": data, "report_summary": report_summary}


@frappe.whitelist()
def export_sales_order_status(filters=None):
	_require_report_role()
	filters = _parse_filters(filters)
	# Export all matching rows, not only the current page.
	filters.pop("page_length", None)
	selected = set(filters.pop("selected", None) or [])

	from frappe.desk.utils import provide_binary_file
	from frappe.utils.xlsxutils import make_xlsx

	from dms.dms.report.sales_order_status.sales_order_status import execute

	columns, data, _msg, _chart, _summary = execute(filters)
	columns = [col for col in columns if not col.get("hidden")]
	if selected:
		data = [row for row in data if row.get("sales_order") in selected]

	header = [_("#"), *(col["label"] for col in columns)]
	rows = [
		[i + 1, *(row.get(col["fieldname"], "") for col in columns)] for i, row in enumerate(data)
	]

	content = make_xlsx([header, *rows], "Sales Order Status").getvalue()
	provide_binary_file("Sales Order Status Report", "xlsx", content)


def _get_employee_checkin_rows(filters):
	conditions = {}
	if filters.get("employee"):
		conditions["employee"] = filters["employee"]
	if filters.get("log_type"):
		conditions["log_type"] = filters["log_type"]
	if filters.get("today"):
		today = nowdate()
		conditions["time"] = ["between", [f"{today} 00:00:00", f"{today} 23:59:59"]]
	elif filters.get("from_date") and filters.get("to_date"):
		conditions["time"] = ["between", [filters["from_date"], filters["to_date"]]]

	return frappe.get_list(
		"Employee Checkin",
		fields=["name", "employee", "employee_name", "log_type", "time", "shift", "employee_image"],
		filters=conditions,
		order_by="time desc",
		limit_page_length=0,
		ignore_permissions=True,
	)


@frappe.whitelist()
def get_employee_checkins(filters=None):
	_require_accounts_manager()
	filters = _parse_filters(filters)

	return _get_employee_checkin_rows(filters)


@frappe.whitelist()
def export_employee_checkins(filters=None):
	_require_accounts_manager()
	filters = _parse_filters(filters)

	from frappe.desk.utils import provide_binary_file
	from frappe.utils.xlsxutils import make_xlsx

	rows_data = _get_employee_checkin_rows(filters)

	header = [
		_("#"),
		_("Checkin ID"),
		_("Employee"),
		_("Employee Name"),
		_("Log Type"),
		_("Time"),
		_("Shift"),
		_("Photo"),
	]
	rows = [
		[
			i + 1,
			row["name"],
			row["employee"],
			row["employee_name"],
			row["log_type"],
			row["time"],
			row["shift"],
			row.get("employee_image") or "",
		]
		for i, row in enumerate(rows_data)
	]

	content = make_xlsx([header, *rows], "Employee Checkins").getvalue()
	provide_binary_file("Employee Checkin Report", "xlsx", content)
