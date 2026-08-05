# Copyright (c) 2026, Trojan Technologies and Contributors
# See license.txt

import frappe
from frappe.tests import IntegrationTestCase
from frappe.exceptions import ValidationError


# On IntegrationTestCase, the doctype test records and all
# link-field test record dependencies are recursively loaded
# Use these module variables to add/remove to/from that list
EXTRA_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]
IGNORE_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]


class IntegrationTestSalesManagementSettings(IntegrationTestCase):
	"""
	Integration tests for SalesManagementSettings.
	Use this class for testing interactions between multiple components.
	"""

	def test_enable_disable_stock_validation_syncs_stock_settings(self):
		"""When enabling disable_stock_validation, allow_negative_stock is set to 1."""
		frappe.db.set_single_value("Stock Settings", "allow_negative_stock", 0)
		settings = frappe.get_doc("Sales Management Settings")
		settings.disable_stock_validation = 1
		settings.save()
		self.assertEqual(frappe.db.get_single_value("Stock Settings", "allow_negative_stock"), 1)

	def test_disable_stock_validation_blocked_if_allow_negative_stock_enabled(self):
		"""Cannot uncheck disable_stock_validation if allow_negative_stock is enabled."""
		frappe.db.set_single_value("Stock Settings", "allow_negative_stock", 1)
		settings = frappe.get_doc("Sales Management Settings")
		settings.disable_stock_validation = 1
		settings.save()

		settings.disable_stock_validation = 0
		self.assertRaises(ValidationError, settings.save)

	def test_disable_stock_validation_enables_stock_reservation(self):
		"""When disabling disable_stock_validation, enable_stock_reservation is set to 1."""
		frappe.db.set_single_value("Stock Settings", "allow_negative_stock", 0)
		frappe.db.set_single_value("Stock Settings", "enable_stock_reservation", 0)
		settings = frappe.get_doc("Sales Management Settings")
		settings.disable_stock_validation = 1
		settings.save()

		settings.disable_stock_validation = 0
		settings.save()
		self.assertEqual(frappe.db.get_single_value("Stock Settings", "enable_stock_reservation"), 1)
