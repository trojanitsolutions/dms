import frappe


def get_context(context):
	context.no_cache = 1
	_require_delivery_partner()
	context.dn_name = frappe.request.args.get("name", "")
	context.full_name = frappe.db.get_value("User", frappe.session.user, "full_name") or frappe.session.user


def _require_delivery_partner():
	if frappe.session.user == "Guest":
		frappe.local.flags.redirect_location = "/delivery-login"
		raise frappe.Redirect
	if not frappe.db.exists("Has Role", {"parent": frappe.session.user, "role": "Delivery Partner"}):
		frappe.local.flags.redirect_location = "/delivery-login?error=access-denied"
		raise frappe.Redirect
