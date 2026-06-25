import json
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


def _get_credit_info(customer, company=None):
    if not company:
        company = _get_default_company()

    # Use ERPNext's get_credit_limit if available (checks customer group fallback)
    credit_limit = 0.0
    try:
        from erpnext.accounts.party import get_credit_limit as erp_credit_limit
        credit_limit = float(erp_credit_limit(customer, company) or 0)
    except Exception:
        credit_limit = float(
            frappe.db.get_value(
                "Customer Credit Limit",
                {"parent": customer, "parenttype": "Customer", "company": company},
                "credit_limit",
            )
            or 0
        )

    # Outstanding = sum of unpaid Sales Invoice amounts (outstanding_amount is already net-of-payments)
    outstanding = float(
        frappe.db.sql(
            """SELECT COALESCE(SUM(outstanding_amount), 0)
               FROM `tabSales Invoice`
               WHERE customer = %s AND company = %s AND docstatus = 1""",
            (customer, company),
        )[0][0]
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
    return _get_credit_info(customer)


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
    filters = {"disabled": 0}
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
        fields=["name", "customer_name", "territory", "mobile_no", "customer_group"],
        limit=60,
        order_by="customer_name",
    )

    for c in customers:
        c["outstanding"] = float(
            frappe.db.sql(
                """SELECT COALESCE(SUM(outstanding_amount), 0)
                   FROM `tabSales Invoice`
                   WHERE customer = %s AND company = %s AND docstatus = 1""",
                (c["name"], company),
            )[0][0]
            or 0
        )
        info = _get_credit_info(c["name"], company)
        c["credit_limit"] = info["credit_limit"]
        c["available_credit"] = info["available_credit"]

    return customers


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
    if search:
        filters["item_name"] = ["like", f"%{search}%"]
    if item_group and item_group != "All":
        filters["item_group"] = item_group

    items = frappe.get_all(
        "Item",
        filters=filters,
        fields=["name", "item_name", "item_group", "standard_rate", "image"],
        limit=100,
        order_by="item_name",
    )

    if not items:
        return items

    item_codes = [i["name"] for i in items]

    # Selling rate: prefer default selling price list, fall back to Item.standard_rate
    selling_pl = (
        frappe.db.get_single_value("Selling Settings", "selling_price_list")
        or "Standard Selling"
    )
    price_rows = frappe.db.sql(
        """SELECT item_code, price_list_rate
           FROM `tabItem Price`
           WHERE item_code IN %(codes)s
             AND price_list = %(pl)s
             AND selling = 1""",
        {"codes": item_codes, "pl": selling_pl},
        as_dict=True,
    )
    price_map = {p.item_code: float(p.price_list_rate or 0) for p in price_rows}

    bins = frappe.db.sql(
        """SELECT item_code, warehouse, actual_qty
           FROM `tabBin`
           WHERE item_code IN %(codes)s AND actual_qty > 0""",
        {"codes": item_codes},
        as_dict=True,
    )

    wh_stock = {}
    for b in bins:
        wh_stock.setdefault(b.item_code, {})[b.warehouse] = float(b.actual_qty)

    for item in items:
        pl_rate = price_map.get(item["name"])
        if pl_rate:
            item["standard_rate"] = pl_rate
        stock_map = wh_stock.get(item["name"], {})
        item["warehouse_stocks"] = stock_map
        item["any_stock"] = len(stock_map) > 0
        item["stock_qty"] = float(stock_map.get(warehouse, 0)) if warehouse else None
        item["in_stock"] = item["any_stock"]

    return items


@frappe.whitelist(methods=["POST"])
def create_sales_order(customer: str, warehouse: str, items_json: str, delivery_date: str = ""):
    _require_sales_rep()
    items = json.loads(items_json)
    if not items:
        frappe.throw(_("No items in order"))
    if not delivery_date:
        delivery_date = frappe.utils.add_days(frappe.utils.today(), 7)

    # Server-side credit limit check
    company = _get_default_company()
    credit_info = _get_credit_info(customer, company)
    if credit_info["credit_limit"] > 0:
        grand_total = sum(float(it["qty"]) * float(it.get("rate", 0)) for it in items)
        if grand_total > credit_info["available_credit"]:
            frappe.throw(
                _(
                    "Order total ({0}) exceeds available credit ({1}). "
                    "Credit limit: {2}, Outstanding: {3}."
                ).format(
                    frappe.utils.flt(grand_total, 2),
                    frappe.utils.flt(credit_info["available_credit"], 2),
                    frappe.utils.flt(credit_info["credit_limit"], 2),
                    frappe.utils.flt(credit_info["outstanding"], 2),
                )
            )

    so = frappe.get_doc(
        {
            "doctype": "Sales Order",
            "customer": customer,
            "company": company,
            "transaction_date": frappe.utils.today(),
            "delivery_date": delivery_date,
            "items": [
                {
                    "item_code": it["item_code"],
                    "qty": it["qty"],
                    "warehouse": warehouse,
                    "rate": it.get("rate"),
                }
                for it in items
            ],
        }
    )
    so.insert(ignore_permissions=True)
    so.submit()
    return {"name": so.name, "grand_total": so.grand_total}


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
        ["name", "customer_name", "territory", "mobile_no"],
        as_dict=True,
    )
    if not c:
        frappe.throw(_("Customer not found"), frappe.DoesNotExistError)

    credit_info = _get_credit_info(customer)
    c["outstanding"] = credit_info["outstanding"]
    c["credit_limit"] = credit_info["credit_limit"]
    c["available_credit"] = credit_info["available_credit"]
    c["company"] = credit_info["company"]

    c["recent_orders"] = frappe.get_all(
        "Sales Order",
        filters={"customer": customer, "docstatus": ["!=", 2]},
        fields=["name", "grand_total", "status", "transaction_date", "creation"],
        order_by="creation desc",
        limit=5,
    )
    return c
