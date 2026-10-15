// Copyright (c) 2026, Trojan Technologies and contributors
// For license information, please see license.txt

const PAGE_SIZES = [20, 100, 500, 2500];

frappe.query_reports["Customer Balance"] = {
	filters: [
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
		},
		{
			fieldname: "as_on_date",
			label: __("As On Date"),
			fieldtype: "Date",
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
		{
			// Set by the paging buttons below the table. Empty means all rows.
			fieldname: "page_length",
			label: __("Page Length"),
			fieldtype: "Int",
			default: PAGE_SIZES[0],
			hidden: 1,
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

	after_refresh(report) {
		render_paging(report);
	},
};

function render_paging(report) {
	report.page.main.find(".customer-balance-paging").remove();

	const page_length = cint(report.get_filter_value("page_length"));
	const step = report.page_step || PAGE_SIZES[0];
	const shown = report.data.length;
	const total = get_total_customers(report);
	if (!total) return;

	const size_buttons = PAGE_SIZES.map(
		(size) => `<button class="btn btn-xs btn-default ${page_length && size === step ? "btn-info" : ""}"
			data-size="${size}">${size}</button>`
	).join("");

	const $paging = $(`
		<div class="customer-balance-paging flex justify-between align-center" style="padding: var(--padding-md) 0;">
			<div class="btn-group">
				${size_buttons}
				<button class="btn btn-xs btn-default ${page_length ? "" : "btn-info"}" data-size="0">${__("All")}</button>
			</div>
			<div class="flex align-center" style="gap: var(--margin-sm);">
				<span class="text-muted small">${__("Showing {0} of {1}", [shown, total])}</span>
				${shown < total ? `<button class="btn btn-xs btn-default" data-action="load-more">${__("Load More")}</button>` : ""}
			</div>
		</div>
	`).insertAfter(report.$report);

	$paging.find("[data-size]").on("click", (e) => {
		const size = cint($(e.currentTarget).attr("data-size"));
		if (size) report.page_step = size;
		report.set_filter_value("page_length", size || null);
	});

	$paging.find("[data-action=load-more]").on("click", () => {
		report.set_filter_value("page_length", shown + step);
	});
}

function get_total_customers(report) {
	const card = (report.raw_data?.report_summary || []).find((c) => c.key === "total_customers");
	return card ? cint(card.value) : report.data.length;
}

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
