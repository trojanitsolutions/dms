import frappe


def add_overview_navbar_item():
	ns = frappe.get_single("Navbar Settings")
	if not any(d.item_label == "Overview" for d in ns.settings_dropdown):
		ns.append(
			"settings_dropdown",
			{
				"item_label": "Overview",
				"item_type": "Route",
				"route": "/dms",
			},
		)
		ns.save(ignore_permissions=True)


def remove_overview_navbar_item():
	ns = frappe.get_single("Navbar Settings")
	rows = [d for d in ns.settings_dropdown if d.item_label == "Overview"]
	if rows:
		for d in rows:
			ns.remove(d)
		ns.save(ignore_permissions=True)
