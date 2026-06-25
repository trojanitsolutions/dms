import frappe


def get_context(context):
    context.no_cache = 1
    _require_sales_rep()
    context.full_name = frappe.db.get_value("User", frappe.session.user, "full_name") or frappe.session.user
    context.customer = frappe.request.args.get("customer", "")
    if context.customer:
        context.customer_name = frappe.db.get_value("Customer", context.customer, "customer_name") or ""
    else:
        context.customer_name = ""


def _require_sales_rep():
    if frappe.session.user == "Guest":
        frappe.local.flags.redirect_location = "/sales-login"
        raise frappe.Redirect
    if not frappe.db.exists("Has Role", {"parent": frappe.session.user, "role": "Sales Rep"}):
        frappe.local.flags.redirect_location = "/desk?route=List/Sales Order&error=access-denied"
        raise frappe.Redirect
