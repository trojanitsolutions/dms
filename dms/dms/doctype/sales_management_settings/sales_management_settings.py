# Copyright (c) 2026, Trojan Technologies and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class SalesManagementSettings(Document):
	def validate(self):
		self._validate_stock_validation_change()

	def before_save(self):
		self._sync_stock_settings()

	def _validate_stock_validation_change(self):
		old_value = frappe.db.get_single_value("Sales Management Settings", "disable_stock_validation") or 0

		if old_value == 1 and self.disable_stock_validation == 0:
			allow_negative_stock = frappe.db.get_single_value("Stock Settings", "allow_negative_stock")
			if allow_negative_stock:
				frappe.throw(_("Please disable 'Allow Negative Stock' in Stock Settings before disabling 'Disable Stock Validation'."))

	def _sync_stock_settings(self):
		old_value = frappe.db.get_single_value("Sales Management Settings", "disable_stock_validation") or 0

		if old_value == 0 and self.disable_stock_validation == 1:
			frappe.db.set_single_value("Stock Settings", "allow_negative_stock", 1)
			frappe.db.set_single_value("Stock Settings", "enable_stock_reservation", 0)
		elif old_value == 1 and self.disable_stock_validation == 0:
			frappe.db.set_single_value("Stock Settings", "enable_stock_reservation", 1)
