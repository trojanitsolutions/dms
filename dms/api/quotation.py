import json
import frappe
from frappe import _
from frappe.utils import cint

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


def _build_quotation_doc(customer: str, warehouse: str, items: list, valid_till: str, customer_address: str, shipping_address: str, company: str, sales_person: str, terms_text: str = ""):
	doc_items = _build_item_rows(items, warehouse)

	selling_price_list = (
		frappe.db.get_single_value("Selling Settings", "selling_price_list")
		or "Standard Selling"
	)

	doc_dict = {
		"doctype": "Quotation",
		"quotation_to": "Customer",
		"party_name": customer,
		"company": company,
		"transaction_date": frappe.utils.today(),
		"valid_till": valid_till or None,
		"customer_address": customer_address or None,
		"shipping_address_name": shipping_address or None,
		"disable_rounded_total": frappe.db.get_single_value("Global Defaults", "disable_rounded_total") or 0,
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
def get_quotation_totals(customer: str, warehouse: str, items_json: str, valid_till: str = "", customer_address: str = "", shipping_address: str = "", additional_discount_type: str = "", additional_discount_value: float = 0):
	_require_sales_rep()
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
	quotation = _build_quotation_doc(customer, warehouse, items, valid_till, customer_address, shipping_address, company, sales_person, "")
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
def create_quotation(customer: str, warehouse: str, items_json: str, valid_till: str = "", customer_address: str = "", shipping_address: str = "", terms: str = "", additional_discount_type: str = "", additional_discount_value: float = 0, submit: bool = True, existing_quotation: str = ""):
	_require_sales_rep()
	try:
		items = json.loads(items_json)
		if not items:
			frappe.throw(_("No items in quotation"))
		if valid_till and frappe.utils.getdate(valid_till) < frappe.utils.getdate():
			frappe.throw(_("Valid until cannot be a date before today"))

		company = _get_default_company()

		from erpnext.accounts.party import validate_party_frozen_disabled
		validate_party_frozen_disabled(company, "Customer", customer)

		if customer_address:
			linked = frappe.db.exists(
				"Dynamic Link",
				{
					"parent": customer_address,
					"parenttype": "Address",
					"link_doctype": "Customer",
					"link_name": customer,
				},
			)
			if not linked:
				frappe.throw(_("Selected address does not belong to this customer."))

		if shipping_address:
			linked = frappe.db.exists(
				"Dynamic Link",
				{
					"parent": shipping_address,
					"parenttype": "Address",
					"link_doctype": "Customer",
					"link_name": customer,
				},
			)
			if not linked:
				frappe.throw(_("Selected shipping address does not belong to this customer."))

		if existing_quotation:
			quotation = frappe.get_doc("Quotation", existing_quotation)
			if quotation.owner != frappe.session.user:
				frappe.throw(_("Not permitted"), frappe.PermissionError)
			if quotation.docstatus != 0:
				frappe.throw(_("Quotation is not pending"))
			quotation.party_name = customer
			quotation.valid_till = valid_till or None
			quotation.customer_address = customer_address or None
			quotation.shipping_address_name = shipping_address or None
			quotation.terms = terms or None
			quotation.set("items", _build_item_rows(items, warehouse))
		else:
			sales_person = _get_sales_person_for_user()
			quotation = _build_quotation_doc(customer, warehouse, items, valid_till, customer_address, shipping_address, company, sales_person, terms)

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
			message=f"customer={customer}, warehouse={warehouse}\n\n{frappe.get_traceback()}",
		)
		raise


@frappe.whitelist(methods=["GET"])
def get_my_quotations(customer: str = ""):
	_require_sales_rep()
	filters = {"owner": frappe.session.user, "docstatus": ["!=", 2]}
	if customer:
		filters["party_name"] = customer
	return frappe.get_all(
		"Quotation",
		filters=filters,
		fields=["name", "party_name as customer", "customer_name", "grand_total", "status", "transaction_date", "valid_till"],
		order_by="creation desc",
		limit=50,
	)


@frappe.whitelist(methods=["GET"])
def get_pending_quotations(customer: str = ""):
	_require_sales_rep()
	filters = {"owner": frappe.session.user, "docstatus": 0}
	if customer:
		filters["party_name"] = customer

	quotations = frappe.get_all(
		"Quotation",
		filters=filters,
		fields=["name", "party_name as customer", "customer_name", "grand_total", "status", "transaction_date", "valid_till"],
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

	return {
		"name": quotation.name,
		"customer": quotation.party_name,
		"customer_name": quotation.customer_name,
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
		JOIN `tabQuotation Item` qi ON soi.prevdoc_docname = qi.name
		WHERE qi.parent = %s AND soi.docstatus != 2
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
		SELECT DISTINCT soi.parent as name, so.docstatus
		FROM `tabSales Order Item` soi
		JOIN `tabQuotation Item` qi ON soi.prevdoc_docname = qi.name
		JOIN `tabSales Order` so ON soi.parent = so.name
		WHERE qi.parent = %s AND soi.docstatus != 2 AND so.docstatus != 2
		ORDER BY so.creation DESC
		""",
		quotation,
		as_dict=True
	)
	return orders


@frappe.whitelist(methods=["GET"])
def get_quotation_for_sales_order(name: str):
	_require_sales_rep()
	quotation = frappe.get_doc("Quotation", name)
	_validate_quotation_convertible(quotation)
	_check_quotation_already_converted(name)

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
def get_quotation_history(search: str = "", limit_start: int = 0, limit_page_length: int = 20, valid_till: str = "", status: str = ""):
	_require_sales_rep()

	limit_start = cint(limit_start)
	limit_page_length = cint(limit_page_length) or 20

	filters = {"owner": frappe.session.user, "docstatus": ["in", [0, 1]]}

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
		fields=["name", "party_name as customer", "customer_name", "transaction_date", "valid_till", "grand_total", "status"],
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
