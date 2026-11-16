import json
import frappe
from frappe import _
from frappe.utils import cint, strip_html

from dms.api.sales import (
	_get_default_company,
	_get_sales_person_for_user,
	_resolve_discount,
	_validate_item_discount_amounts,
	_apply_order_level_discount,
	_submit_as_admin,
	_build_item_rows,
	_stock_validation_disabled,
	_get_available_qty_map,
	_get_credit_info,
	_rounding_disabled,
)


def _require_sales_rep():
	if frappe.session.user == "Guest":
		frappe.throw(_("Not logged in"), frappe.AuthenticationError)
	if not frappe.db.exists("Has Role", {"parent": frappe.session.user, "role": "Sales Rep"}):
		frappe.throw(_("Access Denied"), frappe.PermissionError)


def _run_privileged(fn):
	"""Execute fn with temporary Administrator privileges, then restore user."""
	_user = frappe.session.user
	frappe.session.user = "Administrator"
	frappe.local.role_permissions = {}
	frappe.local.user_perms = None
	try:
		return fn()
	finally:
		frappe.session.user = _user
		frappe.local.role_permissions = {}
		frappe.local.user_perms = None


PARTY_TYPES = ("Customer", "Lead")


def _resolve_party(party_type: str = "", party_name: str = "", customer: str = ""):
	"""Return (party_type, party). Falls back to the legacy `customer` argument."""
	party_type = party_type or "Customer"
	if party_type not in PARTY_TYPES:
		frappe.throw(_("Invalid party type {0}").format(party_type))
	return party_type, (party_name or customer or "")


def _validate_party(company: str, party_type: str, party: str):
	if not party:
		frappe.throw(_("Select a customer or lead."))
	if not frappe.db.exists(party_type, party):
		frappe.throw(_("{0} {1} not found").format(_(party_type), party), frappe.DoesNotExistError)

	if party_type == "Customer":
		from erpnext.accounts.party import validate_party_frozen_disabled
		validate_party_frozen_disabled(company, "Customer", party)
	elif frappe.db.get_value("Lead", party, "disabled"):
		frappe.throw(_("Lead {0} is disabled").format(party))


def _validate_party_address(address: str, party_type: str, party: str, label: str = "address"):
	if not address:
		return
	linked = frappe.db.exists(
		"Dynamic Link",
		{
			"parent": address,
			"parenttype": "Address",
			"link_doctype": party_type,
			"link_name": party,
		},
	)
	if not linked:
		frappe.throw(_("Selected {0} does not belong to this {1}.").format(_(label), _(party_type).lower()))


def _get_party_addresses(party_type: str, party: str):
	return frappe.get_all(
		"Address",
		filters=[
			["Dynamic Link", "link_doctype", "=", party_type],
			["Dynamic Link", "link_name", "=", party],
			["Dynamic Link", "parenttype", "=", "Address"],
			["disabled", "=", 0],
		],
		fields=["name", "address_title", "address_line1", "address_line2", "city", "state", "country", "pincode"],
		order_by="is_primary_address desc, creation asc",
	)


def _get_party_display_name(party_type: str, party: str) -> str:
	if not party:
		return ""
	if party_type == "Lead":
		row = frappe.db.get_value("Lead", party, ["lead_name", "company_name"], as_dict=True)
		return (row.company_name or row.lead_name or party) if row else ""
	return frappe.db.get_value("Customer", party, "customer_name") or ""


@frappe.whitelist(methods=["GET"])
def search_parties(party_type: str = "Customer", search: str = ""):
	_require_sales_rep()
	party_type, _party = _resolve_party(party_type)
	like = f"%{search}%" if search else None

	if party_type == "Lead":
		rows = frappe.get_all(
			"Lead",
			filters={"disabled": 0, "status": ["!=", "Converted"]},
			or_filters=(
				[
					["name", "like", like],
					["lead_name", "like", like],
					["company_name", "like", like],
					["mobile_no", "like", like],
				]
				if like else None
			),
			fields=["name", "lead_name", "company_name", "mobile_no", "phone", "email_id", "territory", "status"],
			order_by="modified desc",
			limit=50,
		)
		for r in rows:
			r["display_name"] = r.company_name or r.lead_name or r.name
		return rows

	rows = frappe.get_all(
		"Customer",
		filters={"disabled": 0},
		or_filters=([["name", "like", like], ["customer_name", "like", like]] if like else None),
		fields=["name", "customer_name", "mobile_no", "email_id", "territory", "is_frozen"],
		order_by="customer_name",
		limit=50,
	)
	for r in rows:
		r["display_name"] = r.customer_name or r.name
	return rows


@frappe.whitelist(methods=["GET"])
def get_party_details(party_type: str, party: str):
	_require_sales_rep()
	party_type, party = _resolve_party(party_type, party)
	if not frappe.db.exists(party_type, party):
		frappe.throw(_("{0} {1} not found").format(_(party_type), party), frappe.DoesNotExistError)

	if party_type == "Lead":
		d = frappe.db.get_value(
			"Lead", party,
			["name", "lead_name", "company_name", "mobile_no", "phone", "email_id", "territory", "status", "disabled"],
			as_dict=True,
		)
		details = {
			"display_name": d.company_name or d.lead_name or d.name,
			"contact_person": d.lead_name if d.company_name else "",
			"mobile": d.mobile_no or "",
			"phone": d.phone or "",
			"email": d.email_id or "",
			"territory": d.territory or "",
			"status": d.status or "",
			"disabled": d.disabled,
		}
	else:
		d = frappe.db.get_value(
			"Customer", party,
			["name", "customer_name", "mobile_no", "email_id", "territory", "disabled", "is_frozen"],
			as_dict=True,
		)
		details = {
			"display_name": d.customer_name or d.name,
			"contact_person": "",
			"mobile": d.mobile_no or "",
			"phone": "",
			"email": d.email_id or "",
			"territory": d.territory or "",
			"status": "Disabled" if d.disabled else ("Frozen" if d.is_frozen else "Active"),
			"disabled": d.disabled,
		}

	details.update({
		"party_type": party_type,
		"party": party,
		"addresses": _get_party_addresses(party_type, party),
	})
	return details


def _build_quotation_doc(customer: str, warehouse: str, items: list, valid_till: str, customer_address: str, shipping_address: str, company: str, sales_person: str, terms_text: str = "", party_type: str = "Customer"):
	doc_items = _build_item_rows(items, warehouse)

	selling_price_list = (
		frappe.db.get_single_value("Selling Settings", "selling_price_list")
		or "Standard Selling"
	)

	doc_dict = {
		"doctype": "Quotation",
		"quotation_to": party_type or "Customer",
		"party_name": customer,
		"company": company,
		"transaction_date": frappe.utils.today(),
		"valid_till": valid_till or None,
		"customer_address": customer_address or None,
		"shipping_address_name": shipping_address or None,
		"disable_rounded_total": _rounding_disabled(),
		"selling_price_list": selling_price_list,
		"items": doc_items,
		"terms": terms_text or None,
		"sales_team": [
			{
				"sales_person": sales_person,
				"allocated_percentage": 100,
			}
		],
	}

	return frappe.get_doc(doc_dict)


@frappe.whitelist(methods=["POST"])
def get_quotation_totals(warehouse: str, items_json: str, customer: str = "", valid_till: str = "", customer_address: str = "", shipping_address: str = "", additional_discount_type: str = "", additional_discount_value: float = 0, party_type: str = "", party_name: str = ""):
	_require_sales_rep()
	party_type, customer = _resolve_party(party_type, party_name, customer)
	items = json.loads(items_json)
	if not items:
		return {
			"net_total": 0,
			"total_taxes_and_charges": 0,
			"grand_total": 0,
			"rounding_adjustment": 0,
			"rounded_total": 0,
			"disable_rounded_total": 0,
			"items": [],
			"taxes": [],
			"additional_discount_percentage": 0,
			"discount_amount": 0,
		}

	company = _get_default_company()
	sales_person = _get_sales_person_for_user()
	quotation = _build_quotation_doc(customer, warehouse, items, valid_till, customer_address, shipping_address, company, sales_person, "", party_type)
	quotation.run_method("set_missing_values")
	_validate_item_discount_amounts(quotation)
	_apply_order_level_discount(quotation, additional_discount_type, additional_discount_value)

	return {
		"total": quotation.total,
		"total_taxes_and_charges": quotation.total_taxes_and_charges,
		"grand_total": quotation.grand_total,
		"rounding_adjustment": quotation.rounding_adjustment,
		"rounded_total": quotation.rounded_total,
		"disable_rounded_total": quotation.disable_rounded_total,
		"additional_discount_percentage": quotation.additional_discount_percentage or 0,
		"discount_amount": quotation.discount_amount or 0,
		"items": [{"item_code": d.item_code, "qty": d.qty, "rate": d.rate, "amount": d.amount, "discount_percentage": d.discount_percentage or 0, "discount_amount": d.discount_amount or 0} for d in quotation.items],
		"taxes": [{"description": t.description, "tax_amount": t.tax_amount, "total": t.total} for t in quotation.taxes],
	}


@frappe.whitelist(methods=["POST"])
def create_quotation(warehouse: str, items_json: str, customer: str = "", valid_till: str = "", customer_address: str = "", shipping_address: str = "", terms: str = "", additional_discount_type: str = "", additional_discount_value: float = 0, submit: bool = True, existing_quotation: str = "", party_type: str = "", party_name: str = ""):
	_require_sales_rep()
	party_type, customer = _resolve_party(party_type, party_name, customer)
	try:
		items = json.loads(items_json)
		if not items:
			frappe.throw(_("No items in quotation"))
		if valid_till and frappe.utils.getdate(valid_till) < frappe.utils.getdate():
			frappe.throw(_("Valid until cannot be a date before today"))

		company = _get_default_company()

		_validate_party(company, party_type, customer)
		_validate_party_address(customer_address, party_type, customer, "address")
		_validate_party_address(shipping_address, party_type, customer, "shipping address")

		if existing_quotation:
			quotation = frappe.get_doc("Quotation", existing_quotation)
			if quotation.owner != frappe.session.user:
				frappe.throw(_("Not permitted"), frappe.PermissionError)
			if quotation.docstatus != 0:
				frappe.throw(_("Quotation is not pending"))
			quotation.quotation_to = party_type
			quotation.party_name = customer
			quotation.valid_till = valid_till or None
			quotation.customer_address = customer_address or None
			quotation.shipping_address_name = shipping_address or None
			quotation.terms = terms or None
			quotation.set("items", _build_item_rows(items, warehouse))
			quotation.disable_rounded_total = _rounding_disabled()
		else:
			sales_person = _get_sales_person_for_user()
			quotation = _build_quotation_doc(customer, warehouse, items, valid_till, customer_address, shipping_address, company, sales_person, terms, party_type)

		quotation.run_method("set_missing_values")
		_validate_item_discount_amounts(quotation)
		_apply_order_level_discount(quotation, additional_discount_type, additional_discount_value)

		if existing_quotation:
			quotation.save(ignore_permissions=True)
		else:
			quotation.insert(ignore_permissions=True)

		if submit:
			_submit_as_admin(quotation)
		return {
			"name": quotation.name,
			"docstatus": quotation.docstatus,
			"total": quotation.total,
			"grand_total": quotation.grand_total,
			"rounded_total": quotation.rounded_total,
			"disable_rounded_total": quotation.disable_rounded_total,
			"additional_discount_percentage": quotation.additional_discount_percentage or 0,
			"discount_amount": quotation.discount_amount or 0,
		}
	except Exception:
		frappe.log_error(
			title=f"DMS Quotation submit failed for {frappe.session.user}",
			message=f"{party_type}={customer}, warehouse={warehouse}\n\n{frappe.get_traceback()}",
		)
		raise


QUOTATION_LIST_FIELDS = [
	"name",
	"quotation_to as party_type",
	"party_name",
	"party_name as customer",
	"customer_name",
	"grand_total",
	"rounded_total",
	"disable_rounded_total",
	"status",
	"transaction_date",
	"valid_till",
]


def _apply_party_filters(filters: dict, customer: str = "", party_type: str = ""):
	if party_type:
		if party_type not in PARTY_TYPES:
			frappe.throw(_("Invalid party type {0}").format(party_type))
		filters["quotation_to"] = party_type
	if customer:
		filters["party_name"] = customer


@frappe.whitelist(methods=["GET"])
def get_my_quotations(customer: str = "", party_type: str = ""):
	_require_sales_rep()
	filters = {"owner": frappe.session.user, "docstatus": ["!=", 2]}
	_apply_party_filters(filters, customer, party_type)
	return frappe.get_all(
		"Quotation",
		filters=filters,
		fields=QUOTATION_LIST_FIELDS,
		order_by="creation desc",
		limit=50,
	)


@frappe.whitelist(methods=["GET"])
def get_pending_quotations(customer: str = "", party_type: str = ""):
	_require_sales_rep()
	filters = {"owner": frappe.session.user, "docstatus": 0}
	_apply_party_filters(filters, customer, party_type)

	quotations = frappe.get_all(
		"Quotation",
		filters=filters,
		fields=QUOTATION_LIST_FIELDS,
		order_by="creation desc",
		limit=2500,
	)

	item_counts = {}
	if quotations:
		names = [q["name"] for q in quotations]
		rows = frappe.db.sql(
			"""SELECT parent, COUNT(*) as cnt FROM `tabQuotation Item` WHERE parent IN ({}) GROUP BY parent""".format(
				",".join(["%s"] * len(names))
			),
			names,
			as_dict=True,
		)
		item_counts = {r.parent: r.cnt for r in rows}

	for q in quotations:
		q["item_count"] = item_counts.get(q["name"], 0)

	return quotations


@frappe.whitelist(methods=["POST"])
def submit_pending_quotation(name: str):
	_require_sales_rep()
	quotation = frappe.get_doc("Quotation", name)
	if quotation.owner != frappe.session.user:
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	if quotation.docstatus != 0:
		frappe.throw(_("Quotation is not pending"))
	_submit_as_admin(quotation)
	return {
		"name": quotation.name,
		"grand_total": quotation.grand_total,
		"rounded_total": quotation.rounded_total,
		"disable_rounded_total": quotation.disable_rounded_total,
	}


@frappe.whitelist(methods=["POST"])
def discard_pending_quotation(name: str):
	_require_sales_rep()
	quotation = frappe.get_doc("Quotation", name)
	if quotation.owner != frappe.session.user:
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	if quotation.docstatus != 0:
		frappe.throw(_("Quotation is not pending"))
	frappe.delete_doc("Quotation", name, ignore_permissions=True)
	return {"ok": True}


@frappe.whitelist(methods=["GET"])
def get_pending_quotation_detail(name: str):
	_require_sales_rep()
	quotation = frappe.get_doc("Quotation", name)
	if quotation.owner != frappe.session.user:
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	if quotation.docstatus != 0:
		frappe.throw(_("Quotation is not pending"))

	def reverse_discount(item_row):
		if item_row.discount_percentage:
			return ("Percentage", item_row.discount_percentage)
		if item_row.discount_amount:
			return ("Amount", item_row.discount_amount)
		return ("", 0)

	return {
		"name": quotation.name,
		"party_type": quotation.quotation_to,
		"party_name": quotation.party_name,
		"customer": quotation.party_name,
		"customer_name": quotation.customer_name,
		"valid_till": quotation.valid_till,
		"customer_address": quotation.customer_address,
		"shipping_address": quotation.shipping_address_name,
		"terms": quotation.terms or "",
		"items": [
			{
				"item_code": d.item_code,
				"qty": d.qty,
				"rate": d.rate,
				"discount_type": reverse_discount(d)[0],
				"discount_value": reverse_discount(d)[1],
			}
			for d in quotation.items
		],
	}


@frappe.whitelist(methods=["GET"])
def get_quotation_detail(name: str):
	_require_sales_rep()
	quotation = frappe.get_doc("Quotation", name)
	if quotation.owner != frappe.session.user:
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	address_display = quotation.address_display or ""
	if not address_display and quotation.customer_address:
		from frappe.contacts.doctype.address.address import get_address_display
		address_display = get_address_display(quotation.customer_address) or ""

	return {
		"name": quotation.name,
		"party_type": quotation.quotation_to,
		"party_name": quotation.party_name,
		"customer": quotation.party_name,
		"customer_name": quotation.customer_name,
		"address_display": strip_html(address_display.replace("<br>", ", ")).strip(", ") if address_display else "",
		"contact_mobile": quotation.contact_mobile or "",
		"contact_email": quotation.contact_email or "",
		"transaction_date": quotation.transaction_date,
		"valid_till": quotation.valid_till,
		"status": quotation.status,
		"docstatus": quotation.docstatus,
		"terms": quotation.terms or "",
		"in_words": quotation.in_words or "",
		"total": quotation.total,
		"net_total": quotation.net_total,
		"total_taxes_and_charges": quotation.total_taxes_and_charges,
		"grand_total": quotation.grand_total,
		"rounded_total": quotation.rounded_total,
		"disable_rounded_total": quotation.disable_rounded_total,
		"additional_discount_percentage": quotation.additional_discount_percentage or 0,
		"discount_amount": quotation.discount_amount or 0,
		"items": [
			{
				"item_code": d.item_code,
				"item_name": d.item_name or d.item_code,
				"qty": d.qty,
				"uom": d.uom,
				"rate": d.rate,
				"amount": d.amount,
				"discount_percentage": d.discount_percentage or 0,
				"discount_amount": d.discount_amount or 0,
				"description": strip_html(d.description or "") if d.description else "",
				"warehouse": d.warehouse or "",
			}
			for d in quotation.items
		],
		"taxes": [
			{
				"description": t.description,
				"tax_amount": t.tax_amount,
				"total": t.total,
			}
			for t in quotation.taxes
		],
	}


@frappe.whitelist(methods=["POST"])
def declare_quotation_lost(name: str, detailed_reason: str = ""):
	_require_sales_rep()
	quotation = frappe.get_doc("Quotation", name)
	if quotation.owner != frappe.session.user:
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	if quotation.docstatus != 1:
		frappe.throw(_("Only submitted quotations can be marked as lost"))

	_run_privileged(lambda: quotation.declare_enquiry_lost([], [], detailed_reason))
	return {
		"name": quotation.name,
		"status": quotation.status,
	}


@frappe.whitelist(methods=["POST"])
def cancel_quotation(name: str):
	_require_sales_rep()
	quotation = frappe.get_doc("Quotation", name)
	if quotation.owner != frappe.session.user:
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	if quotation.docstatus != 1:
		frappe.throw(_("Only submitted quotations can be cancelled"))

	_run_privileged(quotation.cancel)
	return {
		"name": quotation.name,
		"docstatus": quotation.docstatus,
		"status": quotation.status,
	}


def _validate_quotation_convertible(quotation):
	if quotation.owner != frappe.session.user:
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	if quotation.docstatus != 1:
		frappe.throw(_("Only submitted quotations can be converted"))

	allow_expired = frappe.db.get_single_value("Selling Settings", "allow_sales_order_creation_for_expired_quotation")
	if not allow_expired and quotation.valid_till:
		valid_till = frappe.utils.getdate(quotation.valid_till)
		today = frappe.utils.getdate(frappe.utils.today())
		if valid_till < today:
			frappe.throw(_("Validity period of this quotation has ended."))


def _check_quotation_already_converted(name: str):
	existing = frappe.db.sql(
		"""
		SELECT soi.parent FROM `tabSales Order Item` soi
		WHERE soi.prevdoc_docname = %s AND soi.docstatus != 2
		LIMIT 1
		""",
		name,
	)
	if existing:
		frappe.throw(_("A Sales Order has already been created from this quotation."))


@frappe.whitelist(methods=["GET"])
def get_linked_sales_orders(quotation: str):
	_require_sales_rep()
	orders = frappe.db.sql(
		"""
		SELECT DISTINCT so.name, so.customer_name, so.transaction_date, so.status, so.grand_total,
			so.rounded_total, so.disable_rounded_total
		FROM `tabSales Order Item` soi
		JOIN `tabSales Order` so ON soi.parent = so.name
		WHERE soi.prevdoc_docname = %s AND soi.docstatus != 2 AND so.docstatus != 2
		ORDER BY so.creation DESC
		""",
		quotation,
		as_dict=True,
	)

	if orders:
		order_names = [o["name"] for o in orders]
		items = frappe.get_all(
			"Sales Order Item",
			filters={"parent": ["in", order_names]},
			fields=["parent", "item_code", "item_name", "qty", "rate", "amount"],
			order_by="parent, idx",
		)
		by_parent = {}
		for it in items:
			by_parent.setdefault(it["parent"], []).append(it)
		for o in orders:
			o["items"] = by_parent.get(o["name"], [])

	return orders


def _get_customer_for_lead(lead: str):
	return frappe.db.get_value("Customer", {"lead_name": lead}, "name")


@frappe.whitelist(methods=["POST"])
def ensure_customer_for_quotation(name: str):
	"""Make sure a Customer exists for the quotation's party.

	For Lead quotations this reuses the Customer already created from the Lead,
	or creates one with ERPNext's standard Lead -> Customer mapping (which also
	marks the Lead as Converted).
	"""
	_require_sales_rep()
	quotation = frappe.get_doc("Quotation", name)
	_validate_quotation_convertible(quotation)
	_check_quotation_already_converted(name)

	if quotation.quotation_to == "Customer":
		customer = quotation.party_name
	elif quotation.quotation_to == "Lead":
		customer = _get_customer_for_lead(quotation.party_name)
		if not customer:
			from erpnext.selling.doctype.quotation.quotation import _make_customer
			customer = _run_privileged(lambda: _make_customer(name, ignore_permissions=True)).name
	else:
		frappe.throw(_("Quotations for {0} cannot be converted here.").format(quotation.quotation_to))

	return {
		"customer": customer,
		"customer_name": frappe.db.get_value("Customer", customer, "customer_name"),
	}


@frappe.whitelist(methods=["POST"])
def create_lead(first_name: str, last_name: str = "", mobile_no: str = "", company_name: str = ""):
	"""Create a Lead from the Quotation pop-up so a quotation can be made for it."""
	_require_sales_rep()
	first_name = (first_name or "").strip()
	last_name = (last_name or "").strip()
	mobile_no = (mobile_no or "").strip()
	company_name = (company_name or "").strip()
	if not first_name:
		frappe.throw(_("First Name is required."))
	if not mobile_no:
		frappe.throw(_("Mobile Number is required."))

	lead_owner = frappe.session.user
	lead = _run_privileged(
		lambda: frappe.get_doc(
			{
				"doctype": "Lead",
				"first_name": first_name,
				"last_name": last_name,
				"mobile_no": mobile_no,
				"company_name": company_name,
				"lead_owner": lead_owner,
			}
		).insert()
	)
	return {"name": lead.name, "display_name": lead.company_name or lead.lead_name}


@frappe.whitelist(methods=["GET"])
def get_quotation_for_sales_order(name: str):
	_require_sales_rep()
	quotation = frappe.get_doc("Quotation", name)
	_validate_quotation_convertible(quotation)
	_check_quotation_already_converted(name)

	# GET requests are not committed, so never create the Customer here.
	if quotation.quotation_to == "Lead" and not _get_customer_for_lead(quotation.party_name):
		frappe.throw(_("Convert Lead {0} to a customer first.").format(quotation.party_name))

	from erpnext.selling.doctype.quotation.quotation import _make_sales_order
	so = _make_sales_order(name, target_doc=None, ignore_permissions=True)

	def reverse_discount(item_row):
		if item_row.discount_percentage:
			return ("Percentage", item_row.discount_percentage)
		if item_row.discount_amount:
			return ("Amount", item_row.discount_amount)
		return ("", 0)

	if so.additional_discount_percentage:
		order_disc_type, order_disc_value = "Percentage", so.additional_discount_percentage
	elif so.discount_amount:
		order_disc_type, order_disc_value = "Amount", so.discount_amount
	else:
		order_disc_type, order_disc_value = "", 0

	return {
		"name": so.name if so.name else "",
		"customer": so.customer,
		"customer_name": so.customer_name,
		"warehouse": so.items[0].warehouse if so.items else "",
		"delivery_date": str(so.delivery_date or ""),
		"customer_address": so.customer_address or "",
		"shipping_address": so.shipping_address_name or "",
		"additional_discount_type": order_disc_type,
		"additional_discount_value": order_disc_value,
		"items": [
			{
				"item_code": d.item_code,
				"qty": d.qty,
				"rate": d.price_list_rate,
				**dict(zip(("discount_type", "discount_value"), reverse_discount(d))),
			}
			for d in so.items
		],
	}


@frappe.whitelist(methods=["POST"])
def create_sales_order_from_quotation(name: str, items_json: str, customer_address: str = "", shipping_address: str = "", submit: bool = True):
	_require_sales_rep()
	try:
		items = json.loads(items_json)
		if not items:
			frappe.throw(_("No items in order"))

		quotation = frappe.get_doc("Quotation", name)
		_validate_quotation_convertible(quotation)
		_check_quotation_already_converted(name)

		from erpnext.selling.doctype.quotation.quotation import _make_sales_order
		so = _make_sales_order(name, target_doc=None, ignore_permissions=True)
		so.disable_rounded_total = _rounding_disabled()

		# Validate item codes & quantities match the mapped SO
		mapped_codes = {d.item_code for d in so.items}
		input_codes = {it["item_code"] for it in items}
		if mapped_codes != input_codes:
			frappe.throw(_("Item codes do not match quotation. Possible tampering detected."))

		for it in items:
			if float(it.get("qty", 0)) <= 0:
				frappe.throw(_("Item {0}: quantity must be greater than zero.").format(it["item_code"]))

		# Apply quantity overrides to mapped SO items
		item_qty_map = {it["item_code"]: float(it["qty"]) for it in items}
		for d in so.items:
			d.qty = item_qty_map.get(d.item_code, d.qty)

		# Validate and apply addresses
		company = so.company
		if customer_address:
			linked = frappe.db.exists(
				"Dynamic Link",
				{
					"parent": customer_address,
					"parenttype": "Address",
					"link_doctype": "Customer",
					"link_name": so.customer,
				},
			)
			if not linked:
				frappe.throw(_("Selected address does not belong to this customer."))
			so.customer_address = customer_address

		if shipping_address:
			linked = frappe.db.exists(
				"Dynamic Link",
				{
					"parent": shipping_address,
					"parenttype": "Address",
					"link_doctype": "Customer",
					"link_name": so.customer,
				},
			)
			if not linked:
				frappe.throw(_("Selected shipping address does not belong to this customer."))
			so.shipping_address_name = shipping_address

		# Ensure delivery_date is set
		if not so.delivery_date:
			so.delivery_date = frappe.utils.today()

		# Set custom field linking back to the quotation
		so.quotation_name = name

		so.run_method("set_missing_values")
		_validate_item_discount_amounts(so)

		# Stock validation
		if not _stock_validation_disabled():
			item_codes = [it["item_code"] for it in items]
			avail_map = _get_available_qty_map(item_codes=item_codes, warehouse=so.items[0].warehouse if so.items else "")
			for it in items:
				avail = avail_map.get((it["item_code"], so.items[0].warehouse if so.items else ""), 0.0)
				if float(it["qty"]) > avail:
					frappe.throw(
						_(
							"Insufficient stock for {0}: requested {1}, available {2} in {3}."
						).format(it["item_code"], float(it["qty"]), avail, so.items[0].warehouse if so.items else "")
					)

		# Calculate totals (no order-level discount from the quotation-to-SO flow; discounts are already on items)
		so.run_method("calculate_taxes_and_totals")

		# Credit check
		credit_info = _get_credit_info(so.customer, company)
		if credit_info["credit_limit"] > 0:
			if so.grand_total > credit_info["available_credit"]:
				frappe.throw(
					_(
						"Order total ({0}) exceeds available credit ({1}). "
						"Credit limit: {2}, Outstanding: {3}."
					).format(
						frappe.utils.flt(so.grand_total, 2),
						frappe.utils.flt(credit_info["available_credit"], 2),
						frappe.utils.flt(credit_info["credit_limit"], 2),
						frappe.utils.flt(credit_info["outstanding"], 2),
					)
				)

		so.insert(ignore_permissions=True)
		if submit:
			_submit_as_admin(so)

		return {
			"name": so.name,
			"docstatus": so.docstatus,
			"total": so.total,
			"grand_total": so.grand_total,
			"rounded_total": so.rounded_total,
			"disable_rounded_total": so.disable_rounded_total,
			"additional_discount_percentage": so.additional_discount_percentage or 0,
			"discount_amount": so.discount_amount or 0,
		}
	except Exception:
		frappe.log_error(
			title=f"DMS create_sales_order_from_quotation failed for {frappe.session.user}",
			message=f"quotation={name}\n\n{frappe.get_traceback()}",
		)
		raise


@frappe.whitelist(methods=["GET"])
def get_quotation_history(search: str = "", limit_start: int = 0, limit_page_length: int = 20, valid_till: str = "", status: str = "", party_type: str = ""):
	_require_sales_rep()

	limit_start = cint(limit_start)
	limit_page_length = cint(limit_page_length) or 20

	filters = {"owner": frappe.session.user, "docstatus": ["in", [0, 1]]}
	_apply_party_filters(filters, party_type=party_type)

	if valid_till:
		filters["valid_till"] = valid_till
	if status and status != "All":
		filters["status"] = status

	or_filters = None
	if search:
		or_filters = [
			["name", "like", f"%{search}%"],
			["customer_name", "like", f"%{search}%"],
			["party_name", "like", f"%{search}%"],
		]

	quotations = frappe.get_all(
		"Quotation",
		filters=filters,
		or_filters=or_filters,
		fields=QUOTATION_LIST_FIELDS,
		order_by="transaction_date desc, creation desc, name desc",
		limit_start=limit_start,
		limit_page_length=limit_page_length + 1,
	)

	has_more = len(quotations) > limit_page_length
	quotations = quotations[:limit_page_length]

	if quotations:
		names = [q["name"] for q in quotations]
		items = frappe.get_all(
			"Quotation Item",
			filters={"parent": ["in", names]},
			fields=["parent", "item_code", "item_name", "qty", "rate", "amount"],
			order_by="parent, idx",
		)

		by_parent = {}
		for it in items:
			by_parent.setdefault(it["parent"], []).append(it)

		for q in quotations:
			q["items"] = by_parent.get(q["name"], [])

	return {"orders": quotations, "has_more": has_more}


@frappe.whitelist(methods=["GET"])
def get_quotation_print_html(name: str, format: str = ""):
	_require_sales_rep()
	quotation = frappe.get_doc("Quotation", name)
	if quotation.owner != frappe.session.user:
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	html = _run_privileged(
		lambda: frappe.get_print("Quotation", name, print_format=format or None, as_pdf=False)
	)
	return html
