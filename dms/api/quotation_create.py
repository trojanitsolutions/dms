import json
import frappe
from frappe import _
from dms.api.sales import (
	_require_sales_rep,
	_get_default_company,
	_resolve_discount,
	_validate_item_discount_amounts,
	_apply_order_level_discount,
	_build_item_rows,
	_rounding_disabled,
	_validate_min_selling_rate,
)
from dms.api.quotation import _resolve_party, _validate_party, _validate_party_address


def _build_quotation_doc(customer, warehouse, items, valid_till, customer_address, shipping_address, company, terms, transaction_date="", party_type="Customer"):
	doc_items = _build_item_rows(items, warehouse)

	selling_price_list = (
		frappe.db.get_single_value("Selling Settings", "selling_price_list")
		or "Standard Selling"
	)

	return frappe.get_doc({
		"doctype": "Quotation",
		"quotation_to": party_type or "Customer",
		"party_name": customer,
		"company": company,
		"transaction_date": transaction_date or frappe.utils.today(),
		"valid_till": valid_till or None,
		"customer_address": customer_address or None,
		"shipping_address_name": shipping_address or None,
		"disable_rounded_total": _rounding_disabled(),
		"selling_price_list": selling_price_list,
		"items": doc_items,
		"terms": terms or None,
	})


@frappe.whitelist(methods=["POST"])
def get_quotation_totals(warehouse: str, items_json: str, customer: str = "", valid_till: str = "",
						 customer_address: str = "", shipping_address: str = "",
						 additional_discount_type: str = "", additional_discount_value: float = 0, transaction_date: str = "",
						 party_type: str = "", party_name: str = ""):
	_require_sales_rep()
	party_type, customer = _resolve_party(party_type, party_name, customer)
	items = json.loads(items_json)
	if not items:
		return {
			"total": 0,
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
	qtn = _build_quotation_doc(customer, warehouse, items, valid_till, customer_address, shipping_address, company, "", transaction_date, party_type)
	qtn.run_method("set_missing_values")
	_validate_min_selling_rate(qtn)
	_validate_item_discount_amounts(qtn)
	_apply_order_level_discount(qtn, additional_discount_type, additional_discount_value)

	return {
		"total": qtn.total,
		"total_taxes_and_charges": qtn.total_taxes_and_charges,
		"grand_total": qtn.grand_total,
		"rounding_adjustment": qtn.rounding_adjustment,
		"rounded_total": qtn.rounded_total,
		"disable_rounded_total": qtn.disable_rounded_total,
		"additional_discount_percentage": qtn.additional_discount_percentage or 0,
		"discount_amount": qtn.discount_amount or 0,
		"items": [{"item_code": d.item_code, "qty": d.qty, "rate": d.rate, "amount": d.amount,
				   "discount_percentage": d.discount_percentage or 0, "discount_amount": d.discount_amount or 0} for d in qtn.items],
		"taxes": [{"description": t.description, "tax_amount": t.tax_amount, "total": t.total} for t in qtn.taxes],
	}


@frappe.whitelist(methods=["POST"])
def create_quotation(warehouse: str, items_json: str, customer: str = "", valid_till: str = "",
					  customer_address: str = "", shipping_address: str = "", terms: str = "",
					  additional_discount_type: str = "", additional_discount_value: float = 0, transaction_date: str = "",
					  party_type: str = "", party_name: str = ""):
	_require_sales_rep()
	party_type, customer = _resolve_party(party_type, party_name, customer)
	try:
		items = json.loads(items_json)
		if not items:
			frappe.throw(_("No items in quotation"))

		if valid_till and frappe.utils.getdate(valid_till) < frappe.utils.getdate(frappe.utils.today()):
			frappe.throw(_("Valid until date cannot be in the past."))

		company = _get_default_company()

		_validate_party(company, party_type, customer)
		_validate_party_address(customer_address, party_type, customer, "billing address")
		_validate_party_address(shipping_address, party_type, customer, "shipping address")

		qtn = _build_quotation_doc(customer, warehouse, items, valid_till, customer_address, shipping_address, company, terms, transaction_date, party_type)
		qtn.run_method("set_missing_values")
		_validate_min_selling_rate(qtn)
		_validate_item_discount_amounts(qtn)
		_apply_order_level_discount(qtn, additional_discount_type, additional_discount_value)

		qtn.insert(ignore_permissions=True)
		return {
			"name": qtn.name,
			"docstatus": qtn.docstatus,
			"total": qtn.total,
			"grand_total": qtn.grand_total,
			"rounded_total": qtn.rounded_total,
			"disable_rounded_total": qtn.disable_rounded_total,
		}
	except Exception:
		frappe.log_error(
			title=f"DMS Quotation create failed for {frappe.session.user}",
			message=f"{party_type}={customer}, warehouse={warehouse}\n\n{frappe.get_traceback()}",
		)
		raise
