import frappe
from frappe import _
from frappe.utils import cint


def _require_sales_rep():
	if frappe.session.user == "Guest":
		frappe.throw(_("Not logged in"), frappe.AuthenticationError)
	if not frappe.db.exists("Has Role", {"parent": frappe.session.user, "role": "Sales Rep"}):
		frappe.throw(_("Access Denied"), frappe.PermissionError)


@frappe.whitelist(methods=["GET"])
def get_order_history(search: str = "", limit_start: int = 0, limit_page_length: int = 20):
	_require_sales_rep()

	limit_start = cint(limit_start)
	limit_page_length = cint(limit_page_length) or 20

	filters = {"owner": frappe.session.user, "docstatus": ["!=", 2]}

	or_filters = None
	if search:
		or_filters = [
			["name", "like", f"%{search}%"],
			["customer_name", "like", f"%{search}%"],
			["customer", "like", f"%{search}%"],
		]

	orders = frappe.get_all(
		"Sales Order",
		filters=filters,
		or_filters=or_filters,
		fields=["name", "customer", "customer_name", "transaction_date", "grand_total", "status"],
		order_by="transaction_date desc, creation desc, name desc",
		limit_start=limit_start,
		limit_page_length=limit_page_length + 1,
	)

	has_more = len(orders) > limit_page_length
	orders = orders[:limit_page_length]

	if orders:
		order_names = [o["name"] for o in orders]
		items = frappe.get_all(
			"Sales Order Item",
			filters={"parent": ["in", order_names]},
			fields=["parent", "item_code", "item_name", "qty", "rate", "amount"],
			order_by="parent, idx",
		)

		by_parent = {}
		for it in items:
			by_parent.setdefault(it["parent"], []).append(it)

		for o in orders:
			o["items"] = by_parent.get(o["name"], [])

	return {"orders": orders, "has_more": has_more}
