# Copyright (c) 2026, Trojan Technologies and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt, getdate, nowdate


def execute(filters: dict | None = None):
	"""Return columns and data for the report.

	This is the main entry point for the report. It accepts the filters as a
	dictionary and should return columns and data. It is called by the framework
	every time the report is refreshed or a filter is updated.
	"""
	columns = get_columns()
	data, report_summary = get_data(filters or {})

	return columns, data, None, None, report_summary

def execute_snapshot_report(filters: dict | None = None):
	"""Return columns and data for the report.

	This is the main entry point for snapshot report. When 'Synced
	Report' is enabled in report, framework will call this method
	every time the report is refreshed or a filter is updated. It
	accepts the same filters as normal execute. But a utility method -
	get_latest_sync, is also imported.

	"""
	from frappe.database.duckdb.database import get_latest_sync

	columns = get_columns()
	data, report_summary = get_data(filters or {})

	return columns, data, None, None, report_summary

def get_report_summary(total_sales_amount: float, total_orders: int):
	"""Build summary cards for the report."""
	currency = frappe.db.get_default("currency")
	return [
		{
			"label": _("Total Sales Amount"),
			"value": total_sales_amount,
			"datatype": "Currency",
			"currency": currency,
		},
		{
			"label": _("Total Orders"),
			"value": total_orders,
			"datatype": "Int",
		},
	]

def get_columns() -> list[dict]:
	"""Return columns for the report.

	One field definition per column, just like a DocType field definition.
	"""
	return [
		{
			"label": _("Sales Order"),
			"fieldname": "sales_order",
			"fieldtype": "Link",
			"options": "Sales Order",
			"width": 150,
		},
		{
			"label": _("Sales Order Status"),
			"fieldname": "so_status",
			"fieldtype": "Data",
			"width": 130,
		},
		{
			"label": _("Item Code"),
			"fieldname": "item_code",
			"fieldtype": "Link",
			"options": "Item",
			"width": 150,
		},
		{
			"label": _("Item Name"),
			"fieldname": "item_name",
			"fieldtype": "Data",
			"width": 200,
		},
		{
			"label": _("Warehouse"),
			"fieldname": "warehouse",
			"fieldtype": "Link",
			"options": "Warehouse",
			"width": 150,
		},
		{
			"label": _("Actual Stock Qty"),
			"fieldname": "actual_stock_qty",
			"fieldtype": "Float",
			"precision": 2,
			"width": 130,
		},
		{
			"label": _("Open Sales Order Qty"),
			"fieldname": "open_so_qty",
			"fieldtype": "Float",
			"precision": 2,
			"width": 150,
		},
		{
			"label": _("Available Qty"),
			"fieldname": "available_qty",
			"fieldtype": "Float",
			"precision": 2,
			"width": 130,
		},
		{
			"label": _("Total Amount"),
			"fieldname": "grand_total",
			"fieldtype": "Currency",
			"precision": 2,
			"width": 130,
		},
	]


def get_data(filters: dict) -> list[dict]:
	"""Return data for the report.

	Calculates Available Qty = Actual Stock Qty - Open Sales Order Qty.
	Actual stock is from tabBin (live). Open SOs are from submitted Sales Orders only.
	Returns rows grouped by Sales Order (tree structure with indent).
	"""
	# Query A: live actual stock from tabBin
	bin_rows = frappe.db.sql(
		"""SELECT item_code, warehouse, actual_qty
		   FROM `tabBin`
		   WHERE actual_qty != 0""",
		as_dict=True,
	)
	bin_map = {(r.item_code, r.warehouse): flt(r.actual_qty) for r in bin_rows}

	# Query B: aggregated open qty per item_code/warehouse for total calculation
	agg_rows = frappe.db.sql(
		"""SELECT soi.item_code, soi.warehouse,
		          SUM(GREATEST(COALESCE(soi.qty, 0) - COALESCE(soi.delivered_qty, 0), 0)
		              * COALESCE(soi.conversion_factor, 1)) AS total_open_qty
		   FROM `tabSales Order Item` soi
		   INNER JOIN `tabSales Order` so ON so.name = soi.parent
		   WHERE so.docstatus = 1
		     AND soi.item_code IS NOT NULL
		     AND soi.warehouse IS NOT NULL
		   GROUP BY soi.item_code, soi.warehouse""",
		as_dict=True,
	)
	agg_map = {(r.item_code, r.warehouse): flt(r.total_open_qty) for r in agg_rows}

	# Query C: individual SO lines with pending qty (one row per SO)
	so_rows = frappe.db.sql(
		"""SELECT soi.parent AS sales_order,
		          so.status AS so_status,
		          so.transaction_date,
		          so.grand_total,
		          soi.item_code,
		          soi.warehouse,
		          GREATEST(COALESCE(soi.qty, 0) - COALESCE(soi.delivered_qty, 0), 0)
		          * COALESCE(soi.conversion_factor, 1) AS open_so_qty
		   FROM `tabSales Order Item` soi
		   INNER JOIN `tabSales Order` so ON so.name = soi.parent
		   WHERE so.docstatus = 1
		     AND soi.item_code IS NOT NULL
		     AND soi.warehouse IS NOT NULL
		     AND GREATEST(COALESCE(soi.qty, 0) - COALESCE(soi.delivered_qty, 0), 0)
		         * COALESCE(soi.conversion_factor, 1) > 0
		   ORDER BY soi.parent, soi.item_code, soi.warehouse""",
		as_dict=True,
	)

	# Query D: resolve item names in bulk
	item_codes = {r.item_code for r in so_rows}
	item_names = {}
	if item_codes:
		item_rows = frappe.db.sql(
			"""SELECT name, item_name
			   FROM `tabItem`
			   WHERE name IN %(codes)s""",
			{"codes": list(item_codes)},
			as_dict=True,
		)
		item_names = {r.name: r.item_name for r in item_rows}

	# Group rows by Sales Order, apply filters, build tree structure
	so_groups = {}
	for row in so_rows:
		sales_order = row.sales_order
		so_status = row.so_status
		item_code = row.item_code
		warehouse = row.warehouse
		open_so_qty = flt(row.open_so_qty)

		# Group-level filter: skip entire SO if it doesn't match filters
		if filters.get("sales_order") and sales_order != filters["sales_order"]:
			continue
		if filters.get("so_status") and so_status != filters["so_status"]:
			continue

		# Date filter: skip based on transaction_date
		if filters.get("today"):
			if getdate(row.transaction_date) != getdate(nowdate()):
				continue
		else:
			if filters.get("from_date") and getdate(row.transaction_date) < getdate(filters["from_date"]):
				continue
			if filters.get("to_date") and getdate(row.transaction_date) > getdate(filters["to_date"]):
				continue

		# Row-level filter: skip item rows if they don't match filters
		if filters.get("item_code") and item_code != filters["item_code"]:
			continue
		if filters.get("warehouse") and warehouse != filters["warehouse"]:
			continue

		# Initialize SO group if not seen yet
		if sales_order not in so_groups:
			so_groups[sales_order] = {"so_status": so_status, "grand_total": row.grand_total, "items": []}

		# Get actual stock and total open qty for this item/warehouse combo
		actual_qty = bin_map.get((item_code, warehouse), 0.0)
		total_open_qty = agg_map.get((item_code, warehouse), 0.0)
		available_qty = actual_qty - total_open_qty

		so_groups[sales_order]["items"].append({
			"item_code": item_code,
			"item_name": item_names.get(item_code) or item_code,
			"warehouse": warehouse,
			"sales_order": None,
			"so_status": None,
			"actual_stock_qty": actual_qty,
			"open_so_qty": open_so_qty,
			"available_qty": available_qty,
			"grand_total": row.grand_total,
		})

	# Build flat list with tree structure (indent: 0 for parent, 1 for children)
	data = []
	for sales_order in sorted(so_groups.keys()):
		group = so_groups[sales_order]
		so_status = group["so_status"]
		items = group["items"]

		# Only emit group if it has items after filtering
		if not items:
			continue

		# Parent row (SO group header)
		data.append({
			"sales_order": sales_order,
			"so_status": so_status,
			"item_code": None,
			"item_name": None,
			"warehouse": None,
			"actual_stock_qty": None,
			"open_so_qty": None,
			"available_qty": None,
			"grand_total": group["grand_total"],
			"indent": 0,
		})

		# Child rows (items in this SO)
		for item in items:
			item["indent"] = 1
			data.append(item)

	total_sales_amount = sum(flt(g["grand_total"]) for g in so_groups.values())
	total_orders = len(so_groups)
	report_summary = get_report_summary(total_sales_amount, total_orders)

	return data, report_summary
