import frappe


def get_owner_filter() -> str | None:
	"""Return the session user when Sales Orders must be limited to their own, or None for System Managers."""
	user = frappe.session.user
	if user == "Administrator" or "System Manager" in frappe.get_roles(user):
		return None
	return user


def workflow_state_field(doctype: str) -> str | None:
	"""Return the state fieldname when an active Workflow exists for doctype, else None."""
	from frappe.model.workflow import get_workflow_name, get_workflow_state_field

	name = get_workflow_name(doctype)
	return get_workflow_state_field(name) if name else None


def get_workflow_state_names(doctype: str) -> list[str]:
	"""Return the states of the active Workflow for doctype, in workflow order. Empty when none is active."""
	from frappe.model.workflow import get_workflow_name

	name = get_workflow_name(doctype)
	if not name:
		return []
	states = frappe.get_all(
		"Workflow Document State", filters={"parent": name, "parenttype": "Workflow"}, pluck="state", order_by="idx"
	)
	return list(dict.fromkeys(states))


def apply_status_filter(doctype: str, filters: dict, status: str) -> None:
	"""Filter on the workflow state field when status is a state of the active Workflow, else on status."""
	if not status or status == "All":
		return
	field = workflow_state_field(doctype)
	if field and status in get_workflow_state_names(doctype):
		filters[field] = status
	else:
		filters["status"] = status


def apply_workflow_status(doctype: str, rows: list[dict], name_key: str = "name") -> list[dict]:
	"""Show the workflow state as row['status'] when an active Workflow sets one; keep the original in row['doc_status']."""
	field = workflow_state_field(doctype)
	if not field or not rows:
		return rows
	names = [r[name_key] for r in rows]
	states = dict(
		frappe.get_all(doctype, filters={"name": ["in", names]}, fields=["name", field], as_list=True)
	)
	for r in rows:
		r["doc_status"] = r.get("status")
		r["status"] = states.get(r[name_key]) or r.get("status")
	return rows
