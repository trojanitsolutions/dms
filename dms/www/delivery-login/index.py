import frappe


def get_context(context):
	context.no_cache = 1
	if frappe.session.user != "Guest":
		if frappe.db.exists("Has Role", {"parent": frappe.session.user, "role": "Delivery Partner"}):
			frappe.local.flags.redirect_location = "/delivery-dashboard"
			raise frappe.Redirect
	context.error = frappe.request.args.get("error", "")
