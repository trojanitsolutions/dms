import frappe


def get_owner_filter() -> str | None:
	"""Return the session user when Sales Orders must be limited to their own, or None for System Managers."""
	user = frappe.session.user
	if user == "Administrator" or "System Manager" in frappe.get_roles(user):
		return None
	return user
