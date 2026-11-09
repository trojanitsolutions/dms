import json

import frappe
from frappe import _


def get_existing_invoices(sales_orders):
	"""Return non-cancelled Sales Invoices (draft or submitted) linked to the given Sales Orders."""
	if not sales_orders:
		return []
	return frappe.db.sql(
		"""SELECT DISTINCT sii.sales_order, si.name AS invoice, si.docstatus
		   FROM `tabSales Invoice Item` sii
		   INNER JOIN `tabSales Invoice` si ON si.name = sii.parent
		   WHERE sii.sales_order IN %(sos)s AND si.docstatus < 2 AND si.is_return = 0
		   ORDER BY sii.sales_order, si.creation""",
		{"sos": tuple(sales_orders)},
		as_dict=True,
	)


@frappe.whitelist()
def check_duplicate_si(sales_orders):
	if isinstance(sales_orders, str):
		sales_orders = json.loads(sales_orders)
	return get_existing_invoices(list({so for so in sales_orders if so}))


def validate_duplicate_si(doc, method=None):
	"""Sales Invoice.before_insert → block a second SI against the same Sales Order unless confirmed."""
	if doc.is_return or doc.amended_from:
		return
	if doc.flags.dms_allow_duplicate_so or doc.get("dms_allow_duplicate_so"):
		return

	sales_orders = list({item.sales_order for item in doc.items if item.sales_order})
	existing = get_existing_invoices(sales_orders)
	if not existing:
		return

	lines = "".join(
		f"<li>{row.sales_order} → {row.invoice} ({_('Draft') if row.docstatus == 0 else _('Submitted')})</li>"
		for row in existing
	)
	frappe.throw(
		_("A Sales Invoice already exists for this Sales Order:") + f"<ul>{lines}</ul>",
		title=_("Sales Invoice Already Exists"),
	)
