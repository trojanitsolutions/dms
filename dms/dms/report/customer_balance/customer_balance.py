# Copyright (c) 2026, Trojan Technologies and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.query_builder.functions import Sum
from frappe.utils import cint, flt, getdate


def execute(filters: dict | None = None):
	"""Return columns and data for the report.

	This is the main entry point for the report. It accepts the filters as a
	dictionary and should return columns and data. It is called by the framework
	every time the report is refreshed or a filter is updated.
	"""
	filters = filters or {}
	columns = get_columns()
	data = get_data(filters)
	report_summary = get_report_summary(data, filters)

	return columns, paginate(data, filters), None, None, report_summary

def execute_snapshot_report(filters: dict | None = None):
	"""Return columns and data for the report.

	This is the main entry point for snapshot report. When 'Synced
	Report' is enabled in report, framework will call this method
	every time the report is refreshed or a filter is updated. It
	accepts the same filters as normal execute. But a utility method -
	get_latest_sync, is also imported.

	"""
	from frappe.database.duckdb.database import get_latest_sync

	filters = filters or {}
	columns = get_columns()
	data = get_data(filters)
	report_summary = get_report_summary(data, filters)

	return columns, paginate(data, filters), None, None, report_summary

def get_columns() -> list[dict]:
	"""Return columns for the report.

	One field definition per column, just like a DocType field definition.
	"""
	return [
		{
			"label": _("Sl No"),
			"fieldname": "sl_no",
			"fieldtype": "Int",
			"width": 70,
		},
		{
			"label": _("Customer ID"),
			"fieldname": "customer",
			"fieldtype": "Link",
			"options": "Customer",
			"width": 180,
		},
		{
			"label": _("Customer Name"),
			"fieldname": "customer_name",
			"fieldtype": "Data",
			"width": 250,
		},
		{
			"label": _("Outstanding Balance"),
			"fieldname": "outstanding_balance",
			"fieldtype": "Currency",
			"options": "currency",
			"width": 180,
		},
		{
			"label": _("Currency"),
			"fieldname": "currency",
			"fieldtype": "Link",
			"options": "Currency",
			"hidden": 1,
		},
	]


def get_data(filters: dict) -> list[dict]:
	"""Return one row per customer with the net GL balance (debit - credit)."""
	gle = frappe.qb.DocType("GL Entry")
	customer = frappe.qb.DocType("Customer")
	balance = Sum(gle.debit - gle.credit)

	query = (
		frappe.qb.from_(gle)
		.inner_join(customer)
		.on(customer.name == gle.party)
		.select(gle.party.as_("customer"), customer.customer_name, balance.as_("outstanding_balance"))
		.where(gle.party_type == "Customer")
		.where(gle.is_cancelled == 0)
		.groupby(gle.party, customer.customer_name)
		.orderby(customer.customer_name)
	)

	if filters.get("as_on_date"):
		query = query.where(gle.posting_date <= getdate(filters.get("as_on_date")))
	if filters.get("company"):
		query = query.where(gle.company == filters.get("company"))
	if filters.get("customer"):
		# Partial match on the ID or the name, so the user can type part of either.
		search = f"%{filters.get('customer').strip()}%"
		query = query.where(gle.party.like(search) | customer.customer_name.like(search))
	if filters.get("customer_group"):
		query = query.where(customer.customer_group == filters.get("customer_group"))
	if not filters.get("show_zero_balance"):
		query = query.having(balance != 0)

	currency = get_currency(filters.get("company"))
	data = query.run(as_dict=True)
	for sl_no, row in enumerate(data, start=1):
		row.sl_no = sl_no
		row.outstanding_balance = flt(row.outstanding_balance)
		row.currency = currency

	return data


def paginate(data: list[dict], filters: dict) -> list[dict]:
	"""Return the first `page_length` rows. No page length means all rows."""
	page_length = cint(filters.get("page_length"))
	return data[:page_length] if page_length else data


def get_report_summary(data: list[dict], filters: dict) -> list[dict]:
	"""Build the summary cards. They cover all matching rows, not only the current page."""
	return [
		{
			"label": _("Total Pending Balance"),
			"value": sum(row.outstanding_balance for row in data),
			"datatype": "Currency",
			"currency": get_currency(filters.get("company")),
			"indicator": "Red",
		},
		{
			"key": "total_customers",
			"label": _("Total Customers"),
			"value": len(data),
			"datatype": "Int",
			"indicator": "Blue",
		},
	]


def get_currency(company: str | None) -> str | None:
	if company:
		return frappe.get_cached_value("Company", company, "default_currency")
	return frappe.db.get_default("currency")
