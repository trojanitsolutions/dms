import json
import frappe
from frappe import _


def _require_delivery_partner():
	if frappe.session.user == "Guest":
		frappe.throw(_("Not logged in"), frappe.AuthenticationError)
	if not frappe.db.exists("Has Role", {"parent": frappe.session.user, "role": "Delivery Partner"}):
		frappe.throw(_("Access Denied"), frappe.PermissionError)


def _verify_assignment(doc):
	assigned = json.loads(doc._assign or "[]")
	if frappe.session.user not in assigned:
		frappe.throw(_("Access Denied"), frappe.PermissionError)


@frappe.whitelist(methods=["GET"])
def get_delivery_dashboard():
	_require_delivery_partner()
	user = frappe.session.user
	today = frappe.utils.today()
	user_json = json.dumps(user)

	pending = frappe.db.sql(
		"""SELECT COUNT(*) FROM `tabDelivery Note`
		   WHERE docstatus = 0
		     AND JSON_CONTAINS(COALESCE(NULLIF(_assign,''),'[]'), %s)""",
		(user_json,),
	)[0][0]

	in_progress = frappe.db.sql(
		"""SELECT COUNT(DISTINCT dn.name)
		   FROM `tabDelivery Note` dn
		   INNER JOIN `tabFile` f ON f.attached_to_doctype = 'Delivery Note' AND f.attached_to_name = dn.name
		   WHERE dn.docstatus = 0
		     AND JSON_CONTAINS(COALESCE(NULLIF(dn._assign,''),'[]'), %s)""",
		(user_json,),
	)[0][0]

	completed_today = frappe.db.sql(
		"""SELECT COUNT(*) FROM `tabDelivery Note`
		   WHERE docstatus = 1
		     AND DATE(modified) = %s
		     AND JSON_CONTAINS(COALESCE(NULLIF(_assign,''),'[]'), %s)""",
		(today, user_json),
	)[0][0]

	total_assigned = frappe.db.sql(
		"""SELECT COUNT(*) FROM `tabDelivery Note`
		   WHERE docstatus != 2
		     AND JSON_CONTAINS(COALESCE(NULLIF(_assign,''),'[]'), %s)""",
		(user_json,),
	)[0][0]

	recent = frappe.db.sql(
		"""SELECT name, customer_name, status, docstatus, modified
		   FROM `tabDelivery Note`
		   WHERE JSON_CONTAINS(COALESCE(NULLIF(_assign,''),'[]'), %s)
		   ORDER BY modified DESC
		   LIMIT 5""",
		(user_json,),
		as_dict=True,
	)

	return {
		"pending": int(pending or 0),
		"in_progress": int(in_progress or 0),
		"completed_today": int(completed_today or 0),
		"total_assigned": int(total_assigned or 0),
		"recent_activity": recent,
	}


@frappe.whitelist(methods=["GET"])
def get_delivery_notes(status: str = "pending"):
	_require_delivery_partner()
	user = frappe.session.user
	user_json = json.dumps(user)
	docstatus = 0 if status == "pending" else 1

	rows = frappe.db.sql(
		"""SELECT
		       dn.name,
		       dn.customer_name,
		       dn.posting_date,
		       dn.status,
		       dn.docstatus,
		       dn.shipping_address,
		       COUNT(dni.name) AS item_count,
		       COALESCE(SUM(dni.qty), 0) AS total_qty
		   FROM `tabDelivery Note` dn
		   LEFT JOIN `tabDelivery Note Item` dni ON dni.parent = dn.name
		   WHERE dn.docstatus = %(ds)s
		     AND JSON_CONTAINS(COALESCE(NULLIF(dn._assign,''),'[]'), %(uj)s)
		   GROUP BY dn.name
		   ORDER BY dn.posting_date DESC, dn.creation DESC
		   LIMIT 50""",
		{"ds": docstatus, "uj": user_json},
		as_dict=True,
	)

	return rows


@frappe.whitelist(methods=["GET"])
def get_delivery_note(name: str):
	_require_delivery_partner()

	doc = frappe.get_doc("Delivery Note", name, ignore_permissions=True)
	_verify_assignment(doc)

	
	so_detail_ids = [i.so_detail for i in doc.items if i.so_detail]
	so_qty_map = {}
	if so_detail_ids:
		rows = frappe.db.sql(
			"SELECT name, qty FROM `tabSales Order Item` WHERE name IN %(ids)s",
			{"ids": so_detail_ids},
			as_dict=True,
		)
		so_qty_map = {r.name: float(r.qty) for r in rows}

	items = []
	for item in doc.items:
		ordered_qty = so_qty_map.get(item.so_detail, float(item.qty))
		items.append({
			"name": item.name,
			"item_code": item.item_code,
			"item_name": item.item_name,
			"qty": float(item.qty),
			"ordered_qty": ordered_qty,
			"uom": item.uom or item.stock_uom or "",
			"rate": float(item.rate or 0),
			"amount": float(item.amount or 0),
			"against_sales_order": item.against_sales_order or "",
		})

	attachments = frappe.get_all(
		"File",
		filters={"attached_to_doctype": "Delivery Note", "attached_to_name": name},
		fields=["name", "file_name", "file_url", "is_private"],
		order_by="creation asc",
	)

	return {
		"name": doc.name,
		"customer": doc.customer,
		"customer_name": doc.customer_name,
		"posting_date": str(doc.posting_date),
		"status": doc.status,
		"docstatus": doc.docstatus,
		"shipping_address": doc.shipping_address or "",
		"shipping_address_name": doc.shipping_address_name or "",
		"contact_display": doc.contact_display or "",
		"contact_mobile": doc.contact_mobile or "",
		"contact_email": doc.contact_email or "",
		"instructions": doc.get("instructions") or doc.get("terms") or "",
		"items": items,
		"attachments": attachments,
		"grand_total": float(doc.grand_total or 0),
	}


@frappe.whitelist(methods=["POST"])
def save_delivery_note(name: str, items_json: str, remarks: str = ""):
	_require_delivery_partner()

	doc = frappe.get_doc("Delivery Note", name, ignore_permissions=True)

	if doc.docstatus != 0:
		frappe.throw(_("Delivery Note cannot be edited after submission"))

	_verify_assignment(doc)

	updates = json.loads(items_json)
	update_map = {u["name"]: u for u in updates}

	for item in doc.items:
		if item.name not in update_map:
			continue
		upd = update_map[item.name]
		new_qty = float(upd["qty"])
		ordered_qty = float(upd.get("ordered_qty", item.qty))
		if new_qty < 0:
			frappe.throw(_("Delivered quantity cannot be negative for {0}").format(item.item_name))
		if new_qty > ordered_qty:
			frappe.throw(
				_("Delivered quantity cannot exceed ordered quantity for {0}").format(item.item_name)
			)
		item.qty = new_qty

	if remarks:
		doc.instructions = remarks

	doc.save(ignore_permissions=True)
	return {"name": doc.name}


@frappe.whitelist(methods=["GET"])
def get_assignable_delivery_notes():
	_require_delivery_partner()
	user = frappe.session.user
	user_json = json.dumps(user)

	rows = frappe.db.sql(
		"""SELECT dn.name, dn.customer_name, dn.posting_date, dn.shipping_address,
		          COALESCE(NULLIF(dn._assign,''),'[]') AS _assign, COUNT(dni.name) AS item_count
		   FROM `tabDelivery Note` dn
		   LEFT JOIN `tabDelivery Note Item` dni ON dni.parent = dn.name
		   WHERE dn.docstatus = 0
		     AND (COALESCE(NULLIF(dn._assign,''),'[]') = '[]' OR JSON_CONTAINS(COALESCE(NULLIF(dn._assign,''),'[]'), %s))
		   GROUP BY dn.name
		   ORDER BY dn.posting_date DESC, dn.creation DESC LIMIT 100""",
		(user_json,),
		as_dict=True,
	)

	for row in rows:
		assigned = json.loads(row._assign or "[]")
		row["is_mine"] = user in assigned
		del row["_assign"]

	return rows


@frappe.whitelist(methods=["POST"])
def assign_delivery_note(name: str):
	_require_delivery_partner()
	doc = frappe.get_doc("Delivery Note", name, ignore_permissions=True)
	assigned = json.loads(doc._assign or "[]")
	if assigned:
		frappe.throw(_("This delivery note is already assigned"))
	
	
	frappe.db.set_value("Delivery Note", name, "_assign", json.dumps([frappe.session.user]), update_modified=False)
	return {"name": name}


@frappe.whitelist(methods=["POST"])
def unassign_delivery_note(name: str):
	_require_delivery_partner()
	doc = frappe.get_doc("Delivery Note", name, ignore_permissions=True)
	_verify_assignment(doc)
	remaining = [u for u in json.loads(doc._assign or "[]") if u != frappe.session.user]
	frappe.db.set_value("Delivery Note", name, "_assign", json.dumps(remaining), update_modified=False)
	return {"name": name}


@frappe.whitelist(methods=["POST"])
def submit_delivery_note(name: str):
	_require_delivery_partner()

	doc = frappe.get_doc("Delivery Note", name, ignore_permissions=True)

	if doc.docstatus != 0:
		frappe.throw(_("Delivery Note is already submitted"))

	_verify_assignment(doc)

	attachment_count = frappe.db.count(
		"File",
		{"attached_to_doctype": "Delivery Note", "attached_to_name": name},
	)
	if not attachment_count:
		frappe.throw(_("Please upload at least one proof of delivery before submitting"))

	_user = frappe.session.user
	frappe.session.user = "Administrator"
	frappe.local.role_permissions = {}
	frappe.local.user_perms = None
	try:
		doc.submit()
		_sync_invoice_qty(doc)
	finally:
		frappe.session.user = _user
		frappe.local.role_permissions = {}
		frappe.local.user_perms = None

	return {"name": doc.name}


def _sync_invoice_qty(dn_doc):
	
	delivered = {item.so_detail: item.qty for item in dn_doc.items if item.so_detail}
	if not delivered:
		return

	# Find draft Sales Invoices that have items referencing these SO detail rows
	si_items = frappe.db.sql(
		"""SELECT sii.parent, sii.name, sii.so_detail, sii.qty, sii.rate
		   FROM `tabSales Invoice Item` sii
		   INNER JOIN `tabSales Invoice` si ON si.name = sii.parent
		   WHERE si.docstatus = 0
		     AND sii.so_detail IN %(ids)s""",
		{"ids": list(delivered.keys())},
		as_dict=True,
	)

	# Group by SI
	si_map = {}
	for row in si_items:
		si_map.setdefault(row.parent, []).append(row)

	for si_name, rows in si_map.items():
		si = frappe.get_doc("Sales Invoice", si_name)
		changed = False
		for si_item in si.items:
			if si_item.so_detail in delivered:
				new_qty = delivered[si_item.so_detail]
				if si_item.qty != new_qty:
					si_item.qty = new_qty
					changed = True
		if changed:
			si.run_method("calculate_taxes_and_totals")
			si.save(ignore_permissions=True)
		si.submit()
