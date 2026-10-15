# Copyright (c) 2026, Trojan Technologies and contributors
# For license information, please see license.txt

"""Sales Order Status: one row per Sales Order with delivery, invoice and overall fulfilment status.

Quantities (all in Sales Order UOM, counted per Sales Order Item):
- Delivered Qty: standard `Sales Order Item.delivered_qty`. ERPNext keeps it from submitted Delivery
  Notes and submitted Sales Invoices with Update Stock, net of returns. Drafts and cancelled
  documents never count.
- Invoiced Qty: sum of `Sales Invoice Item.qty` against the item (`so_detail`) on submitted
  invoices. Credit notes carry negative qty against the same item, so the value is net of returns.
- Pending Delivery / Pending Invoice Qty: sum of max(ordered - delivered/invoiced, 0) per item, so an
  over-delivered item can not hide a short one.

Delivery Status (first match wins):
  Cancelled (SO cancelled) > Not Applicable (Skip Delivery Note) > Fully Delivered (no pending qty)
  > Closed (SO closed with pending qty) > Partly Delivered (some qty delivered) > Not Delivered

Invoice Status (first match wins):
  Cancelled > Fully Invoiced (no pending qty) > Closed (SO closed with pending qty)
  > Partly Invoiced (some qty on submitted invoices) > Draft Invoice (only draft invoices exist)
  > Not Invoiced

Overall Fulfilment Status (first match wins):
  Cancelled > Fully Completed (delivery Fully Delivered/Not Applicable and Fully Invoiced)
  > Closed (closed before full fulfilment) > Delivered – Invoice Pending > Partially Delivered
  > Not Delivered

Overdue: an open order with pending delivery where a pending item's delivery date is before today.
Days Overdue uses the oldest such item delivery date.

"Show All Invoices" only adds cancelled invoices to the invoice references. It never changes any
quantity, status or summary value.
"""

import json

import frappe
from frappe import _
from frappe.query_builder import Case
from frappe.query_builder.functions import Sum
from frappe.utils import cint, date_diff, flt, getdate, today
from frappe.utils.nestedset import get_descendants_of

CHUNK_SIZE = 1000

DELIVERY_DONE = ("Fully Delivered", "Not Applicable")
DELIVERY_PENDING = ("Not Delivered", "Partly Delivered")
INVOICE_PENDING = ("Not Invoiced", "Draft Invoice", "Partly Invoiced")
DELIVERED_INVOICE_PENDING = "Delivered – Invoice Pending"


def execute(filters: dict | None = None):
	"""Return columns, data and the summary cards for the report."""
	filters = frappe._dict(filters or {})
	validate_filters(filters)
	columns = get_columns()
	data = apply_status_filters(get_data(filters), filters)
	report_summary = get_report_summary(data)

	return columns, paginate(data, filters), None, None, report_summary


def execute_snapshot_report(filters: dict | None = None):
	"""Snapshot entry point. The report is computed live, so it is the same as `execute`."""
	return execute(filters)


def validate_filters(filters: dict):
	if filters.from_date and filters.to_date and getdate(filters.from_date) > getdate(filters.to_date):
		frappe.throw(_("From Date can not be after To Date"))


def get_columns() -> list[dict]:
	"""Return columns for the report."""
	return [
		{"label": _("Sales Order"), "fieldname": "sales_order", "fieldtype": "Link", "options": "Sales Order", "width": 160},
		{"label": _("Customer"), "fieldname": "customer", "fieldtype": "Link", "options": "Customer", "width": 130},
		{"label": _("Customer Name"), "fieldname": "customer_name", "fieldtype": "Data", "width": 180},
		{"label": _("Transaction Date"), "fieldname": "transaction_date", "fieldtype": "Date", "width": 105},
		{"label": _("Expected Delivery Date"), "fieldname": "delivery_date", "fieldtype": "Date", "width": 105},
		{"label": _("Company"), "fieldname": "company", "fieldtype": "Link", "options": "Company", "width": 140},
		{"label": _("Order Value"), "fieldname": "order_value", "fieldtype": "Currency", "options": "currency", "width": 130},
		{"label": _("Ordered Qty"), "fieldname": "ordered_qty", "fieldtype": "Float", "width": 95},
		{"label": _("Delivered Qty"), "fieldname": "delivered_qty", "fieldtype": "Float", "width": 95},
		{"label": _("Pending Delivery Qty"), "fieldname": "pending_delivery_qty", "fieldtype": "Float", "width": 95},
		{"label": _("Invoiced Qty"), "fieldname": "invoiced_qty", "fieldtype": "Float", "width": 95},
		{"label": _("Pending Invoice Qty"), "fieldname": "pending_invoice_qty", "fieldtype": "Float", "width": 95},
		{"label": _("Draft Invoice Qty"), "fieldname": "draft_invoice_qty", "fieldtype": "Float", "width": 95},
		{"label": _("Sales Order Status"), "fieldname": "sales_order_status", "fieldtype": "Data", "width": 130},
		{"label": _("Delivery Status"), "fieldname": "delivery_status", "fieldtype": "Data", "width": 130},
		{"label": _("Invoice Status"), "fieldname": "invoice_status", "fieldtype": "Data", "width": 125},
		{"label": _("Overall Fulfilment Status"), "fieldname": "fulfilment_status", "fieldtype": "Data", "width": 190},
		{"label": _("Delivery Notes"), "fieldname": "delivery_notes", "fieldtype": "Data", "width": 220},
		{"label": _("Sales Invoices"), "fieldname": "sales_invoices", "fieldtype": "Data", "width": 240},
		{"label": _("Days Overdue"), "fieldname": "days_overdue", "fieldtype": "Int", "width": 90},
		{"label": _("Currency"), "fieldname": "currency", "fieldtype": "Link", "options": "Currency", "hidden": 1},
	]


def get_data(filters: dict) -> list[dict]:
	orders = get_sales_orders(filters)
	if not orders:
		return []

	names = [order.name for order in orders]
	items = get_order_items(names)
	invoiced = get_invoiced_qty_by_item(names)
	invoices = get_linked_invoices(names)
	delivery_notes = get_linked_delivery_notes(names)
	currencies = get_company_currencies({order.company for order in orders})
	show_all_invoices = cint(filters.show_all_invoices)

	return [
		build_row(
			order,
			items.get(order.name, []),
			invoiced,
			invoices.get(order.name, []),
			delivery_notes.get(order.name, []),
			currencies.get(order.company),
			show_all_invoices,
		)
		for order in orders
	]


def get_sales_orders(filters: dict) -> list[dict]:
	"""Return submitted and cancelled Sales Orders the user can read, one row per order."""
	conditions = [["docstatus", "in", [1, 2]]]
	if filters.company:
		conditions.append(["company", "=", filters.company])
	if filters.customer:
		conditions.append(["customer", "=", filters.customer])
	if filters.sales_order:
		conditions.append(["name", "=", filters.sales_order])
	if filters.from_date:
		conditions.append(["transaction_date", ">=", filters.from_date])
	if filters.to_date:
		conditions.append(["transaction_date", "<=", filters.to_date])
	if filters.sales_order_status:
		conditions.append(["status", "=", filters.sales_order_status])
	if filters.sales_person:
		sales_persons = [filters.sales_person, *get_descendants_of("Sales Person", filters.sales_person)]
		conditions.append(["Sales Team", "sales_person", "in", sales_persons])

	return frappe.get_list(
		"Sales Order",
		filters=conditions,
		fields=[
			"name",
			"customer",
			"customer_name",
			"transaction_date",
			"delivery_date",
			"company",
			"base_grand_total",
			"status",
			"docstatus",
			"skip_delivery_note",
		],
		order_by="transaction_date desc, name desc",
		distinct=True,
		limit_page_length=0,
	)


def get_order_items(names: list[str]) -> dict[str, list]:
	soi = frappe.qb.DocType("Sales Order Item")
	items = {}
	for chunk in chunked(names):
		rows = (
			frappe.qb.from_(soi)
			.select(soi.name, soi.parent, soi.qty, soi.delivered_qty, soi.delivery_date)
			.where(soi.parenttype == "Sales Order")
			.where(soi.parent.isin(chunk))
			.run(as_dict=True)
		)
		for row in rows:
			items.setdefault(row.parent, []).append(row)
	return items


def get_invoiced_qty_by_item(names: list[str]) -> dict[str, dict]:
	"""Return submitted (net of credit notes) and draft invoiced qty per Sales Order Item."""
	sii = frappe.qb.DocType("Sales Invoice Item")
	submitted = Sum(Case().when(sii.docstatus == 1, sii.qty).else_(0))
	draft = Sum(Case().when(sii.docstatus == 0, sii.qty).else_(0))
	invoiced = {}
	for chunk in chunked(names):
		rows = (
			frappe.qb.from_(sii)
			.select(sii.so_detail, submitted.as_("submitted_qty"), draft.as_("draft_qty"))
			.where(sii.parenttype == "Sales Invoice")
			.where(sii.sales_order.isin(chunk))
			.where(sii.so_detail.isnotnull())
			.where(sii.docstatus < 2)
			.groupby(sii.so_detail)
			.run(as_dict=True)
		)
		invoiced.update({row.so_detail: row for row in rows})
	return invoiced


def get_linked_invoices(names: list[str]) -> dict[str, list]:
	"""Return every Sales Invoice (draft, submitted, cancelled) per Sales Order with its qty for that order."""
	si = frappe.qb.DocType("Sales Invoice")
	sii = frappe.qb.DocType("Sales Invoice Item")
	invoices = {}
	for chunk in chunked(names):
		rows = (
			frappe.qb.from_(sii)
			.inner_join(si)
			.on(si.name == sii.parent)
			.select(
				sii.sales_order,
				si.name,
				si.docstatus,
				si.status,
				si.is_return,
				si.posting_date,
				si.grand_total,
				si.outstanding_amount,
				si.currency,
				Sum(sii.qty).as_("qty"),
			)
			.where(sii.parenttype == "Sales Invoice")
			.where(sii.sales_order.isin(chunk))
			.groupby(sii.sales_order, si.name)
			.orderby(si.posting_date)
			.orderby(si.name)
			.run(as_dict=True)
		)
		for row in rows:
			invoices.setdefault(row.sales_order, []).append(row)
	return invoices


def get_linked_delivery_notes(names: list[str]) -> dict[str, list]:
	"""Return every Delivery Note (draft, submitted, cancelled) per Sales Order with its qty for that order."""
	dn = frappe.qb.DocType("Delivery Note")
	dni = frappe.qb.DocType("Delivery Note Item")
	delivery_notes = {}
	for chunk in chunked(names):
		rows = (
			frappe.qb.from_(dni)
			.inner_join(dn)
			.on(dn.name == dni.parent)
			.select(
				dni.against_sales_order.as_("sales_order"),
				dn.name,
				dn.docstatus,
				dn.status,
				dn.is_return,
				dn.posting_date,
				Sum(dni.qty).as_("qty"),
			)
			.where(dni.parenttype == "Delivery Note")
			.where(dni.against_sales_order.isin(chunk))
			.groupby(dni.against_sales_order, dn.name)
			.orderby(dn.posting_date)
			.orderby(dn.name)
			.run(as_dict=True)
		)
		for row in rows:
			delivery_notes.setdefault(row.sales_order, []).append(row)
	return delivery_notes


def get_company_currencies(companies: set[str]) -> dict[str, str]:
	return dict(
		frappe.get_all(
			"Company",
			filters={"name": ["in", list(companies)]},
			fields=["name", "default_currency"],
			as_list=True,
		)
	)


def build_row(order, items, invoiced, invoices, delivery_notes, currency, show_all_invoices) -> dict:
	precision = frappe.get_precision("Sales Order Item", "qty") or 2
	is_cancelled = order.docstatus == 2
	is_closed = order.status == "Closed"

	ordered = delivered = pending_delivery = invoiced_qty = pending_invoice = draft_qty = 0.0
	oldest_pending_date = None
	for item in items:
		item_invoiced = invoiced.get(item.name) or {}
		submitted_qty = flt(item_invoiced.get("submitted_qty"))
		item_pending_delivery = max(flt(item.qty) - flt(item.delivered_qty), 0)

		ordered += flt(item.qty)
		delivered += flt(item.delivered_qty)
		pending_delivery += item_pending_delivery
		invoiced_qty += submitted_qty
		pending_invoice += max(flt(item.qty) - submitted_qty, 0)
		draft_qty += flt(item_invoiced.get("draft_qty"))

		if flt(item_pending_delivery, precision) > 0 and item.delivery_date:
			if not oldest_pending_date or item.delivery_date < oldest_pending_date:
				oldest_pending_date = item.delivery_date

	if is_cancelled:
		# A cancelled order expects nothing more, so nothing is pending.
		pending_delivery = pending_invoice = 0

	has_draft_invoice = any(inv.docstatus == 0 for inv in invoices)
	row = frappe._dict(
		sales_order=order.name,
		customer=order.customer,
		customer_name=order.customer_name,
		transaction_date=order.transaction_date,
		delivery_date=order.delivery_date,
		company=order.company,
		order_value=flt(order.base_grand_total),
		currency=currency,
		ordered_qty=flt(ordered, precision),
		delivered_qty=flt(delivered, precision),
		pending_delivery_qty=flt(pending_delivery, precision),
		invoiced_qty=flt(invoiced_qty, precision),
		pending_invoice_qty=flt(pending_invoice, precision),
		draft_invoice_qty=flt(draft_qty, precision),
		sales_order_status=_("Cancelled") if is_cancelled else order.status,
		has_draft_invoice=cint(has_draft_invoice),
	)

	row.delivery_status = get_delivery_status(row, is_cancelled, is_closed, cint(order.skip_delivery_note))
	row.invoice_status = get_invoice_status(row, is_cancelled, is_closed, has_draft_invoice)
	row.fulfilment_status = get_fulfilment_status(row, is_cancelled, is_closed)

	row.days_overdue = 0
	if row.delivery_status in DELIVERY_PENDING and oldest_pending_date:
		row.days_overdue = max(date_diff(today(), oldest_pending_date), 0)

	visible_invoices = [inv for inv in invoices if show_all_invoices or inv.docstatus != 2]
	row.sales_invoices = format_references(visible_invoices)
	row.delivery_notes = format_references(delivery_notes)
	row.invoice_refs = json.dumps([get_reference(inv) for inv in visible_invoices], default=str)
	row.delivery_note_refs = json.dumps([get_reference(dn) for dn in delivery_notes], default=str)

	return row


def get_delivery_status(row, is_cancelled, is_closed, skip_delivery_note) -> str:
	if is_cancelled:
		return "Cancelled"
	if skip_delivery_note:
		return "Not Applicable"
	if row.pending_delivery_qty <= 0:
		return "Fully Delivered"
	if is_closed:
		return "Closed"
	if row.delivered_qty > 0:
		return "Partly Delivered"
	return "Not Delivered"


def get_invoice_status(row, is_cancelled, is_closed, has_draft_invoice) -> str:
	if is_cancelled:
		return "Cancelled"
	if row.pending_invoice_qty <= 0:
		return "Fully Invoiced"
	if is_closed:
		return "Closed"
	if row.invoiced_qty > 0:
		return "Partly Invoiced"
	if has_draft_invoice:
		return "Draft Invoice"
	return "Not Invoiced"


def get_fulfilment_status(row, is_cancelled, is_closed) -> str:
	delivery_done = row.delivery_status in DELIVERY_DONE
	if is_cancelled:
		return "Cancelled"
	if delivery_done and row.invoice_status == "Fully Invoiced":
		return "Fully Completed"
	if is_closed:
		return "Closed"
	if delivery_done:
		return DELIVERED_INVOICE_PENDING
	if row.delivery_status == "Partly Delivered":
		return "Partially Delivered"
	return "Not Delivered"


def get_reference(doc) -> dict:
	"""Return the fields the report shows for a linked invoice or delivery note."""
	reference = {
		"name": doc.name,
		"docstatus": doc.docstatus,
		"state": get_document_state(doc.docstatus),
		"status": doc.status,
		"is_return": doc.is_return,
		"posting_date": doc.posting_date,
		"qty": flt(doc.qty),
	}
	if "grand_total" in doc:
		reference.update(
			grand_total=flt(doc.grand_total),
			outstanding_amount=flt(doc.outstanding_amount) if doc.docstatus == 1 else None,
			currency=doc.currency,
		)
	return reference


def get_document_state(docstatus: int) -> str:
	return ("Draft", "Submitted", "Cancelled")[docstatus]


def format_references(docs: list) -> str:
	"""Plain text used for export and search, for example `SINV-0001 (Submitted), SINV-0002 (Draft)`."""
	return ", ".join(
		"{} ({}{})".format(doc.name, get_document_state(doc.docstatus), ", Return" if doc.is_return else "")
		for doc in docs
	)


def apply_status_filters(data: list[dict], filters: dict) -> list[dict]:
	"""Filter on calculated values. Runs after the calculation, so it never changes a row's values."""
	if filters.fulfilment_status:
		data = [row for row in data if row.fulfilment_status == filters.fulfilment_status]
	if filters.delivery_status:
		data = [row for row in data if row.delivery_status == filters.delivery_status]
	if filters.invoice_status:
		data = [row for row in data if row.invoice_status == filters.invoice_status]
	if cint(filters.overdue_only):
		data = [row for row in data if row.days_overdue > 0]
	if cint(filters.pending_delivery_only):
		data = [row for row in data if row.delivery_status in DELIVERY_PENDING]
	if cint(filters.pending_invoice_only):
		data = [row for row in data if row.invoice_status in INVOICE_PENDING]
	if cint(filters.draft_invoice_only):
		data = [row for row in data if row.has_draft_invoice]
	return data


def paginate(data: list[dict], filters: dict) -> list[dict]:
	"""Return the first `page_length` rows. No page length means all rows."""
	page_length = cint(filters.page_length)
	return data[:page_length] if page_length else data


def get_report_summary(data: list[dict]) -> list[dict]:
	"""Summary cards. Each count is of Sales Order rows, so linked documents can not inflate it.
	The cards cover all matching rows, not only the current page.

	The JS uses `drilldown` to apply the matching filters when a card is clicked.
	"""
	currencies = {row.currency for row in data}
	order_value = sum(row.order_value for row in data if row.fulfilment_status != "Cancelled")

	def count(condition):
		return sum(1 for row in data if condition(row))

	return [
		{
			"key": "total_sales_orders",
			"label": _("Total Sales Orders"),
			"value": len(data),
			"datatype": "Int",
			"indicator": "Blue",
			"drilldown": {},
		},
		{
			"label": _("Total Order Value (excl. Cancelled)"),
			"value": order_value,
			"datatype": "Currency" if len(currencies) == 1 else "Float",
			"currency": next(iter(currencies)) if len(currencies) == 1 else None,
			"indicator": "Blue",
		},
		{
			"label": _("Fully Completed"),
			"value": count(lambda row: row.fulfilment_status == "Fully Completed"),
			"datatype": "Int",
			"indicator": "Green",
			"drilldown": {"fulfilment_status": "Fully Completed"},
		},
		{
			"label": _("Pending Delivery"),
			"value": count(lambda row: row.delivery_status in DELIVERY_PENDING),
			"datatype": "Int",
			"indicator": "Orange",
			"drilldown": {"pending_delivery_only": 1},
		},
		{
			"label": _("Pending Invoice"),
			"value": count(lambda row: row.invoice_status in INVOICE_PENDING),
			"datatype": "Int",
			"indicator": "Orange",
			"drilldown": {"pending_invoice_only": 1},
		},
		{
			"label": _("Partially Delivered"),
			"value": count(lambda row: row.delivery_status == "Partly Delivered"),
			"datatype": "Int",
			"indicator": "Yellow",
			"drilldown": {"delivery_status": "Partly Delivered"},
		},
		{
			"label": _("With Draft Invoices"),
			"value": count(lambda row: row.has_draft_invoice),
			"datatype": "Int",
			"indicator": "Orange",
			"drilldown": {"draft_invoice_only": 1},
		},
		{
			"label": _("Overdue Deliveries"),
			"value": count(lambda row: row.days_overdue > 0),
			"datatype": "Int",
			"indicator": "Red",
			"drilldown": {"overdue_only": 1},
		},
		{
			"label": _("Closed"),
			"value": count(lambda row: row.fulfilment_status == "Closed"),
			"datatype": "Int",
			"indicator": "Grey",
			"drilldown": {"fulfilment_status": "Closed"},
		},
		{
			"label": _("Cancelled"),
			"value": count(lambda row: row.fulfilment_status == "Cancelled"),
			"datatype": "Int",
			"indicator": "Grey",
			"drilldown": {"fulfilment_status": "Cancelled"},
		},
	]


def chunked(names: list[str]):
	for start in range(0, len(names), CHUNK_SIZE):
		yield names[start : start + CHUNK_SIZE]
