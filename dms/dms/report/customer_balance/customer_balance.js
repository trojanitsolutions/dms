// Copyright (c) 2026, Trojan Technologies and contributors
// For license information, please see license.txt

frappe.query_reports["Customer Balance"] = {
	filters: [
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
			default: frappe.defaults.get_user_default("Company"),
		},
		{
			fieldname: "as_on_date",
			label: __("As On Date"),
			fieldtype: "Date",
			default: frappe.datetime.get_today(),
			reqd: 1,
		},
		{
			fieldname: "customer",
			label: __("Customer"),
			fieldtype: "Link",
			options: "Customer",
		},
		{
			fieldname: "customer_group",
			label: __("Customer Group"),
			fieldtype: "Link",
			options: "Customer Group",
		},
		{
			fieldname: "show_zero_balance",
			label: __("Show Zero Balance"),
			fieldtype: "Check",
		},
	],

	onload(report) {
		report.page.add_inner_button(__("Export Selected to Excel"), () => {
			export_selected_rows(report);
		});
	},

	get_datatable_options(options) {
		return Object.assign(options, { checkboxColumn: true });
	},
};

function export_selected_rows(report) {
	const checked_rows = report.datatable.rowmanager.getCheckedRows().map(cint);
	if (!checked_rows.length) {
		frappe.msgprint(__("Please select at least one row to export."));
		return;
	}

	open_url_post(frappe.request.url, {
		cmd: "frappe.desk.query_report.export_query",
		report_name: report.report_name,
		file_format_type: "Excel",
		filters: report.get_filter_values(true),
		visible_idx: checked_rows,
		ignore_visible_idx: 0,
	});
}
