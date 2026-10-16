import frappe
from frappe import _
from frappe.utils import nowdate

from dms.utils import get_owner_filter


def _require_accounts_manager():
	if frappe.session.user == "Guest":
		frappe.throw(_("Not logged in"), frappe.AuthenticationError)
	if not frappe.db.exists("Has Role", {"parent": frappe.session.user, "role": "Accounts Manager"}):
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
	_require_accounts_manager()
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
def search_sales_orders(txt: str = "", company: str = "", customer: str = ""):
	"""Return up to 20 submitted or cancelled Sales Orders whose ID or customer name contains `txt`."""
	_require_accounts_manager()
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
	_require_accounts_manager()
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
def get_sales_order_status(filters=None):
	_require_accounts_manager()
	filters = _parse_filters(filters)

	from dms.dms.report.sales_order_status.sales_order_status import execute

	columns, data, _msg, _chart, report_summary = execute(filters)
	return {"columns": columns, "data": data, "report_summary": report_summary}


@frappe.whitelist()
def export_sales_order_status(filters=None):
	_require_accounts_manager()
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
