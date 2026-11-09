frappe.ui.form.on("Sales Invoice", {
	async before_save(frm) {
		const doc = frm.doc;
		if (!frm.is_new() || doc.dms_allow_duplicate_so || doc.is_return || doc.amended_from) return;

		const sales_orders = [...new Set((doc.items || []).map((i) => i.sales_order).filter(Boolean))];
		if (!sales_orders.length) return;

		const r = await frappe.call({
			method: "dms.automation.si_duplicate_guard.check_duplicate_si",
			args: { sales_orders },
		});
		const existing = r.message || [];
		if (!existing.length) return;

		frappe.validated = false;
		show_duplicate_si_dialog(frm, existing);
	},
});

function show_duplicate_si_dialog(frm, existing) {
	const rows = existing
		.map((row) => {
			const status = row.docstatus === 0
				? `<span class="indicator-pill red">${__("Draft")}</span>`
				: `<span class="indicator-pill blue">${__("Submitted")}</span>`;
			return `<tr>
				<td>${frappe.utils.escape_html(row.sales_order)}</td>
				<td><a href="/app/sales-invoice/${encodeURIComponent(row.invoice)}" target="_blank">
					${frappe.utils.escape_html(row.invoice)}</a></td>
				<td>${status}</td>
			</tr>`;
		})
		.join("");

	const d = new frappe.ui.Dialog({
		title: __("Sales Invoice Already Exists"),
		fields: [
			{
				fieldtype: "HTML",
				options: `<p>${__("A Sales Invoice already exists for this Sales Order.")}</p>
					<table class="table table-bordered">
						<thead><tr><th>${__("Sales Order")}</th><th>${__("Sales Invoice")}</th><th>${__("Status")}</th></tr></thead>
						<tbody>${rows}</tbody>
					</table>`,
			},
			{
				fieldname: "confirm_text",
				fieldtype: "Data",
				label: __("Type Confirm to create another"),
				reqd: 1,
			},
			{
				fieldname: "acknowledge",
				fieldtype: "Check",
				label: __("I understand a Sales Invoice already exists and want to create another"),
			},
		],
		primary_action_label: __("Create Anyway"),
		primary_action(values) {
			if ((values.confirm_text || "").trim() !== "Confirm") {
				frappe.msgprint(__("Please type Confirm exactly."));
				return;
			}
			if (!values.acknowledge) {
				frappe.msgprint(__("Please tick the checkbox to continue."));
				return;
			}
			frm.doc.dms_allow_duplicate_so = 1;
			d.hide();
			frm.save();
		},
	});
	d.show();
}
