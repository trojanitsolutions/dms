import json
from contextlib import ExitStack
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from dms.api import quotation as qapi
from dms.api import quotation_create as qcreate

ITEM_CODE = "_T-DMS-QTN-PARTY-ITEM"


def _make_item():
	if not frappe.db.exists("Item", ITEM_CODE):
		frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": ITEM_CODE,
				"item_name": ITEM_CODE,
				"item_group": "All Item Groups",
				"stock_uom": "Nos",
				"is_stock_item": 0,
				"is_sales_item": 1,
			}
		).insert(ignore_permissions=True)
	return ITEM_CODE


def _make_lead(company_name, **kwargs):
	return frappe.get_doc(
		{
			"doctype": "Lead",
			"lead_name": "Test Lead " + frappe.generate_hash(length=6),
			"company_name": company_name,
			**kwargs,
		}
	).insert(ignore_permissions=True)


def _make_customer(name):
	return frappe.get_doc(
		{
			"doctype": "Customer",
			"customer_name": name + " " + frappe.generate_hash(length=6),
			"customer_type": "Company",
			"customer_group": frappe.db.get_value("Customer Group", {"is_group": 0}, "name"),
			"territory": frappe.db.get_value("Territory", {"is_group": 0}, "name") or "All Territories",
		}
	).insert(ignore_permissions=True)


def _make_address(link_doctype, link_name):
	return frappe.get_doc(
		{
			"doctype": "Address",
			"address_title": link_name,
			"address_type": "Billing",
			"address_line1": "1 Test Street",
			"city": "Doha",
			"country": frappe.db.get_value("Country", {}, "name"),
			"links": [{"link_doctype": link_doctype, "link_name": link_name}],
		}
	).insert(ignore_permissions=True)


class TestQuotationParty(IntegrationTestCase):
	def setUp(self):
		self._stack = ExitStack()
		# Skip the Sales Rep role / Employee checks: these tests cover the party logic.
		self._stack.enter_context(patch.object(qapi, "_require_sales_rep", lambda: None))
		self._stack.enter_context(patch.object(qcreate, "_require_sales_rep", lambda: None))
		# Expected-failure cases would otherwise write (and commit) Error Log rows.
		self._stack.enter_context(patch("frappe.log_error"))
		self.item = _make_item()
		self.warehouse = frappe.db.get_value("Warehouse", {"is_group": 0, "disabled": 0}, "name")

	def tearDown(self):
		self._stack.close()
		frappe.db.rollback()

	def _items_json(self):
		return json.dumps([{"item_code": self.item, "qty": 2, "rate": 50}])

	def test_create_lead_quotation(self):
		lead = _make_lead("Lead Co")
		result = qcreate.create_quotation(
			warehouse=self.warehouse,
			items_json=self._items_json(),
			party_type="Lead",
			party_name=lead.name,
		)
		qtn = frappe.get_doc("Quotation", result["name"])
		self.assertEqual(qtn.quotation_to, "Lead")
		self.assertEqual(qtn.party_name, lead.name)
		self.assertEqual(qtn.customer_name, "Lead Co")

	def test_legacy_customer_argument_still_works(self):
		customer = _make_customer("Legacy Cust")
		result = qcreate.create_quotation(
			customer=customer.name,
			warehouse=self.warehouse,
			items_json=self._items_json(),
		)
		qtn = frappe.get_doc("Quotation", result["name"])
		self.assertEqual(qtn.quotation_to, "Customer")
		self.assertEqual(qtn.party_name, customer.name)

	def test_totals_for_lead(self):
		lead = _make_lead("Totals Co")
		totals = qcreate.get_quotation_totals(
			warehouse=self.warehouse,
			items_json=self._items_json(),
			party_type="Lead",
			party_name=lead.name,
		)
		self.assertEqual(totals["total"], 100)

	def test_lead_address_must_belong_to_lead(self):
		lead = _make_lead("Addr Co")
		other = _make_lead("Other Co")
		own_address = _make_address("Lead", lead.name)
		other_address = _make_address("Lead", other.name)

		result = qcreate.create_quotation(
			warehouse=self.warehouse,
			items_json=self._items_json(),
			party_type="Lead",
			party_name=lead.name,
			customer_address=own_address.name,
		)
		self.assertEqual(frappe.db.get_value("Quotation", result["name"], "customer_address"), own_address.name)

		with self.assertRaises(frappe.ValidationError):
			qcreate.create_quotation(
				warehouse=self.warehouse,
				items_json=self._items_json(),
				party_type="Lead",
				party_name=lead.name,
				customer_address=other_address.name,
			)

	def test_invalid_party_rejected(self):
		disabled_lead = _make_lead("Disabled Co", disabled=1)
		with self.assertRaises(frappe.ValidationError):
			qcreate.create_quotation(
				warehouse=self.warehouse,
				items_json=self._items_json(),
				party_type="Lead",
				party_name=disabled_lead.name,
			)
		with self.assertRaises(frappe.ValidationError):
			qcreate.create_quotation(
				warehouse=self.warehouse,
				items_json=self._items_json(),
				party_type="Supplier",
				party_name="anything",
			)

	def test_search_parties_excludes_converted_and_disabled_leads(self):
		tag = frappe.generate_hash(length=8)
		active = _make_lead(f"Active {tag}")
		disabled = _make_lead(f"Disabled {tag}", disabled=1)
		converted = _make_lead(f"Converted {tag}")
		frappe.db.set_value("Lead", converted.name, "status", "Converted")

		names = {r["name"] for r in qapi.search_parties("Lead", tag)}
		self.assertIn(active.name, names)
		self.assertNotIn(disabled.name, names)
		self.assertNotIn(converted.name, names)

		mobile = "+9745" + str(int(tag, 16) % 10**7).zfill(7)
		frappe.db.set_value("Lead", active.name, "mobile_no", mobile)
		self.assertIn(active.name, {r["name"] for r in qapi.search_parties("Lead", mobile)})

		details = qapi.get_party_details("Lead", active.name)
		self.assertEqual(details["display_name"], f"Active {tag}")
		self.assertEqual(details["party_type"], "Lead")

	def test_list_apis_return_party_type(self):
		lead = _make_lead("List Co")
		qcreate.create_quotation(
			warehouse=self.warehouse,
			items_json=self._items_json(),
			party_type="Lead",
			party_name=lead.name,
		)
		rows = qapi.get_pending_quotations(party_type="Lead")
		row = next(r for r in rows if r["party_name"] == lead.name)
		self.assertEqual(row["party_type"], "Lead")
		self.assertEqual(row["customer"], lead.name)
		self.assertTrue(all(r["party_type"] == "Lead" for r in rows))

		history = qapi.get_quotation_history(search=lead.name)
		self.assertEqual(history["orders"][0]["party_type"], "Lead")

	def test_ensure_customer_for_lead_quotation(self):
		customer_group = frappe.db.get_value("Customer Group", {"is_group": 0}, "name")
		frappe.db.set_default("Customer Group", customer_group)

		lead = _make_lead("Convert Co")
		result = qcreate.create_quotation(
			warehouse=self.warehouse,
			items_json=self._items_json(),
			party_type="Lead",
			party_name=lead.name,
		)
		qtn = frappe.get_doc("Quotation", result["name"])
		qtn.submit()

		# Before conversion the GET used by the Sales Order page refuses to create a phantom customer.
		with self.assertRaises(frappe.ValidationError):
			qapi.get_quotation_for_sales_order(qtn.name)

		out = qapi.ensure_customer_for_quotation(qtn.name)
		self.assertEqual(frappe.db.get_value("Customer", out["customer"], "lead_name"), lead.name)
		self.assertEqual(frappe.db.get_value("Lead", lead.name, "status"), "Converted")

		# Calling again reuses the same customer.
		self.assertEqual(qapi.ensure_customer_for_quotation(qtn.name)["customer"], out["customer"])

		so = qapi.get_quotation_for_sales_order(qtn.name)
		self.assertEqual(so["customer"], out["customer"])

	def test_create_lead_from_quotation_popup(self):
		tag = frappe.generate_hash(length=8)
		out = qapi.create_lead(
			first_name=" Popup ",
			last_name=f"Lead{tag}",
			mobile_no="+97455500000",
			company_name=f"Popup Org {tag}",
		)
		lead = frappe.get_doc("Lead", out["name"])
		self.assertEqual(lead.first_name, "Popup")
		self.assertEqual(lead.lead_name, f"Popup Lead{tag}")
		self.assertEqual(lead.mobile_no, "+97455500000")
		self.assertEqual(lead.company_name, f"Popup Org {tag}")
		self.assertEqual(lead.lead_owner, frappe.session.user)
		self.assertEqual(out["display_name"], f"Popup Org {tag}")
		self.assertIn(lead.name, {r["name"] for r in qapi.search_parties("Lead", tag)})

	def test_create_lead_requires_first_name_and_mobile(self):
		with self.assertRaises(frappe.ValidationError):
			qapi.create_lead(first_name="  ", mobile_no="123")
		with self.assertRaises(frappe.ValidationError):
			qapi.create_lead(first_name="No Mobile", mobile_no="")

	def test_rounding_follows_global_defaults(self):
		customer = _make_customer("Rounding Cust")
		items = json.dumps([{"item_code": self.item, "qty": 3, "rate": 33.35}])
		for disabled in (0, 1):
			frappe.db.set_single_value("Global Defaults", "disable_rounded_total", disabled)
			kwargs = dict(warehouse=self.warehouse, items_json=items, party_type="Customer", party_name=customer.name)

			totals = qcreate.get_quotation_totals(**kwargs)
			self.assertEqual(totals["disable_rounded_total"], disabled)

			result = qcreate.create_quotation(**kwargs)
			qtn = frappe.get_doc("Quotation", result["name"])
			self.assertEqual(qtn.disable_rounded_total, disabled)
			self.assertEqual(qtn.grand_total, totals["grand_total"])
			if disabled:
				self.assertFalse(qtn.rounded_total)
			else:
				self.assertEqual(qtn.rounded_total, round(qtn.grand_total))
				self.assertEqual(totals["rounded_total"], qtn.rounded_total)
