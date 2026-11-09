import json

import frappe
from frappe import _

from dms.automation.si_duplicate_guard import get_existing_invoices


def get_existing_delivery_notes(sales_orders):
	"""Return non-cancelled, non-return Delivery Notes (draft or submitted) linked to the given Sales Orders."""
	if not sales_orders:
		return []
	return frappe.db.sql(
		"""SELECT DISTINCT dni.against_sales_order AS sales_order, dn.name AS delivery_note, dn.docstatus
		   FROM `tabDelivery Note Item` dni
		   INNER JOIN `tabDelivery Note` dn ON dn.name = dni.parent
		   WHERE dni.against_sales_order IN %(sos)s AND dn.docstatus < 2 AND dn.is_return = 0
		   ORDER BY dni.against_sales_order, dn.creation""",
		{"sos": tuple(sales_orders)},
		as_dict=True,
	)


def get_sos_without_invoice(sales_orders):
	invoiced = {row.sales_order for row in get_existing_invoices(sales_orders)}
	return sorted(so for so in sales_orders if so not in invoiced)


@frappe.whitelist()
def check_dn(sales_orders):
	if isinstance(sales_orders, str):
		sales_orders = json.loads(sales_orders)
	sales_orders = list({so for so in sales_orders if so})
	return {
		"missing_si": get_sos_without_invoice(sales_orders),
		"existing_dn": get_existing_delivery_notes(sales_orders),
	}


def validate_dn(doc, method=None):
	"""Delivery Note.before_insert → require a Sales Invoice per Sales Order; block duplicate DNs unless confirmed."""
	if doc.is_return:
		return

	sales_orders = list({item.against_sales_order for item in doc.items if item.against_sales_order})
	if not sales_orders:
		return

	missing = get_sos_without_invoice(sales_orders)
	if missing:
		frappe.throw(
			_("Create a Sales Invoice (Draft or Submitted) for these Sales Orders before creating a Delivery Note:")
			+ "<ul>" + "".join(f"<li>{so}</li>" for so in missing) + "</ul>",
			title=_("Sales Invoice Required"),
		)

	if doc.amended_from or doc.flags.dms_allow_duplicate_dn or doc.get("dms_allow_duplicate_dn"):
		return

	existing = get_existing_delivery_notes(sales_orders)
	if not existing:
		return

	lines = "".join(
		f"<li>{row.sales_order} → {row.delivery_note} ({_('Draft') if row.docstatus == 0 else _('Submitted')})</li>"
		for row in existing
	)
	frappe.throw(
		_("A Delivery Note already exists for this Sales Order:") + f"<ul>{lines}</ul>",
		title=_("Delivery Note Already Exists"),
	)
