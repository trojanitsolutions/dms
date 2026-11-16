import frappe


def get_context(context):
	context.no_cache = 1
	_require_sales_rep()
	context.full_name = frappe.db.get_value("User", frappe.session.user, "full_name") or frappe.session.user
	args = frappe.request.args
	party_type = args.get("party_type") or "Customer"
	if party_type not in ("Customer", "Lead"):
		party_type = "Customer"
	party = args.get("party") or args.get("customer") or ""
	if party and not frappe.db.exists(party_type, party):
		party = ""

	context.party_type = party_type
	context.party = party
	context.party_name = _get_party_display_name(party_type, party)
	# Kept for template / script backward compatibility.
	context.customer = party if party_type == "Customer" else ""
	context.customer_name = context.party_name if party_type == "Customer" else ""
	context.company_logo = _get_company_logo()


def _get_party_display_name(party_type, party):
	if not party:
		return ""
	if party_type == "Lead":
		row = frappe.db.get_value("Lead", party, ["lead_name", "company_name"], as_dict=True)
		return (row.company_name or row.lead_name or party) if row else ""
	return frappe.db.get_value("Customer", party, "customer_name") or party


def _require_sales_rep():
	if frappe.session.user == "Guest":
		frappe.local.flags.redirect_location = "/sales-login"
		raise frappe.Redirect
	if not frappe.db.exists("Has Role", {"parent": frappe.session.user, "role": "Sales Rep"}):
		frappe.local.flags.redirect_location = "/desk?route=List/Quotation&error=access-denied"
		raise frappe.Redirect


def _get_company_logo():
	company = _get_default_company()
	return (frappe.db.get_value("Company", company, "company_logos") or None) if company else None


def _get_default_company():
	company = frappe.defaults.get_user_default("company") or frappe.defaults.get_global_default("company")
	if not company:
		company = frappe.db.get_single_value("Global Defaults", "default_company")
	return company or ""
