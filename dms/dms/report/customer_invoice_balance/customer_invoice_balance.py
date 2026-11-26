# Copyright (c) 2026, Trojan Technologies and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.contacts.doctype.address.address import get_company_address, get_default_address
from frappe.query_builder.functions import IfNull
from frappe.utils import cint, date_diff, flt, get_url, getdate, today


def execute(filters: dict | None = None):
	"""Return one row per submitted Sales Invoice with its outstanding balance."""
	filters = filters or {}
	data = get_data(filters)
	return get_columns(filters), paginate(data, filters), None, None, get_report_summary(data, filters)


def paginate(data: list[dict], filters: dict) -> list[dict]:
	"""Return the first `page_length` rows. No page length means all rows."""
	page_length = cint(filters.get("page_length"))
	return data[:page_length] if page_length else data


def get_columns(filters: dict) -> list[dict]:
	# With one customer picked, the customer is shown once in the summary, not on every row.
	hide_customer = 1 if filters.get("customer") else 0
	return [
		{"label": _("Sl No"), "fieldname": "sl_no", "fieldtype": "Int", "width": 70, "disable_total": 1},
		{"label": _("Invoice"), "fieldname": "invoice", "fieldtype": "Link", "options": "Sales Invoice", "width": 170},
		{"label": _("Posting Date"), "fieldname": "posting_date", "fieldtype": "Date", "width": 110},
		{"label": _("Due Date"), "fieldname": "due_date", "fieldtype": "Date", "width": 110},
		{
			"label": _("Customer ID"),
			"fieldname": "customer",
			"fieldtype": "Link",
			"options": "Customer",
			"width": 150,
			"hidden": hide_customer,
		},
		{
			"label": _("Customer Name"),
			"fieldname": "customer_name",
			"fieldtype": "Data",
			"width": 220,
			"hidden": hide_customer,
		},
		{
			"label": _("Invoice Amount"),
			"fieldname": "invoice_amount",
			"fieldtype": "Currency",
			"options": "currency",
			"width": 140,
		},
		{
			"label": _("Paid / Adjusted"),
			"fieldname": "paid_amount",
			"fieldtype": "Currency",
			"options": "currency",
			"width": 140,
		},
		{
			"label": _("Outstanding Balance"),
			"fieldname": "outstanding_amount",
			"fieldtype": "Currency",
			"options": "currency",
			"width": 160,
		},
		{"label": _("Overdue Days"), "fieldname": "overdue_days", "fieldtype": "Int", "width": 110},
		{"label": _("Status"), "fieldname": "status", "fieldtype": "Data", "width": 110},
		{"label": _("Currency"), "fieldname": "currency", "fieldtype": "Link", "options": "Currency", "hidden": 1},
	]


def get_data(filters: dict) -> list[dict]:
	si = frappe.qb.DocType("Sales Invoice")
	# Rounded total is 0 when rounding is disabled on the invoice.
	invoice_amount = (
		frappe.qb.terms.Case()
		.when(IfNull(si.rounded_total, 0) != 0, si.rounded_total)
		.else_(si.grand_total)
	)

	query = (
		frappe.qb.from_(si)
		.select(
			si.name.as_("invoice"),
			si.posting_date,
			si.due_date,
			si.customer,
			si.customer_name,
			invoice_amount.as_("invoice_amount"),
			si.outstanding_amount,
			si.status,
			si.currency,
		)
		.where(si.docstatus == 1)
		.orderby(si.customer_name)
		.orderby(si.posting_date)
		.orderby(si.name)
	)

	if filters.get("company"):
		query = query.where(si.company == filters.get("company"))
	if filters.get("customer"):
		query = query.where(si.customer == filters.get("customer"))
	if filters.get("customer_address"):
		query = query.where(si.customer_address == filters.get("customer_address"))
	if filters.get("customer_group"):
		query = query.where(si.customer_group == filters.get("customer_group"))
	if filters.get("posting_date"):
		query = query.where(si.posting_date == getdate(filters.get("posting_date")))
	if filters.get("from_date"):
		query = query.where(si.posting_date >= getdate(filters.get("from_date")))
	if filters.get("to_date"):
		query = query.where(si.posting_date <= getdate(filters.get("to_date")))
	if not filters.get("show_paid_invoices"):
		query = query.where(si.outstanding_amount != 0)

	data = query.run(as_dict=True)
	current_date = today()
	for sl_no, row in enumerate(data, start=1):
		row.sl_no = sl_no
		row.invoice_amount = flt(row.invoice_amount)
		row.outstanding_amount = flt(row.outstanding_amount)
		row.paid_amount = row.invoice_amount - row.outstanding_amount
		row.overdue_days = (
			max(date_diff(current_date, row.due_date), 0) if row.due_date and row.outstanding_amount > 0 else 0
		)

	return data


def get_report_summary(data: list[dict], filters: dict) -> list[dict]:
	"""Build the summary cards. They cover all matching rows, not only the current page."""
	currency = get_currency(filters.get("company"))
	cards = [
		*get_customer_cards(filters),
		{
			"label": _("Total Invoice Amount"),
			"value": sum(row.invoice_amount for row in data),
			"datatype": "Currency",
			"currency": currency,
			"indicator": "Blue",
		},
		{
			"label": _("Total Outstanding"),
			"value": sum(row.outstanding_amount for row in data),
			"datatype": "Currency",
			"currency": currency,
			"indicator": "Red",
		},
		{
			"key": "total_invoices",
			"label": _("Invoices"),
			"value": len(data),
			"datatype": "Int",
			"indicator": "Blue",
		},
	]
	if not filters.get("customer"):
		cards.append(
			{
				"label": _("Customers"),
				"value": len({row.customer for row in data}),
				"datatype": "Int",
				"indicator": "Blue",
			}
		)
	return cards


def get_customer_cards(filters: dict) -> list[dict]:
	"""Return the Customer Name and Customer ID cards when one customer is picked."""
	customer = filters.get("customer")
	if not customer:
		return []
	customer_name = frappe.db.get_value("Customer", customer, "customer_name") or customer
	return [
		{"key": "customer_name", "label": _("Customer Name"), "value": customer_name, "datatype": "Data"},
		{"key": "customer", "label": _("Customer ID"), "value": customer, "datatype": "Data"},
	]


def get_currency(company: str | None) -> str | None:
	if company:
		return frappe.get_cached_value("Company", company, "default_currency")
	return frappe.db.get_default("currency")


@frappe.whitelist()
def get_statement_details(company: str | None = None, customer: str | None = None) -> dict:
	"""Return the company and customer details for the Statement of Account print format."""
	frappe.has_permission("Sales Invoice", "read", throw=True)
	company = company or frappe.defaults.get_user_default("Company")
	return {
		"company": get_company_details(company),
		"customer": get_customer_details(customer),
		"currency": get_currency(company),
	}


def get_company_details(company: str | None) -> dict:
	company = company or frappe.defaults.get_user_default("Company")
	if not company:
		return {}
	values = frappe.db.get_value("Company", company, ["company_logos", "phone_no", "email"], as_dict=True)
	address = get_address(get_company_address(company).company_address)
	return {
		"name": company,
		"logo": get_url(values.company_logos) if values.company_logos else None,
		"phone": values.phone_no or address.get("phone"),
		"email": values.email or address.get("email_id"),
		"address_line": address.get("line"),
		"city_line": address.get("city_line"),
	}


def get_customer_details(customer: str | None) -> dict:
	if not customer:
		return {}
	values = frappe.db.get_value("Customer", customer, ["customer_name", "mobile_no"], as_dict=True)
	address = get_address(get_default_address("Customer", customer))
	return {
		"id": customer,
		"name": values.customer_name or customer,
		"phone": values.mobile_no or address.get("phone"),
		"address": ", ".join(filter(None, [address.get("line"), address.get("city_line")])),
	}


def get_address(name: str | None) -> dict:
	"""Return an address as a street line and a "City, State - PIN, Country" line."""
	if not name:
		return {}
	address = frappe.db.get_value(
		"Address",
		name,
		["address_line1", "address_line2", "city", "state", "pincode", "country", "phone", "email_id"],
		as_dict=True,
	)
	state = " - ".join(filter(None, [address.state, address.pincode]))
	return {
		"line": ", ".join(filter(None, [address.address_line1, address.address_line2])),
		"city_line": ", ".join(filter(None, [address.city, state, address.country])),
		"phone": address.phone,
		"email_id": address.email_id,
	}
