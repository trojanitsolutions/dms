import frappe


def get_context(context):
    context.no_cache = 1
    if frappe.session.user != "Guest":
        if frappe.db.exists("Has Role", {"parent": frappe.session.user, "role": "Sales Rep"}):
            frappe.local.flags.redirect_location = "/sales-home"
            raise frappe.Redirect
    context.error = frappe.request.args.get("error", "")
