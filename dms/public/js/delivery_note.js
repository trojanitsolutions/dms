frappe.ui.form.on("Delivery Note", {
	async before_save(frm) {
		const doc = frm.doc;
		if (!frm.is_new() || doc.is_return) return;

		const sales_orders = [...new Set((doc.items || []).map((i) => i.against_sales_order).filter(Boolean))];
		if (!sales_orders.length) return;

		const r = await frappe.call({
			method: "dms.automation.dn_duplicate_guard.check_dn",
			args: { sales_orders },
		});
		const { missing_si = [], existing_dn = [] } = r.message || {};

		if (missing_si.length) {
			frappe.validated = false;
			frappe.msgprint({
				title: __("Sales Invoice Required"),
				indicator: "red",
				message: __("Create a Sales Invoice (Draft or Submitted) for these Sales Orders before creating a Delivery Note:")
					+ "<ul>" + missing_si.map((so) => `<li>${frappe.utils.escape_html(so)}</li>`).join("") + "</ul>",
			});
			return;
		}

		if (!existing_dn.length || doc.dms_allow_duplicate_dn || doc.amended_from) return;

		frappe.validated = false;
		show_duplicate_dn_dialog(frm, existing_dn);
	},
});

function show_duplicate_dn_dialog(frm, existing) {
	const rows = existing
		.map((row) => {
			const status = row.docstatus === 0
				? `<span class="indicator-pill red">${__("Draft")}</span>`
				: `<span class="indicator-pill blue">${__("Submitted")}</span>`;
			return `<tr>
				<td>${frappe.utils.escape_html(row.sales_order)}</td>
				<td><a href="/app/delivery-note/${encodeURIComponent(row.delivery_note)}" target="_blank">
					${frappe.utils.escape_html(row.delivery_note)}</a></td>
				<td>${status}</td>
			</tr>`;
		})
		.join("");

	const d = new frappe.ui.Dialog({
		title: __("Delivery Note Already Exists"),
		fields: [
			{
				fieldtype: "HTML",
				options: `<p>${__("A Delivery Note already exists for this Sales Order.")}</p>
					<table class="table table-bordered">
						<thead><tr><th>${__("Sales Order")}</th><th>${__("Delivery Note")}</th><th>${__("Status")}</th></tr></thead>
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
				label: __("I understand a Delivery Note already exists and want to create another"),
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
			frm.doc.dms_allow_duplicate_dn = 1;
			d.hide();
			frm.save();
		},
	});
	d.show();
}
