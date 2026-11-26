// Copyright (c) 2026, Trojan Technologies and contributors
// For license information, please see license.txt

const PAGE_SIZES = [20, 100, 500, 2500];

frappe.query_reports["Customer Invoice Balance"] = {
	filters: [
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
			default: frappe.defaults.get_user_default("Company"),
		},
		{
			fieldname: "customer",
			label: __("Customer"),
			fieldtype: "Link",
			options: "Customer",
			on_change(report) {
				// An address picked for another customer no longer applies.
				if (report.get_filter_value("customer_address")) {
					report.set_filter_value("customer_address", "");
				} else if (!report._no_refresh) {
					report.refresh(true);
				}
			},
		},
		{
			fieldname: "customer_address",
			label: __("Customer Address"),
			fieldtype: "Link",
			options: "Address",
			get_query() {
				// Show only customer addresses, and only the picked customer's when one is set.
				const customer = frappe.query_report.get_filter_value("customer");
				return {
					query: "frappe.contacts.doctype.address.address.address_query",
					filters: Object.assign({ link_doctype: "Customer" }, customer ? { link_name: customer } : {}),
				};
			},
		},
		{
			fieldname: "customer_group",
			label: __("Customer Group"),
			fieldtype: "Link",
			options: "Customer Group",
		},
		{
			fieldname: "posting_date",
			label: __("Posting Date"),
			fieldtype: "Date",
		},
		{
			fieldname: "from_date",
			label: __("From Date"),
			fieldtype: "Date",
		},
		{
			fieldname: "to_date",
			label: __("To Date"),
			fieldtype: "Date",
		},
		{
			fieldname: "show_paid_invoices",
			label: __("Show Paid Invoices"),
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
		add_scrollbar_styles(report);
		report.page.add_inner_button(__("Clear Filters"), () => clear_filters(report));
	},

	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (column.fieldname === "outstanding_amount" && data && data.outstanding_amount > 0) {
			value = `<span class="text-danger">${value}</span>`;
		}
		if (column.fieldname === "overdue_days" && data && data.overdue_days > 0) {
			value = `<span class="text-warning">${value}</span>`;
		}
		return value;
	},

	get_datatable_options(options) {
		// The report has its own Sl No column.
		return Object.assign(options, { serialNoColumn: false });
	},

	after_refresh(report) {
		render_paging(report);
		load_statement_details(report);
	},
};

// The "CIB Standard" print format reads these details from `report.statement_details`.
function load_statement_details(report) {
	frappe
		.xcall(
			"dms.dms.report.customer_invoice_balance.customer_invoice_balance.get_statement_details",
			{
				company: report.get_filter_value("company"),
				customer: report.get_filter_value("customer"),
			}
		)
		.then((details) => (report.statement_details = details));
}

function render_paging(report) {
	report.page.main.find(".customer-invoice-balance-paging").remove();

	const page_length = cint(report.get_filter_value("page_length"));
	const step = report.page_step || PAGE_SIZES[0];
	const shown = report.data.length;
	const total = get_total_invoices(report);
	if (!total) return;

	const size_buttons = PAGE_SIZES.map(
		(size) => `<button class="btn btn-xs btn-default ${page_length && size === step ? "btn-info" : ""}"
			data-size="${size}">${size}</button>`
	).join("");

	const $paging = $(`
		<div class="customer-invoice-balance-paging flex justify-between align-center" style="padding: var(--padding-md) 0;">
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
		// Load the next page of the selected size.
		report.set_filter_value("page_length", shown + step);
	});
}

function get_total_invoices(report) {
	const card = (report.raw_data?.report_summary || []).find((c) => c.key === "total_invoices");
	return card ? cint(card.value) : report.data.length;
}

// Empty every visible filter and go back to the first page. Refreshes the report once.
async function clear_filters(report) {
	report.page_step = PAGE_SIZES[0];
	// Stop each filter change from starting its own refresh.
	report._no_refresh = true;
	try {
		await Promise.all(
			report.filters.map((f) => {
				if (f.df.fieldname === "page_length") return f.set_value(PAGE_SIZES[0]);
				return f.set_value(f.df.fieldtype === "Check" ? 0 : "");
			})
		);
	} finally {
		report._no_refresh = false;
	}
	report.refresh();
}

// Keep the vertical and horizontal scrollbars of the table always visible.
// Frappe uses thin scrollbars, and macOS hides them until the user scrolls.
function add_scrollbar_styles(report) {
	$(report.page.wrapper).addClass("customer-invoice-balance-report");
	if (document.getElementById("customer-invoice-balance-styles")) return;

	$(`<style id="customer-invoice-balance-styles">
		.customer-invoice-balance-report .datatable .dt-scrollable {
			overflow: scroll;
			scrollbar-width: auto;
			scrollbar-color: var(--gray-500) var(--gray-100);
		}
		.customer-invoice-balance-report .datatable .dt-scrollable::-webkit-scrollbar {
			width: 12px;
			height: 12px;
		}
		.customer-invoice-balance-report .datatable .dt-scrollable::-webkit-scrollbar-track {
			background: var(--gray-100);
		}
		.customer-invoice-balance-report .datatable .dt-scrollable::-webkit-scrollbar-thumb {
			background: var(--gray-500);
			border-radius: 6px;
			border: 2px solid var(--gray-100);
		}
		.customer-invoice-balance-report .datatable .dt-scrollable::-webkit-scrollbar-corner {
			background: var(--gray-100);
		}
	</style>`).appendTo("head");
}
