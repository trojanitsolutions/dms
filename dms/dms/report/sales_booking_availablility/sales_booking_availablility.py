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


def _get_bin_map() -> dict:
	"""Query A: live actual stock from tabBin."""
	bin_rows = frappe.db.sql(
		"""SELECT item_code, warehouse, actual_qty
		   FROM `tabBin`
		   WHERE actual_qty != 0""",
		as_dict=True,
	)
	return {(r.item_code, r.warehouse): flt(r.actual_qty) for r in bin_rows}


def _get_agg_map() -> dict:
	"""Query B: aggregated open qty per item_code/warehouse."""
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
	return {(r.item_code, r.warehouse): flt(r.total_open_qty) for r in agg_rows}


def _get_so_lines() -> list[dict]:
	"""Query C: individual SO lines with pending qty."""
	return frappe.db.sql(
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


def _get_item_names(so_rows: list[dict]) -> dict:
	"""Query D: resolve item names in bulk."""
	item_codes = {r.item_code for r in so_rows}
	if not item_codes:
		return {}
	item_rows = frappe.db.sql(
		"""SELECT name, item_name
		   FROM `tabItem`
		   WHERE name IN %(codes)s""",
		{"codes": list(item_codes)},
		as_dict=True,
	)
	return {r.name: r.item_name for r in item_rows}


def _build_leaf_rows(so_rows: list[dict], filters: dict, bin_map: dict, agg_map: dict, item_names: dict) -> list[dict]:
	"""Build flat list of filtered leaf rows with qty calculations."""
	leaves = []
	for row in so_rows:
		sales_order = row.sales_order
		so_status = row.so_status
		item_code = row.item_code
		warehouse = row.warehouse
		open_so_qty = flt(row.open_so_qty)

		if filters.get("sales_order") and sales_order != filters["sales_order"]:
			continue
		if filters.get("so_status") and so_status != filters["so_status"]:
			continue

		if filters.get("today"):
			if getdate(row.transaction_date) != getdate(nowdate()):
				continue
		else:
			if filters.get("from_date") and getdate(row.transaction_date) < getdate(filters["from_date"]):
				continue
			if filters.get("to_date") and getdate(row.transaction_date) > getdate(filters["to_date"]):
				continue

		if filters.get("item_code") and item_code != filters["item_code"]:
			continue
		if filters.get("warehouse") and warehouse != filters["warehouse"]:
			continue

		actual_qty = bin_map.get((item_code, warehouse), 0.0)
		total_open_qty = agg_map.get((item_code, warehouse), 0.0)
		available_qty = actual_qty - total_open_qty

		leaves.append({
			"sales_order": sales_order,
			"so_status": so_status,
			"grand_total": row.grand_total,
			"item_code": item_code,
			"item_name": item_names.get(item_code) or item_code,
			"warehouse": warehouse,
			"open_so_qty": open_so_qty,
			"actual_stock_qty": actual_qty,
			"available_qty": available_qty,
		})

	return leaves


def _build_so_groups(leaf_rows: list[dict]) -> dict:
	"""Group leaf rows by sales_order."""
	groups = {}
	for leaf in leaf_rows:
		so = leaf["sales_order"]
		if so not in groups:
			groups[so] = {
				"so_status": leaf["so_status"],
				"grand_total": leaf["grand_total"],
				"items": [],
			}
		groups[so]["items"].append(leaf)
	return groups


def _build_so_tree(so_groups: dict) -> list[dict]:
	"""Build SO-grouped tree structure (default grouping)."""
	data = []
	for sales_order in sorted(so_groups.keys()):
		group = so_groups[sales_order]
		so_status = group["so_status"]
		items = group["items"]

		if not items:
			continue

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

		for item in items:
			item_copy = item.copy()
			item_copy["sales_order"] = None
			item_copy["so_status"] = None
			item_copy["indent"] = 1
			data.append(item_copy)

	return data


def _group_leaves_by_item(leaf_rows: list[dict]) -> dict:
	"""Group leaf rows by item_code.

	Returns {item_code: {item_name, warehouses: {warehouse: leaf}, leaves: [...]}}
	Used by _build_item_tree and get_item_grouped_map to organize leaves by item.
	"""
	item_groups = {}
	for leaf in leaf_rows:
		ic = leaf["item_code"]
		wh = leaf["warehouse"]
		if ic not in item_groups:
			item_groups[ic] = {
				"item_name": leaf["item_name"],
				"warehouses": {},
				"leaves": [],
			}
		if wh not in item_groups[ic]["warehouses"]:
			item_groups[ic]["warehouses"][wh] = leaf
		item_groups[ic]["leaves"].append(leaf)
	return item_groups


def _build_item_tree(leaf_rows: list[dict]) -> list[dict]:
	"""Build item-grouped tree structure."""
	item_groups = _group_leaves_by_item(leaf_rows)

	data = []
	for item_code in sorted(item_groups.keys()):
		group = item_groups[item_code]
		item_name = group["item_name"]
		warehouses = group["warehouses"]
		leaves = group["leaves"]

		actual_stock_qty = sum(flt(wh_leaf["actual_stock_qty"]) for wh_leaf in warehouses.values())
		available_qty = sum(flt(wh_leaf["available_qty"]) for wh_leaf in warehouses.values())
		open_so_qty = sum(flt(leaf["open_so_qty"]) for leaf in leaves)

		data.append({
			"item_code": item_code,
			"item_name": item_name,
			"sales_order": None,
			"so_status": None,
			"warehouse": None,
			"actual_stock_qty": actual_stock_qty,
			"open_so_qty": open_so_qty,
			"available_qty": available_qty,
			"grand_total": None,
			"indent": 0,
		})

		for leaf in leaves:
			leaf_copy = leaf.copy()
			leaf_copy["item_code"] = None
			leaf_copy["item_name"] = None
			leaf_copy["actual_stock_qty"] = None
			leaf_copy["available_qty"] = None
			leaf_copy["indent"] = 1
			data.append(leaf_copy)

	return data


def get_item_grouped_map(filters: dict | None = None) -> dict:
	"""Return {(item_code, warehouse): available_qty}, grouped by item.

	Filters items with an open Sales Booking Availability entry (presence in
	_get_so_lines). Absence of a key means the item has no open-SO booking there
	— caller should fall back to Bin.

	This is the non-lossy API for item-grouped availability that sales.py calls.
	"""
	filters = filters or {}
	bin_map = _get_bin_map()
	agg_map = _get_agg_map()
	so_rows = _get_so_lines()
	item_names = _get_item_names(so_rows)

	leaf_rows = _build_leaf_rows(so_rows, filters, bin_map, agg_map, item_names)
	item_groups = _group_leaves_by_item(leaf_rows)

	return {
		(item_code, wh): flt(leaf["available_qty"])
		for item_code, group in item_groups.items()
		for wh, leaf in group["warehouses"].items()
	}


def get_data(filters: dict) -> tuple[list[dict], list[dict]]:
	"""Return data for the report.

	Supports two grouping modes:
	- Default (group_by_item=False): Sales Order grouping
	- Item (group_by_item=True): Item Code grouping

	Calculations remain identical; only tree structure changes.
	"""
	bin_map = _get_bin_map()
	agg_map = _get_agg_map()
	so_rows = _get_so_lines()
	item_names = _get_item_names(so_rows)

	leaf_rows = _build_leaf_rows(so_rows, filters, bin_map, agg_map, item_names)
	so_groups = _build_so_groups(leaf_rows)

	if filters.get("group_by_item"):
		data = _build_item_tree(leaf_rows)
	else:
		data = _build_so_tree(so_groups)

	total_sales_amount = sum(flt(g["grand_total"]) for g in so_groups.values())
	total_orders = len(so_groups)
	report_summary = get_report_summary(total_sales_amount, total_orders)

	return data, report_summary
