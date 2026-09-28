import frappe
from frappe import _
from frappe.utils import nowdate


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
