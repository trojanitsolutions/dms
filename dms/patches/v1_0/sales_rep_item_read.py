import frappe
from frappe.permissions import add_permission, update_permission_property

ROLE = "Sales Rep"


def execute():
	"""Sales Reps need read on Item so Frappe serves private Item images to them."""
	if not frappe.db.exists("Role", ROLE):
		return
	add_permission("Item", ROLE, 0, "read")
	update_permission_property("Item", ROLE, 0, "read", 1)
