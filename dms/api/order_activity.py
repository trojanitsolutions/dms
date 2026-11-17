"""Read-only activity timeline for one Sales Order: everything done to it, by anyone, newest first."""

import frappe
from frappe import _
from frappe.utils import get_datetime

from dms.api.order_comments import _check_order_access
from dms.api.order_notifications import (
	_comment_items,
	_full_names,
	_iso,
	_linked_items,
	_require_login,
	_version_items,
)

MAX_ITEMS = 100


@frappe.whitelist(methods=["GET"])
def get_order_activity(order: str):
	_require_login()
	_check_order_access(order)

	so = frappe.db.get_value("Sales Order", order, ["owner", "creation"], as_dict=True)
	orders = [order]
	items = (
		_version_items(orders, None, None)
		+ _comment_items(orders, None, None)
		+ _linked_items(orders, None, None, "Delivery Note", "Delivery Note Item", "against_sales_order", "delivery")
		+ _linked_items(orders, None, None, "Sales Invoice", "Sales Invoice Item", "sales_order", "invoice")
	)
	items.append({
		"id": f"Sales Order:{order}", "kind": "created", "order": order,
		"owner": so.owner, "time": so.creation, "title": _("Order created"), "detail": "",
	})
	items.sort(key=lambda i: get_datetime(i["time"]), reverse=True)
	items = items[:MAX_ITEMS]

	names = _full_names(i["owner"] for i in items)
	for i in items:
		owner = i.pop("owner")
		i["by"] = names.get(owner) or owner or ""
		i["time"] = _iso(i["time"])
	return {"items": items}
