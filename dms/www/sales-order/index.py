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
    context.company_logo = _get_company_logo()


def _require_sales_rep():
    if frappe.session.user == "Guest":
        frappe.local.flags.redirect_location = "/sales-login"
        raise frappe.Redirect
    if not frappe.db.exists("Has Role", {"parent": frappe.session.user, "role": "Sales Rep"}):
        frappe.local.flags.redirect_location = "/desk?route=List/Sales Order&error=access-denied"
        raise frappe.Redirect


def _get_company_logo():
    company = _get_default_company()
    if not company:
        return None
    logo = frappe.db.get_value("Company", company, "company_logos")
    return logo or None


def _get_default_company():
    company = frappe.defaults.get_user_default("company") or frappe.defaults.get_global_default("company")
    if not company:
        company = frappe.db.get_single_value("Global Defaults", "default_company")
    return company or ""
