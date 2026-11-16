"""Read-only notification feed: changes made by other people to the session user's own Sales Orders.

Built from records Frappe already keeps (Version, Comment, Delivery Note Item, Sales Invoice Item).
No new DocType, no hooks.
"""

import json

import frappe
from frappe import _
from frappe.utils import add_days, cint, get_datetime, now_datetime, strip_html

SEEN_KEY = "dms_order_notif_seen"
LOOKBACK_DAYS = 30
MAX_ORDERS = 500
MAX_LIMIT = 50
COMMENT_TYPES = ("Comment", "Info", "Workflow", "Assigned", "Attachment")
SKIP_FIELDS = {"modified", "modified_by", "creation", "idx", "_comments", "_assign", "_seen", "_liked_by"}


def _require_login():
	if frappe.session.user == "Guest":
		frappe.throw(_("Not logged in"), frappe.AuthenticationError)


def _short(value, length=40):
	text = "" if value is None else str(value)
	return text if len(text) <= length else text[: length - 1] + "…"


def _full_names(users):
	users = [u for u in set(users) if u]
	if not users:
		return {}
	rows = frappe.get_all("User", filters={"name": ["in", users]}, fields=["name", "full_name"])
	return {r.name: r.full_name or r.name for r in rows}


def _version_items(orders, since, user):
	meta = frappe.get_meta("Sales Order")
	rows = frappe.get_all(
		"Version",
		filters={
			"ref_doctype": "Sales Order",
			"docname": ["in", list(orders)],
			"owner": ["!=", user],
			"creation": [">=", since],
		},
		fields=["name", "docname", "owner", "creation", "data"],
		order_by="creation desc",
		limit_page_length=200,
	)
	items = []
	for r in rows:
		try:
			data = json.loads(r.data or "{}")
		except ValueError:
			continue
		kind, title, parts = "change", _("Order updated"), []
		for field, old, new in data.get("changed") or []:
			if field == "docstatus":
				if new == 1:
					kind, title = "submit", _("Order submitted")
				elif new == 2:
					kind, title = "cancel", _("Order cancelled")
				continue
			if field in SKIP_FIELDS or (not old and not new):
				continue
			label = meta.get_label(field) or field
			parts.append(f"{label}: {_short(old) or '—'} → {_short(new) or '—'}")
		if data.get("added") or data.get("removed") or data.get("row_changed"):
			parts.append(_("Items updated"))
		if kind == "change" and not parts:
			continue
		detail = "; ".join(parts[:2])
		if len(parts) > 2:
			detail += " " + _("and {0} more").format(len(parts) - 2)
		items.append({
			"id": f"Version:{r.name}", "kind": kind, "order": r.docname,
			"owner": r.owner, "time": r.creation, "title": title, "detail": detail,
		})
	return items


def _comment_items(orders, since, user):
	rows = frappe.get_all(
		"Comment",
		filters={
			"reference_doctype": "Sales Order",
			"reference_name": ["in", list(orders)],
			"comment_type": ["in", COMMENT_TYPES],
			"owner": ["!=", user],
			"creation": [">=", since],
		},
		fields=["name", "reference_name", "comment_type", "owner", "creation", "content"],
		order_by="creation desc",
		limit_page_length=200,
	)
	titles = {
		"Comment": _("New comment"), "Info": _("Order activity"), "Workflow": _("Workflow update"),
		"Assigned": _("Assignment"), "Attachment": _("File attached"),
	}
	return [{
		"id": f"Comment:{r.name}",
		"kind": "comment" if r.comment_type == "Comment" else "change",
		"order": r.reference_name, "owner": r.owner, "time": r.creation,
		"title": titles.get(r.comment_type, _("Order activity")),
		"detail": _short(strip_html(r.content or "").strip(), 140),
	} for r in rows]


def _linked_items(orders, since, user, doctype, child_doctype, link_field, kind):
	parent = frappe.qb.DocType(doctype)
	child = frappe.qb.DocType(child_doctype)
	rows = (
		frappe.qb.from_(child)
		.join(parent).on(parent.name == child.parent)
		.select(parent.name, child[link_field].as_("sales_order"), parent.owner, parent.creation)
		.where(child[link_field].isin(list(orders)))
		.where(parent.docstatus == 1)
		.where(parent.owner != user)
		.where(parent.creation >= since)
		.distinct()
		.limit(200)
		.run(as_dict=True)
	)
	return [{
		"id": f"{doctype}:{r.name}:{r.sales_order}", "kind": kind, "order": r.sales_order,
		"owner": r.owner, "time": r.creation,
		"title": _("{0} created").format(_(doctype)), "detail": r.name,
	} for r in rows]


@frappe.whitelist(methods=["GET"])
def get_notifications(limit: int = 30):
	"""Changes by other people to Sales Orders the session user created, newest first."""
	_require_login()
	user = frappe.session.user
	limit = max(1, min(cint(limit) or 30, MAX_LIMIT))
	since = add_days(now_datetime(), -LOOKBACK_DAYS)

	orders = {
		r.name: r.customer_name
		for r in frappe.get_all(
			"Sales Order",
			filters={"owner": user, "modified": [">=", since]},
			fields=["name", "customer_name"],
			order_by="modified desc",
			limit_page_length=MAX_ORDERS,
		)
	}
	if not orders:
		return {"items": [], "unread": 0}

	items = (
		_version_items(orders, since, user)
		+ _comment_items(orders, since, user)
		+ _linked_items(orders, since, user, "Delivery Note", "Delivery Note Item", "against_sales_order", "delivery")
		+ _linked_items(orders, since, user, "Sales Invoice", "Sales Invoice Item", "sales_order", "invoice")
	)
	items.sort(key=lambda i: get_datetime(i["time"]), reverse=True)
	items = items[:limit]

	seen = frappe.defaults.get_user_default(SEEN_KEY)
	seen_dt = get_datetime(seen) if seen else None
	names = _full_names(i["owner"] for i in items)
	unread = 0
	for i in items:
		i["customer_name"] = orders.get(i["order"]) or ""
		i["by"] = names.get(i.pop("owner"), "")
		i["unread"] = seen_dt is None or get_datetime(i["time"]) > seen_dt
		unread += i["unread"]
	return {"items": items, "unread": unread}


@frappe.whitelist(methods=["POST"])
def mark_notifications_seen():
	_require_login()
	frappe.defaults.set_user_default(SEEN_KEY, str(now_datetime()))
	return {"ok": True}
