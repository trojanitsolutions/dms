import json
from zoneinfo import ZoneInfo

import frappe
from frappe import _
from frappe.utils import escape_html, get_datetime, get_system_timezone

from dms.utils import get_owner_filter

MAX_COMMENT_LENGTH = 2000
MAX_BATCH = 100


def _iso(value):
	"""Naive system-time datetime -> ISO string with offset (e.g. 2026-11-16T15:58:00+03:00)."""
	if not value:
		return value
	dt = get_datetime(value).replace(microsecond=0)
	return dt.replace(tzinfo=ZoneInfo(get_system_timezone())).isoformat()


def _require_login():
	if frappe.session.user == "Guest":
		frappe.throw(_("Not logged in"), frappe.AuthenticationError)


def _check_order_access(order: str):
	"""Allow the same Sales Orders that Order History lists for this user."""
	if not order or not frappe.db.exists("Sales Order", order):
		frappe.throw(_("Sales Order not found"), frappe.DoesNotExistError)
	owner = get_owner_filter()
	if owner and frappe.db.get_value("Sales Order", order, "owner") != owner:
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	if not frappe.has_permission("Sales Order", "read", doc=order):
		frappe.throw(_("Not permitted"), frappe.PermissionError)


@frappe.whitelist(methods=["GET"])
def get_comment_counts(orders: str):
	"""Return {order_name: comment_count} for the given orders the user can see."""
	_require_login()
	names = json.loads(orders) if isinstance(orders, str) else orders
	names = [n for n in (names or []) if isinstance(n, str)][:MAX_BATCH]
	if not names:
		return {}

	filters = {"name": ["in", names], "docstatus": ["!=", 2]}
	owner = get_owner_filter()
	if owner:
		filters["owner"] = owner
	allowed = frappe.get_all("Sales Order", filters=filters, pluck="name")
	if not allowed:
		return {}

	rows = frappe.get_all(
		"Comment",
		filters={"reference_doctype": "Sales Order", "reference_name": ["in", allowed], "comment_type": "Comment"},
		fields=["reference_name", {"COUNT": "name", "as": "count"}],
		group_by="reference_name",
	)
	return {r["reference_name"]: r["count"] for r in rows}


@frappe.whitelist(methods=["GET"])
def get_order_comments(order: str):
	_require_login()
	_check_order_access(order)
	rows = frappe.get_all(
		"Comment",
		filters={"reference_doctype": "Sales Order", "reference_name": order, "comment_type": "Comment"},
		fields=["name", "content", "comment_email", "comment_by", "owner", "creation"],
		order_by="creation desc",
		limit_page_length=200,
	)
	for r in rows:
		r["creation"] = _iso(r["creation"])
	return rows


@frappe.whitelist(methods=["POST"])
def add_order_comment(order: str, content: str):
	_require_login()
	_check_order_access(order)
	text = (content or "").strip()
	if not text:
		frappe.throw(_("Comment cannot be empty"))
	if len(text) > MAX_COMMENT_LENGTH:
		frappe.throw(_("Comment is too long (max {0} characters)").format(MAX_COMMENT_LENGTH))

	html = escape_html(text).replace("\n", "<br>")
	user = frappe.session.user
	full_name = frappe.db.get_value("User", user, "full_name") or user
	doc = frappe.get_doc("Sales Order", order)
	comment = doc.add_comment("Comment", html, comment_email=user, comment_by=full_name)
	return {
		"name": comment.name,
		"content": comment.content,
		"comment_email": comment.comment_email,
		"comment_by": comment.comment_by,
		"owner": comment.owner,
		"creation": _iso(comment.creation),
	}
