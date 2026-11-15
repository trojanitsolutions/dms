import frappe


def get_context(context):
	context.no_cache = 1
	_require_login()
	context.full_name = frappe.db.get_value("User", frappe.session.user, "full_name") or frappe.session.user
	context.company = _get_default_company()
	context.company_logo = _get_company_logo(context.company)


def _require_login():
	if frappe.session.user == "Guest":
		frappe.local.flags.redirect_location = "/sales-login"
		raise frappe.Redirect


def _get_company_logo(company):
	if not company:
		return None
	return frappe.db.get_value("Company", company, "company_logos") or None


def _get_default_company():
	company = frappe.defaults.get_user_default("company") or frappe.defaults.get_global_default("company")
	if not company:
		company = frappe.db.get_single_value("Global Defaults", "default_company")
	return company or ""
