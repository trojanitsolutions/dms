import frappe
from frappe.utils import flt


def create_draft_si_from_so(so_doc, method=None):
	"""Sales Order.on_submit → create a Draft SI with qty=0 for all items."""
	try:
		existing = frappe.db.sql(
			"""SELECT sii.parent FROM `tabSales Invoice Item` sii
			   INNER JOIN `tabSales Invoice` si ON si.name = sii.parent
			   WHERE sii.sales_order = %s AND si.docstatus = 0 LIMIT 1""",
			so_doc.name,
		)
		if existing:
			return

		from erpnext.selling.doctype.sales_order.sales_order import make_sales_invoice

		si = make_sales_invoice(so_doc.name, ignore_permissions=True)
		for item in si.items:
			item.qty = 0
			item.stock_qty = 0
			item.amount = 0
			item.base_amount = 0
		si.run_method("calculate_taxes_and_totals")
		si.flags.ignore_permissions = True
		si.insert()
		frappe.logger().info(f"DMS: Draft SI {si.name} created for SO {so_doc.name}")
	except Exception:
		frappe.log_error(frappe.get_traceback(), f"DMS: Draft SI creation failed for SO {so_doc.name}")


def sync_si_on_dn_submit(dn_doc, method=None):
	"""Delivery Note.on_submit → update Draft SI quantities; submit SI if fully delivered."""
	so_names = list({item.against_sales_order for item in dn_doc.items if item.against_sales_order})
	if not so_names:
		return
	for so_name in so_names:
		try:
			_sync_si_for_so(so_name)
		except Exception:
			frappe.log_error(frappe.get_traceback(), f"DMS: SI sync failed for SO {so_name} on DN {dn_doc.name}")


def _sync_si_for_so(so_name):
	rows = frappe.db.sql(
		"""SELECT sii.parent FROM `tabSales Invoice Item` sii
		   INNER JOIN `tabSales Invoice` si ON si.name = sii.parent
		   WHERE sii.sales_order = %s AND si.docstatus = 0 LIMIT 1""",
		so_name,
	)
	if not rows:
		frappe.logger().info(f"DMS: No Draft SI for SO {so_name}, skipping")
		return

	si = frappe.get_doc("Sales Invoice", rows[0][0])

	so_detail_ids = [item.so_detail for item in si.items if item.so_detail]
	if not so_detail_ids:
		return

	delivered_rows = frappe.db.sql(
		"""SELECT so_detail, SUM(qty) AS total_qty
		   FROM `tabDelivery Note Item`
		   WHERE so_detail IN %(ids)s AND docstatus = 1
		   GROUP BY so_detail""",
		{"ids": so_detail_ids},
		as_dict=True,
	)
	delivered_map = {r.so_detail: flt(r.total_qty) for r in delivered_rows}

	so_qty_rows = frappe.db.sql(
		"SELECT name, qty FROM `tabSales Order Item` WHERE name IN %(ids)s",
		{"ids": so_detail_ids},
		as_dict=True,
	)
	so_qty_map = {r.name: flt(r.qty) for r in so_qty_rows}

	fully_delivered = True
	for item in si.items:
		if not item.so_detail:
			continue
		delivered = delivered_map.get(item.so_detail, 0.0)
		so_qty = so_qty_map.get(item.so_detail, 0.0)

		if delivered > so_qty:
			frappe.throw(
				f"Delivered qty ({delivered}) exceeds SO qty ({so_qty}) for item {item.item_code}"
			)

		item.qty = delivered
		item.stock_qty = flt(delivered * flt(item.conversion_factor or 1))
		item.amount = flt(delivered * flt(item.rate))
		item.base_amount = flt(item.amount * flt(si.conversion_rate or 1))

		if delivered < so_qty:
			fully_delivered = False

	si.run_method("calculate_taxes_and_totals")
	si.flags.ignore_permissions = True
	si.save()

	if fully_delivered:
		si.flags.ignore_permissions = True
		si.submit()
		frappe.logger().info(f"DMS: SI {si.name} submitted (full delivery) for SO {so_name}")
	else:
		frappe.logger().info(f"DMS: SI {si.name} updated (partial delivery) for SO {so_name}")
