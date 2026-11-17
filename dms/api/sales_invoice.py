import json

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate

from dms.utils import apply_status_filter, apply_workflow_status, get_owner_filter

INVOICE_FIELDS = [
	"name", "customer", "customer_name", "posting_date", "due_date",
	"grand_total", "rounded_total", "disable_rounded_total", "outstanding_amount",
	"status", "docstatus", "is_return", "return_against",
]
ITEM_FIELDS = ["parent", "item_code", "item_name", "qty", "rate", "amount", "uom", "sales_order"]
# Sales Management Settings "Sales Invoice Based On" → docstatus filter (cancelled never shown).
DOCSTATUS_BY_MODE = {"Draft": 0, "Submitted": 1, "All": ["in", [0, 1]]}


@frappe.whitelist(methods=["GET"])
def get_sales_invoices(kind: str = "invoices", search: str = "", invoice_id: str = "", customer: str = "", sales_order: str = "", submitted_only: int = 0, posting_date: str = "", from_date: str = "", to_date: str = "", status: str = "", limit_start: int = 0, limit_page_length: int = 20):
	"""List Sales Invoices for the sales portal.

	kind="invoices": normal invoices, limited by Sales Management Settings.
	kind="returns": credit notes, draft and submitted (returns made from the
	portal are drafts, so they must stay visible whatever the setting).
	submitted_only=1: only submitted invoices (the return picker). Empty in Draft
	mode, where returns are not allowed.
	from_date/to_date: a posting date range; when either is set, posting_date is ignored.
	search: one box matching invoice no., customer, or a billed Sales Order (return picker).
	invoice_id / customer / sales_order: separate search fields; all filled ones must match.
	On returns, invoice_id also matches the original invoice (return_against).
	"""
	_require_permission("read")

	limit_start = cint(limit_start)
	limit_page_length = cint(limit_page_length) or 20
	based_on, show = _invoice_settings()

	returns = kind == "returns"
	if returns:
		filters = {"is_return": 1, "docstatus": ["in", [0, 1]]}
	elif cint(submitted_only):
		if based_on == "Draft":
			return {"invoices": [], "has_more": False, "based_on": based_on, "kind": "invoices"}
		filters = {"is_return": 0, "docstatus": 1}
	else:
		filters = {"is_return": 0, "docstatus": DOCSTATUS_BY_MODE[based_on]}
	visible = _individual_invoice_names(show)
	if visible is not None:
		if not visible:
			return {"invoices": [], "has_more": False, "based_on": based_on, "kind": "returns" if returns else "invoices"}
		filters["name"] = ["in", visible]
	date_filter = _posting_date_filter(posting_date, from_date, to_date)
	if date_filter:
		filters["posting_date"] = date_filter
	apply_status_filter("Sales Invoice", filters, status)

	# Separate search fields. Each adds its own AND condition, so use list filters
	# (a dict can hold only one condition on "name").
	filters = [[field, *(cond if isinstance(cond, list) else ["=", cond])] for field, cond in filters.items()]
	field_matches = _search_field_names(returns, invoice_id.strip(), customer.strip(), sales_order.strip())
	if field_matches is not None:
		if not field_matches:
			return {"invoices": [], "has_more": False, "based_on": based_on, "kind": "returns" if returns else "invoices"}
		filters.extend(["name", "in", names] for names in field_matches)

	or_filters = None
	if search:
		or_filters = [
			["name", "like", f"%{search}%"],
			["customer_name", "like", f"%{search}%"],
			["customer", "like", f"%{search}%"],
		]
		if returns:
			or_filters.append(["return_against", "like", f"%{search}%"])
		billed_orders = _invoices_with_order_like(search)
		if billed_orders:
			or_filters.append(["name", "in", billed_orders])

	# get_list applies role and user permissions of the session user.
	invoices = frappe.get_list(
		"Sales Invoice",
		filters=filters,
		or_filters=or_filters,
		fields=INVOICE_FIELDS,
		order_by="posting_date desc, creation desc, name desc",
		limit_start=limit_start,
		limit_page_length=limit_page_length + 1,
	)

	has_more = len(invoices) > limit_page_length
	invoices = apply_workflow_status("Sales Invoice", invoices[:limit_page_length])
	_attach_items(invoices)
	_attach_return_flags(invoices)
	return {
		"invoices": invoices, "has_more": has_more, "based_on": based_on,
		"kind": "returns" if returns else "invoices", "can_return": can_create_return(),
	}


@frappe.whitelist(methods=["GET"])
def search_invoice_customers(txt: str = "", kind: str = "invoices"):
	"""Customer suggestions (ID and name) for the Customer search field.
	Only customers on invoices the user can see in the given tab."""
	_require_permission("read")
	returns = kind == "returns"
	based_on, show = _invoice_settings()
	filters = {
		"is_return": 1 if returns else 0,
		"docstatus": ["in", [0, 1]] if returns else DOCSTATUS_BY_MODE[based_on],
	}
	visible = _individual_invoice_names(show)
	if visible is not None:
		if not visible:
			return []
		filters["name"] = ["in", visible]
	txt = txt.strip()
	or_filters = [["customer", "like", f"%{txt}%"], ["customer_name", "like", f"%{txt}%"]] if txt else None
	return frappe.get_list(
		"Sales Invoice",
		filters=filters,
		or_filters=or_filters,
		fields=["customer", "customer_name"],
		group_by="customer, customer_name",
		order_by="customer_name asc",
		limit_page_length=20,
	)


def _search_field_names(returns, invoice_id, customer, sales_order):
	"""Name lists for the filled search fields (each must match), or None when all are empty.
	Returns [] when a field matches nothing, so the caller can stop early."""
	if not (invoice_id or customer or sales_order):
		return None
	base = {"is_return": 1 if returns else 0}
	lists = []
	if invoice_id:
		match = [["name", "like", f"%{invoice_id}%"]]
		if returns:
			match.append(["return_against", "like", f"%{invoice_id}%"])
		lists.append(frappe.get_all("Sales Invoice", filters=base, or_filters=match, pluck="name"))
	if customer:
		match = [["customer", "like", f"%{customer}%"], ["customer_name", "like", f"%{customer}%"]]
		lists.append(frappe.get_all("Sales Invoice", filters=base, or_filters=match, pluck="name"))
	if sales_order:
		lists.append(_invoices_with_order_like(sales_order))
	return [] if any(not names for names in lists) else lists


def _posting_date_filter(posting_date, from_date, to_date):
	"""A From/To range wins over the single posting date."""
	if from_date and to_date:
		if getdate(from_date) > getdate(to_date):
			from_date, to_date = to_date, from_date
		return ["between", [from_date, to_date]]
	if from_date:
		return [">=", from_date]
	if to_date:
		return ["<=", to_date]
	return posting_date or None


def _invoices_with_order_like(search):
	"""Sales Invoices with an item billed against a Sales Order whose name matches."""
	si_item = frappe.qb.DocType("Sales Invoice Item")
	return (
		frappe.qb.from_(si_item)
		.select(si_item.parent).distinct()
		.where((si_item.parenttype == "Sales Invoice") & si_item.sales_order.like(f"%{search}%"))
	).run(pluck=True)


def _invoice_settings():
	settings = frappe.get_cached_doc("Sales Management Settings")
	based_on = settings.get("sales_invoice_based_on")
	if based_on not in DOCSTATUS_BY_MODE:
		based_on = "All"
	show = settings.get("show_sales_invoice") or "All"
	return based_on, show


def _individual_invoice_names(show):
	"""Invoice names the user may see in Individual mode, or None when there is no limit."""
	if show != "Individual":
		return None
	owner = get_owner_filter()
	return _invoices_from_orders_of(owner) if owner else None


def _invoices_from_orders_of(user):
	"""Sales Invoices billed against Sales Orders that the given sales person created."""
	si_item = frappe.qb.DocType("Sales Invoice Item")
	so = frappe.qb.DocType("Sales Order")
	rows = (
		frappe.qb.from_(si_item)
		.join(so).on(so.name == si_item.sales_order)
		.select(si_item.parent).distinct()
		.where((si_item.parenttype == "Sales Invoice") & (so.owner == user))
	).run(pluck=True)
	return rows


def _attach_items(invoices):
	if not invoices:
		return
	items = frappe.get_all(
		"Sales Invoice Item",
		filters={"parent": ["in", [i["name"] for i in invoices]], "parenttype": "Sales Invoice"},
		fields=ITEM_FIELDS,
		order_by="parent, idx",
	)
	by_parent = {}
	for it in items:
		by_parent.setdefault(it["parent"], []).append(it)
	for inv in invoices:
		inv["items"] = by_parent.get(inv["name"], [])


def _attach_return_flags(invoices):
	names = [i["name"] for i in invoices if i["docstatus"] == 1 and not i["is_return"]]
	returned = set()
	if names:
		returned = set(frappe.get_all(
			"Sales Invoice",
			filters={"return_against": ["in", names], "is_return": 1, "docstatus": ["<", 2]},
			pluck="return_against",
		))
	for inv in invoices:
		inv["has_returns"] = inv["name"] in returned


# ---------------------------------------------------------------------------
# Sales returns (credit notes). Saved as draft only; accounts submit them in Desk.
# ---------------------------------------------------------------------------

@frappe.whitelist(methods=["GET"])
def get_return_items(invoice: str):
	"""Items of a submitted invoice with the qty that can still be returned."""
	return_doc = _build_return(invoice)
	return {
		"invoice": invoice,
		"customer": return_doc.customer_name or return_doc.customer,
		"items": [
			{
				"si_detail": row.sales_invoice_item,
				"item_code": row.item_code,
				"item_name": row.item_name,
				"uom": row.uom,
				"rate": row.rate,
				"returnable": abs(flt(row.qty)),
			}
			for row in return_doc.items
		],
		"returns": _existing_returns(invoice),
	}


def _existing_returns(invoice):
	"""Draft and submitted credit notes made against the invoice, with their items.
	Drafts come first, newest first within each group."""
	returns = frappe.get_list(
		"Sales Invoice",
		filters={"return_against": invoice, "is_return": 1, "docstatus": ["<", 2]},
		fields=["name", "docstatus", "posting_date", "grand_total", "rounded_total", "disable_rounded_total"],
		order_by="docstatus asc, creation desc",
	)
	_attach_items(returns)
	return returns


@frappe.whitelist(methods=["POST"])
def create_sales_return(invoice: str, items):
	"""Save a draft return against the invoice. items = {si_detail: qty to return}."""
	requested = json.loads(items) if isinstance(items, str) else (items or {})
	return_doc = _build_return(invoice)
	if not return_doc.items:
		_throw_nothing_left(invoice)

	kept = []
	for row in return_doc.items:
		qty = flt(requested.get(row.sales_invoice_item))
		if qty <= 0:
			continue
		returnable = abs(flt(row.qty))
		if qty > returnable:
			frappe.throw(_("Row {0}: you can return at most {1} of {2}").format(row.idx, returnable, row.item_code))
		row.qty = -qty
		row.stock_qty = -qty * flt(row.conversion_factor or 1)
		kept.append(row)
	if not kept:
		frappe.throw(_("Enter a return quantity for at least one item"))

	return_doc.items = kept
	for idx, row in enumerate(kept, 1):
		row.idx = idx
	return_doc.run_method("calculate_taxes_and_totals")
	_scale_pos_refund(return_doc)
	return_doc.insert()
	return {"name": return_doc.name}


def _scale_pos_refund(return_doc):
	"""ERPNext copies the full original payment onto a POS return. For a partial
	return, refund only the returned total, split over the same payment modes."""
	if not return_doc.is_pos or not return_doc.payments:
		return
	refund = flt(return_doc.grand_total if return_doc.disable_rounded_total or not return_doc.rounded_total
		else return_doc.rounded_total)
	original = sum(flt(p.amount) for p in return_doc.payments)
	if not original:
		return
	precision = return_doc.payments[0].precision("amount")
	left = refund
	for i, pay in enumerate(return_doc.payments):
		amount = left if i == len(return_doc.payments) - 1 else flt(refund * flt(pay.amount) / original, precision)
		left -= amount
		pay.amount = amount
		pay.base_amount = flt(amount * flt(return_doc.conversion_rate or 1), precision)
	return_doc.run_method("calculate_taxes_and_totals")


def _build_return(invoice):
	"""Unsaved return mapped by ERPNext, limited to rows that still have qty to return.
	Items can be empty when everything is already returned or held in drafts."""
	from erpnext.accounts.doctype.sales_invoice.sales_invoice import make_sales_return

	_assert_can_return(invoice)
	return_doc = make_sales_return(invoice)
	in_drafts = _qty_in_draft_returns(invoice)
	for row in return_doc.items:
		# ERPNext only subtracts submitted returns; open drafts count too.
		left = abs(flt(row.qty)) - in_drafts.get(row.sales_invoice_item, 0)
		row.qty = -max(left, 0)
	return_doc.items = [row for row in return_doc.items if flt(row.qty) < 0]
	return return_doc


def _throw_nothing_left(invoice):
	drafts = [r.name for r in _existing_returns(invoice) if r.docstatus == 0]
	if drafts:
		frappe.throw(_("Everything left on {0} is already in draft return {1}").format(invoice, ", ".join(drafts)))
	frappe.throw(_("Everything on {0} has already been returned").format(invoice))


def _qty_in_draft_returns(invoice):
	si = frappe.qb.DocType("Sales Invoice")
	si_item = frappe.qb.DocType("Sales Invoice Item")
	rows = (
		frappe.qb.from_(si_item).join(si).on(si.name == si_item.parent)
		.select(si_item.sales_invoice_item, si_item.qty)
		.where((si.return_against == invoice) & (si.is_return == 1) & (si.docstatus == 0))
	).run(as_dict=True)
	qty = {}
	for row in rows:
		qty[row.sales_invoice_item] = qty.get(row.sales_invoice_item, 0) + abs(flt(row.qty))
	return qty


def _assert_can_return(invoice):
	if not can_create_return():
		frappe.throw(_("You are not permitted to create Sales Returns"), frappe.PermissionError)
	inv = frappe.db.get_value("Sales Invoice", invoice, ["docstatus", "is_return"], as_dict=True)
	if not inv:
		frappe.throw(_("Sales Invoice {0} not found").format(invoice), frappe.DoesNotExistError)
	if inv.docstatus != 1 or inv.is_return:
		frappe.throw(_("Only submitted sales invoices can be returned"))
	if not frappe.has_permission("Sales Invoice", "read", doc=invoice):
		frappe.throw(_("You are not permitted to read {0}").format(invoice), frappe.PermissionError)

	based_on, show = _invoice_settings()
	visible = _individual_invoice_names(show)
	if based_on == "Draft" or (visible is not None and invoice not in visible):
		frappe.throw(_("You cannot return this invoice"), frappe.PermissionError)


# ---------------------------------------------------------------------------
# Permissions: Sales Invoice role permissions (Role Permission Manager) only.
# ---------------------------------------------------------------------------

def _require_permission(ptype):
	if frappe.session.user == "Guest":
		frappe.throw(_("Not logged in"), frappe.AuthenticationError)
	if not frappe.has_permission("Sales Invoice", ptype):
		frappe.throw(_("You are not permitted to {0} Sales Invoices").format(_(ptype)), frappe.PermissionError)


def can_create_return():
	"""A return is a new Sales Invoice, so it needs Sales Invoice create permission."""
	return frappe.session.user != "Guest" and bool(frappe.has_permission("Sales Invoice", "create"))
