// Copyright (c) 2026, Trojan Technologies and contributors
// For license information, please see license.txt

frappe.query_reports["Sales Booking Availablility"] = {
	tree: true,
	filters: [
		{
			fieldname: "sales_order",
			label: __("Sales Order"),
			fieldtype: "Link",
			options: "Sales Order",
			get_query: () => ({
				filters: {
					docstatus: 1,
				},
			}),
		},
		{
			fieldname: "so_status",
			label: __("Sales Order Status"),
			fieldtype: "Select",
			options: "\nDraft\nOn Hold\nTo Pay\nTo Deliver and Bill\nTo Bill\nTo Deliver\nCompleted\nCancelled\nClosed",
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
			fieldname: "item_code",
			label: __("Item Code"),
			fieldtype: "Link",
			options: "Item",
			get_query: () => ({
				filters: {
					disabled: 0,
				},
			}),
		},
		{
			fieldname: "warehouse",
			label: __("Warehouse"),
			fieldtype: "Link",
			options: "Warehouse",
			get_query: () => ({
				filters: {
					disabled: 0,
				},
			}),
		},
		{
			fieldname: "today",
			label: __("Today"),
			fieldtype: "Check",
		},
	],
	onload(report) {
		if (!document.getElementById("dms-clear-filters-style")) {
			$(`<style id="dms-clear-filters-style">
				.dms-clear-filters-btn {
					background: transparent;
					border-color: transparent;
					color: var(--text-muted);
				}
				.dms-clear-filters-btn:hover {
					background: var(--control-bg);
					border-color: var(--gray-300);
					color: var(--text-color);
				}
			</style>`).appendTo("head");
		}

		if (!document.getElementById("dms-sbav-filter-style")) {
			$(`<style id="dms-sbav-filter-style">
				#page-query-report .page-form .form-group.dms-sbav-filter {
					flex: 1 1 150px;
					max-width: 190px;
					min-width: 140px;
					margin: 8px 6px 8px 0;
					padding: 0;
				}
				#page-query-report .page-form .form-group.dms-sbav-filter[data-fieldtype="Check"] {
					flex: 0 0 auto;
					display: flex;
					align-items: center;
					min-height: 32px;
				}
				#page-query-report .page-form .form-group.dms-sbav-filter[data-fieldtype="Check"] .checkbox {
					margin-top: 0;
					margin-bottom: 0;
				}
				#page-query-report .page-form .form-group.dms-sbav-filter[data-fieldtype="Check"] .checkbox label {
					display: flex;
					align-items: center;
					margin: 0;
					font-weight: 400;
				}
				#page-query-report .page-form .form-group.dms-sbav-filter[data-fieldtype="Check"] .checkbox input[type="checkbox"] {
					width: 16px;
					height: 16px;
					margin-right: 6px;
					margin-bottom: 0;
					flex-shrink: 0;
					cursor: pointer;
				}
				.dms-sbav-filter input,
				.dms-sbav-filter select,
				.dms-sbav-filter .awesomplete input {
					height: 32px;
				}
				@media (max-width: 1024px) {
					#page-query-report .page-form .form-group.dms-sbav-filter {
						flex: 1 1 130px;
						max-width: 170px;
						min-width: 120px;
					}
				}
				@media (max-width: 768px) {
					#page-query-report .page-form .form-group.dms-sbav-filter {
						flex: 1 1 110px;
						max-width: 150px;
						min-width: 100px;
					}
				}
				@media (max-width: 600px) {
					#page-query-report .page-form .form-group.dms-sbav-filter {
						flex: 1 1 100%;
						max-width: 100%;
						min-width: 100%;
						margin: 8px 0;
					}
				}
			</style>`).appendTo("head");
		}

		if (!document.getElementById("dms-sbav-summary-cards-style")) {
			$(`<style id="dms-sbav-summary-cards-style">
				.dms-sbav-summary-container {
					display: flex;
					gap: 24px;
					margin: 0 0 24px 0;
					padding: 0;
					flex-wrap: wrap;
				}
				.dms-sbav-summary-card {
					flex: 1;
					min-width: 280px;
					padding: 16px;
					border-radius: 8px;
					background: var(--card-bg);
					border: 1px solid var(--border-color);
					box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
				}
				.dms-sbav-summary-label {
					font-size: 12px;
					font-weight: 500;
					color: var(--text-muted);
					text-transform: uppercase;
					letter-spacing: 0.5px;
					margin: 0 0 8px 0;
				}
				.dms-sbav-summary-value {
					font-size: 28px;
					font-weight: 600;
					color: var(--text-color);
					margin: 0;
					line-height: 1.2;
					word-break: break-word;
				}
			</style>`).appendTo("head");
		}

		report.filters.forEach((f) => $(f.wrapper).addClass("dms-sbav-filter"));

		const $wrapper = $(report.wrapper);
		const $summaryContainer = $(`<div class="dms-sbav-summary-container"></div>`);
		$wrapper.find(".results").prepend($summaryContainer);

		const updateSummaryCards = () => {
			const data = (report.datatable && report.datatable.data) || report.data || [];
			let totalAmount = 0;
			let totalOrders = 0;

			if (Array.isArray(data)) {
				data.forEach((row) => {
					if (row.indent === 0) {
						totalOrders += 1;
						totalAmount += flt(row.grand_total || 0);
					}
				});
			}

			const amountFormatted = frappe.format(totalAmount, { fieldtype: "Currency" });
			const ordersFormatted = totalOrders.toString();

			$summaryContainer.html(`
				<div class="dms-sbav-summary-card">
					<div class="dms-sbav-summary-label">${__("Total Sales Amount")}</div>
					<div class="dms-sbav-summary-value">${amountFormatted}</div>
				</div>
				<div class="dms-sbav-summary-card">
					<div class="dms-sbav-summary-label">${__("Total Orders")}</div>
					<div class="dms-sbav-summary-value">${ordersFormatted}</div>
				</div>
			`);
		};

		frappe.query_reports["Sales Booking Availablility"].refresh = frappe.query_reports["Sales Booking Availablility"].refresh || function() {};
		const originalRefresh = frappe.query_reports["Sales Booking Availablility"].refresh;
		frappe.query_reports["Sales Booking Availablility"].refresh = function() {
			originalRefresh.call(this);
			updateSummaryCards();
		};

		setTimeout(updateSummaryCards, 500);

		const $btn = report.page.add_inner_button(__("Clear Filters"), () => {
			const values = {};
			report.filters.forEach((f) => (values[f.df.fieldname] = ""));
			report.set_filter_value(values);
			report.refresh();
		});
		$btn.addClass("btn-xs dms-clear-filters-btn");
	},
};
