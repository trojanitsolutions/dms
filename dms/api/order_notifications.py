"""Read-only notification feed: changes made by other people to the session user's own
Sales Orders, Quotations and Sales Invoices.

Built from records Frappe already keeps (Version, Comment, Delivery Note Item, Sales Invoice Item).
No new DocType, no hooks.
"""

import json
from zoneinfo import ZoneInfo

import frappe
from frappe import _
from frappe.utils import add_days, cint, get_datetime, get_system_timezone, now_datetime, strip_html

SEEN_KEY = "dms_order_notif_seen"
CLEARED_KEY = "dms_order_notif_cleared"
LOOKBACK_DAYS = 30
MAX_ORDERS = 500
MAX_LIMIT = 50
COMMENT_TYPES = ("Comment", "Info", "Workflow", "Assigned", "Attachment")
# Doctypes whose own changes (Version, Comment) notify their creator; the noun is used in titles.
WATCHED_DOCTYPES = {"Sales Order": "Order", "Quotation": "Quotation", "Sales Invoice": "Invoice"}
SKIP_FIELDS = {"modified", "modified_by", "creation", "idx", "_comments", "_assign", "_seen", "_liked_by"}


def _require_login():
	if frappe.session.user == "Guest":
		frappe.throw(_("Not logged in"), frappe.AuthenticationError)


def _iso(value):
	"""Naive system-time datetime -> ISO string with offset (e.g. 2026-11-16T15:58:00+03:00)."""
	if not value:
		return value
	dt = get_datetime(value).replace(microsecond=0)
	return dt.replace(tzinfo=ZoneInfo(get_system_timezone())).isoformat()


def _add_scope(filters, since=None, user=None):
	"""Limit to records newer than `since` and not made by `user`; None skips that limit."""
	if user:
		filters["owner"] = ["!=", user]
	if since:
		filters["creation"] = [">=", since]


def _short(value, length=40):
	text = "" if value is None else strip_html(str(value)).strip()
	return text if len(text) <= length else text[: length - 1] + "…"


def _full_names(users):
	users = [u for u in set(users) if u]
	if not users:
		return {}
	rows = frappe.get_all("User", filters={"name": ["in", users]}, fields=["name", "full_name"])
	return {r.name: r.full_name or r.name for r in rows}


def _version_items(doctype, docs, since, user):
	meta = frappe.get_meta(doctype)
	noun = _(WATCHED_DOCTYPES.get(doctype, doctype))
	filters = {"ref_doctype": doctype, "docname": ["in", list(docs)]}
	_add_scope(filters, since, user)
	rows = frappe.get_all(
		"Version",
		filters=filters,
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
		kind, title, parts = "change", _("{0} updated").format(noun), []
		for field, old, new in data.get("changed") or []:
			if field == "docstatus":
				if new == 1:
					kind, title = "submit", _("{0} submitted").format(noun)
				elif new == 2:
					kind, title = "cancel", _("{0} cancelled").format(noun)
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
			"id": f"Version:{r.name}", "kind": kind, "doctype": doctype, "order": r.docname,
			"owner": r.owner, "time": r.creation, "title": title, "detail": detail,
		})
	return items


def _comment_items(doctype, docs, since, user):
	noun = _(WATCHED_DOCTYPES.get(doctype, doctype))
	filters = {
		"reference_doctype": doctype,
		"reference_name": ["in", list(docs)],
		"comment_type": ["in", COMMENT_TYPES],
	}
	_add_scope(filters, since, user)
	rows = frappe.get_all(
		"Comment",
		filters=filters,
		fields=["name", "reference_name", "comment_type", "owner", "creation", "content"],
		order_by="creation desc",
		limit_page_length=200,
	)
	titles = {
		"Comment": _("New comment"), "Info": _("{0} activity").format(noun),
		"Workflow": _("{0} updated").format(noun),
		"Assigned": _("Assignment"), "Attachment": _("File attached"),
	}
	return [{
		"id": f"Comment:{r.name}",
		"kind": "comment" if r.comment_type == "Comment" else "change",
		"doctype": doctype, "order": r.reference_name, "owner": r.owner, "time": r.creation,
		"title": titles.get(r.comment_type, titles["Info"]),
		"detail": _short(strip_html(r.content or "").strip(), 140),
	} for r in rows]


def _linked_items(orders, since, user, doctype, child_doctype, link_field, kind):
	parent = frappe.qb.DocType(doctype)
	child = frappe.qb.DocType(child_doctype)
	query = (
		frappe.qb.from_(child)
		.join(parent).on(parent.name == child.parent)
		.select(parent.name, child[link_field].as_("sales_order"), parent.owner, parent.creation)
		.where(child[link_field].isin(list(orders)))
		.where(parent.docstatus == 1)
	)
	if user:
		query = query.where(parent.owner != user)
	if since:
		query = query.where(parent.creation >= since)
	rows = query.distinct().limit(200).run(as_dict=True)
	return [{
		"id": f"{doctype}:{r.name}:{r.sales_order}", "kind": kind, "doctype": "Sales Order", "order": r.sales_order,
		"owner": r.owner, "time": r.creation,
		"title": _("{0} created").format(_(doctype)), "detail": r.name,
	} for r in rows]


def _owned_docs(doctype, user, since):
	"""The user's own documents of doctype touched in the lookback window, keyed by name."""
	fields = ["name", "customer_name"] + (["is_return"] if doctype == "Sales Invoice" else [])
	return {
		r.name: r
		for r in frappe.get_all(
			doctype,
			filters={"owner": user, "modified": [">=", since]},
			fields=fields,
			order_by="modified desc",
			limit_page_length=MAX_ORDERS,
		)
	}


@frappe.whitelist(methods=["GET"])
def get_notifications(limit: int = 30):
	"""Changes by other people to Sales Orders, Quotations and Sales Invoices the session user created, newest first."""
	_require_login()
	user = frappe.session.user
	limit = max(1, min(cint(limit) or 30, MAX_LIMIT))
	since = add_days(now_datetime(), -LOOKBACK_DAYS)

	owned = {doctype: _owned_docs(doctype, user, since) for doctype in WATCHED_DOCTYPES}
	if not any(owned.values()):
		return {"items": [], "unread": 0}

	# Items before the last "Clear all" are hidden; the orders list keeps the full lookback window.
	cleared = frappe.defaults.get_user_default(CLEARED_KEY)
	cleared_dt = get_datetime(cleared) if cleared else None
	if cleared_dt and cleared_dt > since:
		since = cleared_dt

	items = []
	for doctype, docs in owned.items():
		if docs:
			items += _version_items(doctype, docs, since, user) + _comment_items(doctype, docs, since, user)
	orders = owned["Sales Order"]
	if orders:
		items += _linked_items(orders, since, user, "Delivery Note", "Delivery Note Item", "against_sales_order", "delivery")
		items += _linked_items(orders, since, user, "Sales Invoice", "Sales Invoice Item", "sales_order", "invoice")
	if cleared_dt:
		items = [i for i in items if get_datetime(i["time"]) > cleared_dt]
	items.sort(key=lambda i: get_datetime(i["time"]), reverse=True)
	items = items[:limit]

	seen = frappe.defaults.get_user_default(SEEN_KEY)
	seen_dt = get_datetime(seen) if seen else None
	names = _full_names(i["owner"] for i in items)
	unread = 0
	for i in items:
		doc = owned[i["doctype"]].get(i["order"]) or {}
		i["customer_name"] = doc.get("customer_name") or ""
		i["is_return"] = cint(doc.get("is_return"))
		i["by"] = names.get(i.pop("owner"), "")
		i["unread"] = seen_dt is None or get_datetime(i["time"]) > seen_dt
		unread += i["unread"]
		i["time"] = _iso(i["time"])
	return {"items": items, "unread": unread}


@frappe.whitelist(methods=["POST"])
def mark_notifications_seen():
	_require_login()
	frappe.defaults.set_user_default(SEEN_KEY, str(now_datetime()))
	return {"ok": True}


@frappe.whitelist(methods=["POST"])
def clear_notifications():
	"""Hide every current item from the bell. Records stay; only the feed's start time moves."""
	_require_login()
	now = str(now_datetime())
	frappe.defaults.set_user_default(CLEARED_KEY, now)
	frappe.defaults.set_user_default(SEEN_KEY, now)
	return {"ok": True}
