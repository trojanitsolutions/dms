import frappe


def get_context(context):
    context.no_cache = 1
    if frappe.session.user != "Guest":
        if frappe.db.exists("Has Role", {"parent": frappe.session.user, "role": "Sales Rep"}):
            frappe.local.flags.redirect_location = "/sales-home"
            raise frappe.Redirect
    context.error = frappe.request.args.get("error", "")
    context.company_logo = _get_company_logo()


def _get_company_logo():
    company = _get_default_company()
    if not company:
        return None
    logo = frappe.db.get_value("Company", company, "company_logo")
    return logo or None


def _get_default_company():
    company = frappe.defaults.get_global_default("company")
    if not company:
        company = frappe.db.get_single_value("Global Defaults", "default_company")
    return company or ""
