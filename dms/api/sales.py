import json
import re
import frappe
from frappe import _


def _require_sales_rep():
    if frappe.session.user == "Guest":
        frappe.throw(_("Not logged in"), frappe.AuthenticationError)
    if not frappe.db.exists("Has Role", {"parent": frappe.session.user, "role": "Sales Rep"}):
        frappe.throw(_("Access Denied"), frappe.PermissionError)


def _get_default_company():
    company = frappe.defaults.get_user_default("company") or frappe.defaults.get_global_default("company")
    if not company:
        company = frappe.db.get_single_value("Global Defaults", "default_company")
    return company or ""


def _stock_validation_disabled():
    return bool(frappe.db.get_single_value("Sales Management Settings", "disable_stock_validation"))


def _is_probable_image(file_url):
    if not file_url:
        return False
    if "drive.google.com" in file_url:
        return True
    url = file_url.split("?")[0].lower()
    _IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".avif")
    return any(url.endswith(ext) for ext in _IMAGE_EXTS)


def _convert_drive_url_to_embed(file_url):

    if not file_url or "drive.google.com" not in file_url:
        return file_url
    file_id = None
    match = re.search(r'/file/d/([^/?]+)', file_url)
    if match:
        file_id = match.group(1)
    else:
        match = re.search(r'[?&]id=([^&]+)', file_url)
        if match:
            file_id = match.group(1)
    if file_id:
        return f"https://drive.google.com/thumbnail?id={file_id}&sz=w1000"
    return file_url

def _get_sales_person_for_user():
    user = frappe.session.user

    employee = frappe.db.get_value(
        "Employee",
        {"user_id": user, "status": "Active"},
        "name",
    )
    if not employee:
        frappe.throw(
            _("No active Employee found for user {0}. Employee must have a user_id linked.").format(user),
            frappe.DoesNotExistError,
        )

    sales_person = frappe.db.get_value(
        "Sales Person",
        {"employee": employee, "enabled": 1},
        "name",
    )
    if not sales_person:
        frappe.throw(
            _("No enabled Sales Person found for Employee {0}. Sales Person must be linked to this Employee.").format(employee),
            frappe.DoesNotExistError,
        )

    return sales_person


def _resolve_discount(discount_type, discount_value):
	if not discount_type:
		return 0.0, 0.0

	discount_value = float(discount_value or 0)

	if discount_type == "Percentage":
		if discount_value < 0 or discount_value > 100:
			frappe.throw(_("Discount percentage must be between 0 and 100."))
		return discount_value, 0.0
	elif discount_type == "Amount":
		if discount_value < 0:
			frappe.throw(_("Discount amount must be non-negative."))
		return 0.0, discount_value
	else:
		frappe.throw(_("Invalid discount type: {0}. Must be 'Percentage' or 'Amount'.").format(discount_type))


def _validate_item_discount_amounts(so):
	for d in so.items:
		if d.discount_amount and d.price_list_rate:
			if frappe.utils.flt(d.discount_amount) > frappe.utils.flt(d.price_list_rate):
				frappe.throw(
					_("Item {0}: Discount amount {1} cannot exceed price list rate {2}.").format(
						d.item_code,
						frappe.utils.flt(d.discount_amount, 2),
						frappe.utils.flt(d.price_list_rate, 2),
					)
				)


def _apply_order_level_discount(so, additional_discount_type, additional_discount_value):
	so.run_method("calculate_taxes_and_totals")

	if not additional_discount_type:
		return

	discount_percentage, discount_amount = _resolve_discount(additional_discount_type, additional_discount_value)

	pre_discount_grand_total = frappe.utils.flt(so.grand_total)

	if discount_amount > pre_discount_grand_total:
		frappe.throw(
			_("Order discount amount {0} cannot exceed grand total {1}.").format(
				frappe.utils.flt(discount_amount, 2),
				frappe.utils.flt(pre_discount_grand_total, 2),
			)
		)

	so.apply_discount_on = "Grand Total"
	so.additional_discount_percentage = discount_percentage
	so.discount_amount = discount_amount
	so.run_method("calculate_taxes_and_totals")


def _get_credit_info(customer, company=None):
    if not company:
        company = _get_default_company()

    from erpnext.selling.doctype.customer.customer import (
        get_credit_limit,
        get_customer_outstanding,
    )

    bypass = (
        frappe.db.get_value(
            "Customer Credit Limit",
            {"parent": customer, "parenttype": "Customer", "company": company},
            "bypass_credit_limit_check",
        )
        or False
    )

    credit_limit = float(get_credit_limit(customer, company) or 0)
    outstanding = float(
        get_customer_outstanding(
            customer, company, ignore_outstanding_sales_order=bypass
        )
        or 0
    )

    return {
        "company": company,
        "credit_limit": credit_limit,
        "outstanding": outstanding,
        "available_credit": max(0.0, credit_limit - outstanding),
    }


@frappe.whitelist(methods=["GET"])
def get_customer_credit(customer: str):
    _require_sales_rep()
    info = _get_credit_info(customer)
    status = frappe.db.get_value(
        "Customer", customer, ["disabled", "is_frozen"], as_dict=True
    ) or {}
    info["disabled"] = bool(status.get("disabled"))
    info["is_frozen"] = bool(status.get("is_frozen"))
    return info


@frappe.whitelist(methods=["GET"])
def get_company_logo():
    _require_sales_rep()
    company = _get_default_company()
    if not company:
        return None
    logo = frappe.db.get_value("Company", company, "company_logos")
    return logo or None


@frappe.whitelist(methods=["GET"])
def get_sales_settings():
    _require_sales_rep()
    return {
        "disable_stock_validation": _stock_validation_disabled(),
        "default_warehouse": frappe.db.get_single_value("Stock Settings", "default_warehouse"),
    }


@frappe.whitelist(methods=["GET"])
def get_dashboard_stats():
    _require_sales_rep()
    today = frappe.utils.today()
    user = frappe.session.user

    today_sales = (
        frappe.db.sql(
            """SELECT COALESCE(SUM(grand_total), 0)
               FROM `tabSales Order`
               WHERE owner=%s AND transaction_date=%s AND docstatus!=2""",
            (user, today),
        )[0][0]
        or 0
    )

    today_orders = frappe.db.count(
        "Sales Order",
        {"owner": user, "transaction_date": today, "docstatus": ["!=", 2]},
    )

    recent_orders = frappe.get_all(
        "Sales Order",
        filters={"owner": user, "docstatus": ["!=", 2]},
        fields=["name", "customer_name", "grand_total", "status", "transaction_date", "creation"],
        order_by="creation desc",
        limit=8,
    )

    return {
        "today_sales": today_sales,
        "today_orders": today_orders,
        "recent_orders": recent_orders,
    }


@frappe.whitelist(methods=["GET"])
def get_customers(search: str = ""):
    _require_sales_rep()
    company = _get_default_company()
    filters = {}
    or_filters = {}
    if search:
        or_filters = {
            "customer_name": ["like", f"%{search}%"],
            "name": ["like", f"%{search}%"],
        }

    customers = frappe.get_all(
        "Customer",
        filters=filters,
        or_filters=or_filters if or_filters else None,
        fields=["name", "customer_name", "territory", "mobile_no", "customer_group", "is_frozen", "disabled"],
        limit=200,
        order_by="customer_name",
    )

    from erpnext.selling.doctype.customer.customer import get_customer_outstanding

    for c in customers:
        bypass = (
            frappe.db.get_value(
                "Customer Credit Limit",
                {"parent": c["name"], "parenttype": "Customer", "company": company},
                "bypass_credit_limit_check",
            )
            or False
        )
        c["outstanding"] = float(
            get_customer_outstanding(c["name"], company, ignore_outstanding_sales_order=bypass) or 0
        )

    return customers


@frappe.whitelist(methods=["GET"])
def get_customer_addresses(customer: str):
    _require_sales_rep()
    return frappe.get_all(
        "Address",
        filters=[
            ["Dynamic Link", "link_doctype", "=", "Customer"],
            ["Dynamic Link", "link_name", "=", customer],
            ["Dynamic Link", "parenttype", "=", "Address"],
            ["disabled", "=", 0],
        ],
        fields=["name", "address_title", "address_line1", "address_line2", "city", "state", "country", "pincode"],
        order_by="is_primary_address desc, creation asc",
    )


@frappe.whitelist(methods=["POST"])
def create_customer(customer_name: str, territory: str = "All Territories", mobile_no: str = ""):
    _require_sales_rep()
    customer = frappe.get_doc(
        {
            "doctype": "Customer",
            "customer_name": customer_name,
            "customer_type": "Company",
            "customer_group": frappe.db.get_single_value("Selling Settings", "customer_group")
            or "Commercial",
            "territory": territory,
            "mobile_no": mobile_no,
        }
    )
    customer.insert(ignore_permissions=True)
    return {"name": customer.name, "customer_name": customer.customer_name}


@frappe.whitelist(methods=["GET"])
def get_warehouses():
    _require_sales_rep()
    return frappe.get_all(
        "Warehouse",
        filters={"is_group": 0, "disabled": 0},
        fields=["name", "warehouse_name"],
        order_by="warehouse_name",
    )


@frappe.whitelist(methods=["GET"])
def get_item_groups():
    _require_sales_rep()
    return frappe.get_all(
        "Item Group",
        filters={"is_group": 0},
        fields=["name"],
        order_by="name",
    )


@frappe.whitelist(methods=["GET"])
def get_items(warehouse: str = "", search: str = "", item_group: str = ""):
    _require_sales_rep()
    filters = {"disabled": 0, "is_sales_item": 1}
    if item_group and item_group != "All":
        filters["item_group"] = item_group

    get_all_kwargs = dict(
        filters=filters,
        fields=["name", "item_name", "item_group", "standard_rate", "image", "stock_uom", "description"],
        limit=10000,
        order_by="item_name",
    )
    if search:
        get_all_kwargs["or_filters"] = [
            ["item_name", "like", f"%{search}%"],
            ["name", "like", f"%{search}%"],
            ["item_group", "like", f"%{search}%"],
            ["description", "like", f"%{search}%"],
        ]

    items = frappe.get_all("Item", **get_all_kwargs)

    if not items:
        return items

    item_codes = [i["name"] for i in items]

    # Selling rate: prefer default selling price list, fall back to Item.standard_rate
    selling_pl = (
        frappe.db.get_single_value("Selling Settings", "selling_price_list")
        or "Standard Selling"
    )

    # Use ERPNext's standard get_item_price() to resolve prices, matching the order-creation flow.
    # This ensures catalog display price == order resolved price (no divergence between listing
    # and order due to UOM/customer/validity filters in get_item_price()).
    from erpnext.stock.get_item_details import get_item_price

    price_map = {}
    for item in items:
        price_list_rates = get_item_price(
            {
                "price_list": selling_pl,
                "uom": item.get("stock_uom", ""),
                "transaction_date": frappe.utils.today(),
            },
            item["name"],
            ignore_party=True,  # No customer context yet; match generic rows only
        )
        if price_list_rates:
            price_map[item["name"]] = float(price_list_rates[0].get("price_list_rate") or 0)
        frappe.logger().debug(
            f"DEBUG get_items resolved price: item={item['name']}, price_list={selling_pl}, "
            f"uom={item.get('stock_uom')}, resolved_rate={price_map.get(item['name'], 'N/A')}"
        )

    # Load attachment images — prioritize attachments, fall back to Item.image field
    item_codes = [i["name"] for i in items]
    img_map = {}
    attach_rows = frappe.db.sql(
        """SELECT attached_to_name AS item_code, file_url
           FROM `tabFile`
           WHERE attached_to_doctype = 'Item'
             AND attached_to_name IN %(codes)s
           ORDER BY attached_to_name, creation ASC""",
        {"codes": item_codes},
        as_dict=True,
    )
    for r in attach_rows:
        if r.item_code not in img_map and _is_probable_image(r.file_url):
            img_map[r.item_code] = _convert_drive_url_to_embed(r.file_url)

    bins = frappe.db.sql(
        """SELECT item_code, warehouse, actual_qty, COALESCE(reserved_stock, 0) AS reserved_stock
           FROM `tabBin`
           WHERE item_code IN %(codes)s""",
        {"codes": item_codes},
        as_dict=True,
    )

    # DEBUG: Log bin query results
    frappe.logger().info(f"DEBUG get_items: items_count={len(items)}, bins_count={len(bins)}, warehouse_param={warehouse}")

    wh_stock = {}
    wh_available = {}
    for b in bins:
        actual = float(b.actual_qty or 0)
        reserved = float(b.reserved_stock or 0)
        avail = max(0.0, actual - reserved)
        wh_stock.setdefault(b.item_code, {})[b.warehouse] = actual
        wh_available.setdefault(b.item_code, {})[b.warehouse] = avail

    items_with_stock = 0
    for item in items:
        pl_rate = price_map.get(item["name"])
        if pl_rate:
            item["standard_rate"] = pl_rate
        # Prioritize attachment image (local file), fall back to Item.image field
        if item["name"] in img_map:
            item["image"] = img_map[item["name"]]
        elif item.get("image"):
            # Only convert Google Drive URLs; other URLs used as-is
            item["image"] = _convert_drive_url_to_embed(item["image"]) if "drive.google.com" in item.get("image", "") else item["image"]
        else:
            item["image"] = None
        stock_map = wh_stock.get(item["name"], {})
        avail_map = wh_available.get(item["name"], {})
        item["warehouse_stocks"] = stock_map
        item["warehouse_available"] = avail_map
        item["any_stock"] = any(q > 0 for q in avail_map.values()) if avail_map else False
        item["stock_qty"] = float(avail_map.get(warehouse, 0)) if warehouse else None
        item["in_stock"] = item["any_stock"]
        if item["any_stock"]:
            items_with_stock += 1
            if items_with_stock <= 5:
                frappe.logger().info(f"DEBUG item with stock: {item['name']}, any_stock={item['any_stock']}, warehouse_available={avail_map}")

    frappe.logger().info(f"DEBUG final: returning {len(items)} items, {items_with_stock} with any_stock=True")
    return items


def _build_sales_order_doc(customer: str, warehouse: str, items: list, delivery_date: str, customer_address: str, shipping_address: str, company: str, sales_person: str, disable_stock_validation: bool = False):
	doc_items = []
	for it in items:
		discount_percentage, discount_amount = _resolve_discount(it.get("discount_type"), it.get("discount_value"))

		item_row = {
			"item_code": it["item_code"],
			"qty": it["qty"],
			"rate": it.get("rate"),
			"price_list_rate": it.get("rate"),
			"warehouse": warehouse,
			"discount_percentage": discount_percentage,
			"discount_amount": discount_amount,
		}

		doc_items.append(item_row)

	selling_price_list = (
		frappe.db.get_single_value("Selling Settings", "selling_price_list")
		or "Standard Selling"
	)

	doc_dict = {
		"doctype": "Sales Order",
		"customer": customer,
		"company": company,
		"transaction_date": frappe.utils.today(),
		"delivery_date": delivery_date or frappe.utils.today(),
		"customer_address": customer_address or None,
		"shipping_address_name": shipping_address or None,
		"disable_rounded_total": frappe.db.get_single_value("Global Defaults", "disable_rounded_total") or 0,
		"selling_price_list": selling_price_list,
		"items": doc_items,
		"sales_team": [
			{
				"sales_person": sales_person,
				"allocated_percentage": 100,
			}
		],
	}

	if disable_stock_validation:
		doc_dict["reserve_stock"] = 0

	return frappe.get_doc(doc_dict)


@frappe.whitelist(methods=["POST"])
def get_order_totals(customer: str, warehouse: str, items_json: str, delivery_date: str = "", customer_address: str = "", shipping_address: str = "", additional_discount_type: str = "", additional_discount_value: float = 0):
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
	disable_stock_validation = _stock_validation_disabled()
	so = _build_sales_order_doc(customer, warehouse, items, delivery_date, customer_address, shipping_address, company, sales_person, disable_stock_validation)
	so.run_method("set_missing_values")
	for d in so.items:
		frappe.logger().debug(
			f"DEBUG get_order_totals after set_missing_values: item={d.item_code}, "
			f"price_list_rate={d.price_list_rate}, rate={d.rate}, qty={d.qty}, amount={d.amount}"
		)
	_validate_item_discount_amounts(so)
	_apply_order_level_discount(so, additional_discount_type, additional_discount_value)

	return {
		"total": so.total,
		"total_taxes_and_charges": so.total_taxes_and_charges,
		"grand_total": so.grand_total,
		"rounding_adjustment": so.rounding_adjustment,
		"rounded_total": so.rounded_total,
		"disable_rounded_total": so.disable_rounded_total,
		"additional_discount_percentage": so.additional_discount_percentage or 0,
		"discount_amount": so.discount_amount or 0,
		"items": [{"item_code": d.item_code, "qty": d.qty, "rate": d.rate, "amount": d.amount, "discount_percentage": d.discount_percentage or 0, "discount_amount": d.discount_amount or 0} for d in so.items],
		"taxes": [{"description": t.description, "tax_amount": t.tax_amount, "total": t.total} for t in so.taxes],
	}


@frappe.whitelist(methods=["POST"])
def create_sales_order(customer: str, warehouse: str, items_json: str, delivery_date: str = "", customer_address: str = "", shipping_address: str = "", additional_discount_type: str = "", additional_discount_value: float = 0):
    _require_sales_rep()
    items = json.loads(items_json)
    if not items:
        frappe.throw(_("No items in order"))
    if not delivery_date:
        delivery_date = frappe.utils.today()
    if frappe.utils.getdate(delivery_date) < frappe.utils.getdate(frappe.utils.today()):
        frappe.throw(_("Delivery date cannot be in the past."))

    company = _get_default_company()
    disable_stock_validation = _stock_validation_disabled()

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

    if not disable_stock_validation:
        item_codes = [it["item_code"] for it in items]
        bin_rows = frappe.db.sql(
            """SELECT item_code, GREATEST(0, actual_qty - COALESCE(reserved_stock, 0)) AS avail
               FROM `tabBin`
               WHERE item_code IN %(codes)s AND warehouse = %(wh)s""",
            {"codes": item_codes, "wh": warehouse},
            as_dict=True,
        )
        avail_map = {b.item_code: float(b.avail) for b in bin_rows}
        for it in items:
            avail = avail_map.get(it["item_code"], 0.0)
            if float(it["qty"]) > avail:
                frappe.throw(
                    _(
                        "Insufficient stock for {0}: requested {1}, available {2} in {3}."
                    ).format(it["item_code"], float(it["qty"]), avail, warehouse)
                )

    sales_person = _get_sales_person_for_user()
    so = _build_sales_order_doc(customer, warehouse, items, delivery_date, customer_address, shipping_address, company, sales_person, disable_stock_validation)
    so.run_method("set_missing_values")
    for d in so.items:
        frappe.logger().debug(
            f"DEBUG create_sales_order after set_missing_values: item={d.item_code}, "
            f"price_list_rate={d.price_list_rate}, rate={d.rate}, qty={d.qty}, amount={d.amount}"
        )
    _validate_item_discount_amounts(so)
    _apply_order_level_discount(so, additional_discount_type, additional_discount_value)

    credit_info = _get_credit_info(customer, company)
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

    _user = frappe.session.user
    frappe.session.user = "Administrator"
    frappe.local.role_permissions = {}
    frappe.local.user_perms = None
    try:
        so.submit()
    finally:
        frappe.session.user = _user
        frappe.local.role_permissions = {}
        frappe.local.user_perms = None
    return {
        "name": so.name,
        "total": so.total,
        "grand_total": so.grand_total,
        "rounded_total": so.rounded_total,
        "disable_rounded_total": so.disable_rounded_total,
        "additional_discount_percentage": so.additional_discount_percentage or 0,
        "discount_amount": so.discount_amount or 0,
    }


@frappe.whitelist(methods=["GET"])
def get_my_orders(customer: str = ""):
    _require_sales_rep()
    filters = {"owner": frappe.session.user, "docstatus": ["!=", 2]}
    if customer:
        filters["customer"] = customer
    return frappe.get_all(
        "Sales Order",
        filters=filters,
        fields=["name", "customer", "customer_name", "grand_total", "status", "transaction_date"],
        order_by="creation desc",
        limit=50,
    )


@frappe.whitelist(methods=["GET"])
def get_customer_detail(customer: str):
    _require_sales_rep()
    c = frappe.db.get_value(
        "Customer",
        customer,
        ["name", "customer_name", "territory", "mobile_no", "disabled", "is_frozen"],
        as_dict=True,
    )
    if not c:
        frappe.throw(_("Customer not found"), frappe.DoesNotExistError)

    credit_info = _get_credit_info(customer)
    c["outstanding"] = credit_info["outstanding"]
    c["company"] = credit_info["company"]

    c["recent_orders"] = frappe.get_all(
        "Sales Order",
        filters={"customer": customer, "docstatus": ["!=", 2]},
        fields=["name", "grand_total", "status", "transaction_date", "creation"],
        order_by="creation desc",
        limit=5,
    )
    return c
