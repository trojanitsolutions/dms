import frappe


def set_csrf_cookie():
	"""Keep the X-Frappe-CSRF-Token cookie in sync with the session's real CSRF token.

	The sales/delivery portal pages under dms/www read this cookie to send
	the CSRF header on POST calls. Frappe core never sets such a cookie itself
	(Desk sends the token via a JS global instead), so once a session picks up
	a real csrf_token (e.g. after visiting /app), the portal's stale/placeholder
	header value stops matching and every POST call is rejected as CSRFTokenError.
	"""
	if frappe.session.user == "Guest":
		return
	frappe.local.cookie_manager.set_cookie("X-Frappe-CSRF-Token", frappe.sessions.get_csrf_token())
