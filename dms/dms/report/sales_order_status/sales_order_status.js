// Copyright (c) 2026, Trojan Technologies and contributors
// For license information, please see license.txt

const STATUS_COLORS = {
	// Overall Fulfilment Status
	"Fully Completed": "green",
	"Delivered – Invoice Pending": "orange",
	"Partially Delivered": "yellow",
	"Not Delivered": "red",
	Closed: "gray",
	Cancelled: "gray",
	// Delivery Status
	"Fully Delivered": "green",
	"Partly Delivered": "yellow",
	"Not Applicable": "gray",
	// Invoice Status
	"Fully Invoiced": "green",
	"Partly Invoiced": "yellow",
	"Draft Invoice": "orange",
	"Not Invoiced": "red",
};

const DOCUMENT_STATE_COLORS = { Draft: "orange", Submitted: "green", Cancelled: "gray" };

// Filters that the summary cards set. Clicking a card clears these, then applies its own.
const DRILLDOWN_FILTERS = [
	"fulfilment_status",
	"delivery_status",
	"invoice_status",
	"overdue_only",
	"pending_delivery_only",
	"pending_invoice_only",
	"draft_invoice_only",
];

frappe.query_reports["Sales Order Status"] = {
	filters: [
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
			default: frappe.defaults.get_user_default("Company"),
		},
		{
			fieldname: "from_date",
			label: __("From Date"),
			fieldtype: "Date",
			default: frappe.datetime.add_months(frappe.datetime.get_today(), -12),
		},
		{
			fieldname: "to_date",
			label: __("To Date"),
			fieldtype: "Date",
			default: frappe.datetime.get_today(),
		},
		{
			fieldname: "customer",
			label: __("Customer"),
			fieldtype: "Link",
			options: "Customer",
		},
		{
			fieldname: "sales_order",
			label: __("Sales Order"),
			fieldtype: "Link",
			options: "Sales Order",
			get_query: () => {
				const { company, customer } = frappe.query_report.get_filter_values();
				const filters = { docstatus: ["!=", 0] };
				if (company) filters.company = company;
				if (customer) filters.customer = customer;
				return { filters };
			},
		},
		{
			fieldname: "sales_person",
			label: __("Sales Person"),
			fieldtype: "Link",
			options: "Sales Person",
		},
		{
			fieldname: "sales_order_status",
			label: __("Sales Order Status"),
			fieldtype: "Select",
			options: [
				"",
				"On Hold",
				"To Pay",
				"To Deliver and Bill",
				"To Bill",
				"To Deliver",
				"Completed",
				"Closed",
				"Cancelled",
			],
		},
		{
			fieldname: "fulfilment_status",
			label: __("Overall Fulfilment Status"),
			fieldtype: "Select",
			options: [
				"",
				"Fully Completed",
				"Delivered – Invoice Pending",
				"Partially Delivered",
				"Not Delivered",
				"Closed",
				"Cancelled",
			],
		},
		{
			fieldname: "delivery_status",
			label: __("Delivery Status"),
			fieldtype: "Select",
			options: [
				"",
				"Not Delivered",
				"Partly Delivered",
				"Fully Delivered",
				"Not Applicable",
				"Closed",
				"Cancelled",
			],
		},
		{
			fieldname: "invoice_status",
			label: __("Invoice Status"),
			fieldtype: "Select",
			options: [
				"",
				"Not Invoiced",
				"Draft Invoice",
				"Partly Invoiced",
				"Fully Invoiced",
				"Closed",
				"Cancelled",
			],
		},
		{
			fieldname: "overdue_only",
			label: __("Overdue Deliveries Only"),
			fieldtype: "Check",
		},
		{
			fieldname: "pending_delivery_only",
			label: __("Pending Delivery Only"),
			fieldtype: "Check",
		},
		{
			fieldname: "pending_invoice_only",
			label: __("Pending Invoice Only"),
			fieldtype: "Check",
		},
		{
			fieldname: "draft_invoice_only",
			label: __("Draft Invoices Only"),
			fieldtype: "Check",
		},
		{
			// Visibility only: adds cancelled invoices to the references. Calculations do not change.
			fieldname: "show_all_invoices",
			label: __("Show All Invoices"),
			fieldtype: "Check",
		},
	],

	onload(report) {
		report.page.main.on("click", ".sos-details", (e) => {
			e.preventDefault();
			const row = (report.data || []).find((d) => d.sales_order === e.currentTarget.dataset.so);
			if (row) show_details_dialog(row);
		});
	},

	after_refresh(report) {
		bind_summary_drilldown(report);
	},

	formatter(value, row, column, data, default_formatter) {
		if (!data) return default_formatter(value, row, column, data);

		switch (column.fieldname) {
			case "fulfilment_status":
			case "delivery_status":
			case "invoice_status":
				return value ? status_pill(value, STATUS_COLORS[value]) : "";
			case "sales_invoices":
				return format_references("Sales Invoice", parse_refs(data.invoice_refs), data);
			case "delivery_notes":
				return format_references("Delivery Note", parse_refs(data.delivery_note_refs), data);
			case "days_overdue":
				return value > 0 ? `<span class="text-danger bold">${cint(value)}</span>` : "";
			case "pending_delivery_qty":
			case "pending_invoice_qty":
			case "draft_invoice_qty": {
				const formatted = default_formatter(value, row, column, data);
				return flt(value) > 0 ? `<span class="text-warning">${formatted}</span>` : formatted;
			}
			default:
				return default_formatter(value, row, column, data);
		}
	},
};

function status_pill(label, color) {
	return `<span class="indicator-pill ${color || "gray"}">${frappe.utils.escape_html(__(label))}</span>`;
}

function parse_refs(json) {
	try {
		return JSON.parse(json || "[]");
	} catch {
		return [];
	}
}

function format_references(doctype, refs, data) {
	if (!refs.length) return "";

	const links = refs.map((ref) => {
		const color = DOCUMENT_STATE_COLORS[ref.state];
		const title = `${__(ref.state)} · ${__(ref.status || "")}${ref.is_return ? " · " + __("Return") : ""}`;
		const style = ref.docstatus === 2 ? "text-decoration: line-through;" : "";
		return `<a href="/app/${frappe.router.slug(doctype)}/${encodeURIComponent(ref.name)}"
			class="indicator ${color}" style="${style}" title="${frappe.utils.escape_html(title)}">
			${frappe.utils.escape_html(ref.name)}</a>`;
	});
	const details = `<a href="#" class="sos-details text-muted small" data-so="${frappe.utils.escape_html(
		data.sales_order
	)}" title="${__("View details")}">${refs.length > 1 ? `(${refs.length})` : "ⓘ"}</a>`;

	return `${details} ${links.join(" ")}`;
}

function show_details_dialog(row) {
	const invoices = parse_refs(row.invoice_refs);
	const delivery_notes = parse_refs(row.delivery_note_refs);
	const dialog = new frappe.ui.Dialog({
		title: __("Linked Documents for {0}", [row.sales_order]),
		size: "extra-large",
		fields: [{ fieldtype: "HTML", fieldname: "details" }],
	});
	dialog.fields_dict.details.$wrapper.html(`
		<h5>${__("Sales Invoices")}</h5>
		${documents_table("Sales Invoice", invoices, true)}
		<p class="text-muted small">${
			frappe.query_report.get_filter_value("show_all_invoices")
				? __("Showing all invoices, including cancelled.")
				: __("Cancelled invoices are hidden. Enable Show All Invoices to see them.")
		} ${__("Qty is the quantity of this order on the invoice. Grand Total is the whole invoice.")}</p>
		<h5 class="mt-4">${__("Delivery Notes")}</h5>
		${documents_table("Delivery Note", delivery_notes, false)}
	`);
	dialog.show();
}

function documents_table(doctype, refs, is_invoice) {
	if (!refs.length) return `<p class="text-muted">${__("None")}</p>`;

	const currency_cell = (ref, field) =>
		ref[field] === null || ref[field] === undefined ? "" : format_currency(ref[field], ref.currency);
	const rows = refs
		.map(
			(ref) => `<tr>
				<td><a href="/app/${frappe.router.slug(doctype)}/${encodeURIComponent(ref.name)}">
					${frappe.utils.escape_html(ref.name)}</a>${ref.is_return ? ` <span class="text-muted">(${__("Return")})</span>` : ""}</td>
				<td>${status_pill(ref.state, DOCUMENT_STATE_COLORS[ref.state])}</td>
				<td>${frappe.utils.escape_html(__(ref.status || ""))}</td>
				<td>${frappe.datetime.str_to_user(ref.posting_date)}</td>
				<td class="text-right">${format_number(ref.qty)}</td>
				${
					is_invoice
						? `<td class="text-right">${currency_cell(ref, "grand_total")}</td>
						   <td class="text-right">${currency_cell(ref, "outstanding_amount")}</td>`
						: ""
				}
			</tr>`
		)
		.join("");

	return `<table class="table table-bordered table-condensed">
		<thead><tr>
			<th>${__(doctype)}</th><th>${__("Document Status")}</th><th>${__("Status")}</th>
			<th>${__("Posting Date")}</th><th class="text-right">${__("Qty")}</th>
			${
				is_invoice
					? `<th class="text-right">${__("Grand Total")}</th><th class="text-right">${__("Outstanding")}</th>`
					: ""
			}
		</tr></thead>
		<tbody>${rows}</tbody>
	</table>`;
}

function bind_summary_drilldown(report) {
	const summary = report.raw_data?.report_summary || [];
	report.$summary.find(".summary-item").each((index, element) => {
		const drilldown = summary[index]?.drilldown;
		if (!drilldown) return;

		$(element)
			.css("cursor", "pointer")
			.attr("title", __("Click to filter"))
			.off("click")
			.on("click", () => apply_drilldown(report, drilldown));
	});
}

async function apply_drilldown(report, drilldown) {
	// Set all values first, then refresh once.
	report._no_refresh = true;
	try {
		await Promise.all(
			DRILLDOWN_FILTERS.map((fieldname) => {
				const filter = report.get_filter(fieldname);
				const value = drilldown[fieldname] ?? (filter.df.fieldtype === "Check" ? 0 : "");
				return filter.set_value(value);
			})
		);
	} finally {
		report._no_refresh = false;
	}
	report.refresh();
}
