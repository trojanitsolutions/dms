function csrf() {
	const m = document.cookie.match(/X-Frappe-CSRF-Token=([^;]+)/);
	return m ? decodeURIComponent(m[1]) : 'fetch';
}
async function apiGet(method, args) {
	const p = new URLSearchParams(args);
	const r = await fetch('/api/method/' + method + (p.toString() ? '?' + p : ''), {
		headers: { 'X-Frappe-CSRF-Token': csrf(), 'Accept': 'application/json' },
	});
	const d = await r.json();
	if (!r.ok) throw new Error(d.message || d.exc_type || 'Error');
	return d.message;
}
async function apiPost(method, args) {
	const r = await fetch('/api/method/' + method, {
		method: 'POST',
		headers: { 'X-Frappe-CSRF-Token': csrf(), 'Content-Type': 'application/json', 'Accept': 'application/json' },
		body: JSON.stringify(args),
	});
	const d = await r.json();
	if (!r.ok) throw new Error(d.message || d.exc_type || 'Error');
	return d.message;
}

function fmtDate(s) {
	if (!s) return '';
	const d = new Date(s + 'T00:00:00');
	return d.toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric' });
}
function esc(s) {
	return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Toast ─────────────────────────────────────────────
let _toastTimer = null;
function showToast(msg, isError) {
	const existing = document.querySelector('.toast');
	if (existing) existing.remove();
	const el = document.createElement('div');
	el.className = 'toast' + (isError ? ' error-toast' : '');
	el.textContent = msg;
	document.body.appendChild(el);
	clearTimeout(_toastTimer);
	_toastTimer = setTimeout(() => el.remove(), 2600);
}

// ── Error banner ──────────────────────────────────────
function showError(msg) {
	const el = document.getElementById('err-banner');
	el.textContent = msg;
	el.classList.add('visible');
	document.getElementById('loading-state').style.display = 'none';
	document.getElementById('note-detail').style.display = 'none';
}

// ── Status badge ──────────────────────────────────────
function statusBadge(docstatus, status) {
	if (docstatus === 1) return '<span class="badge badge-completed">Completed</span>';
	const s = (status || '').toLowerCase();
	if (s.includes('transit') || s.includes('progress')) return '<span class="badge badge-inprogress">In Progress</span>';
	return '<span class="badge badge-pending">Pending</span>';
}

// ── State ─────────────────────────────────────────────
let noteData = null;
let itemState = {};
let attachments = [];
let submitted = false;

// ── Render items ──────────────────────────────────────
function renderItems() {
	const list = document.getElementById('items-list');
	const isReadonly = (noteData.docstatus === 1) || submitted;
	let totalOrdered = 0, totalDelivered = 0;

	list.innerHTML = noteData.items.map(item => {
		const ordered = item.ordered_qty;
		const delivered = itemState[item.name];
		totalOrdered += ordered;
		totalDelivered += delivered;
		const isOver = delivered > ordered;
		const isNeg = delivered < 0;
		const invalid = isOver || isNeg;
		const isPartial = !isReadonly && delivered >= 0 && delivered < ordered;
		const initials = (item.item_name || item.item_code || '').substring(0, 2).toUpperCase();

		const placeholder = `<div class="item-placeholder">${esc(initials)}</div>`;
		const partialBadge = isPartial ? '<span class="item-partial">Partial Delivery</span>' : '';

		let deliveredField;
		if (isReadonly) {
			deliveredField = `<span class="item-unit">Delivered</span> <span class="item-delivered-ro">${delivered} ${esc(item.uom)}</span>`;
		} else {
			deliveredField = `<div class="stepper${invalid ? ' invalid' : ''}">
				<button class="stepper-btn" onclick="changeQty('${esc(item.name)}',-1)" ${delivered <= 0 ? 'disabled' : ''}>−</button>
				<input class="stepper-input" type="number" inputmode="numeric" min="0" max="${ordered}"
				       value="${delivered}" data-item="${esc(item.name)}"
				       onchange="setQty('${esc(item.name)}',this.value)"
				       oninput="setQty('${esc(item.name)}',this.value)">
				<button class="stepper-btn" onclick="changeQty('${esc(item.name)}',1)" ${delivered >= ordered ? 'disabled' : ''}>+</button>
			</div>
			<span class="item-unit">${esc(item.uom)}</span>`;
		}

		const errorHtml = isOver ? `<div class="item-error"><span class="msr">error</span>Delivered quantity cannot exceed the ordered quantity.</div>` :
		                  isNeg  ? `<div class="item-error"><span class="msr">error</span>Delivered quantity cannot be negative.</div>` : '';

		return `<div class="item-row">
			${placeholder}
			<div class="item-body">
				<div class="item-name-row">
					<span class="item-name">${esc(item.item_name)}</span>
					${partialBadge}
				</div>
				<span class="item-subtitle">Ordered ${ordered} ${esc(item.uom)}</span>
				${errorHtml}
			</div>
			<div class="item-right">
				${deliveredField}
			</div>
		</div>`;
	}).join('');

	// Update item count
	const count = noteData.items.length;
	const countEl = document.getElementById('items-count');
	if (countEl) countEl.textContent = count + (count === 1 ? ' item' : ' items');

	// Update summary
	const remaining = Math.max(0, totalOrdered - totalDelivered);
	const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
	set('sum-ordered', totalOrdered);
	set('sum-delivered', totalDelivered);
	set('sum-remaining', remaining);

	updateActionState();
}

function changeQty(itemName, delta) {
	const item = noteData.items.find(i => i.name === itemName);
	if (!item) return;
	itemState[itemName] = Math.max(0, Math.min(item.ordered_qty, itemState[itemName] + delta));
	renderItems();
}

function setQty(itemName, val) {
	const item = noteData.items.find(i => i.name === itemName);
	if (!item) return;
	const n = parseFloat(val);
	itemState[itemName] = isNaN(n) ? 0 : n;
	updateActionState();
}

function hasInvalidQtys() {
	if (!noteData) return false;
	return noteData.items.some(item => {
		const v = itemState[item.name];
		return v < 0 || v > item.ordered_qty;
	});
}


// ── Action state ──────────────────────────────────────
function updateActionState() {
	const isReadonly = (noteData && noteData.docstatus === 1) || submitted;
	const actionRow = document.getElementById('action-row');
	const proofSection = document.getElementById('proof-section');
	const remarksCard = document.getElementById('remarks-card');
	if (actionRow) actionRow.style.display = isReadonly ? 'none' : 'flex';
	if (proofSection) proofSection.style.display = isReadonly ? 'none' : 'block';
	if (remarksCard) {
		// Show remarks always (read-only when submitted)
		const textarea = remarksCard.querySelector('textarea');
		if (textarea) textarea.readOnly = isReadonly;
	}
	if (!isReadonly) {
		const inv = hasInvalidQtys();
		const submitBtn = document.getElementById('submit-btn');
		if (submitBtn) submitBtn.disabled = inv;
	}
}

// ── Attachments ───────────────────────────────────────
function renderAttachments() {
	const grid = document.getElementById('attachment-grid');
	const isReadonly = !noteData || noteData.docstatus === 1 || submitted;

	grid.innerHTML = attachments.map(a => {
		const isImg = /\.(jpg|jpeg|png|gif|webp|bmp|avif|svg)(\?|$)/i.test(a.file_url || '');
		const thumb = isImg
			? `<img class="attachment-img" src="${esc(a.file_url)}" alt="${esc(a.file_name)}">`
			: `<div class="attachment-icon-box"><span class="msr">picture_as_pdf</span><span class="attachment-icon-name">${esc(a.file_name)}</span></div>`;
		const removeBtn = !isReadonly ? `<button class="attachment-remove" onclick="removeAttachment('${esc(a.name)}')" title="Remove">×</button>` : '';
		return `<div class="attachment-thumb">${thumb}${removeBtn}</div>`;
	}).join('');

	const hint = document.getElementById('proof-hint');
	const required = document.getElementById('proof-required');
	if (hint) hint.style.display = (attachments.length === 0 && !isReadonly) ? 'block' : 'none';
	if (required) required.style.display = (attachments.length === 0 && !isReadonly) ? 'inline-block' : 'none';
}

async function removeAttachment(fileName) {
	try {
		await apiPost('frappe.client.delete', { doctype: 'File', name: fileName });
		attachments = attachments.filter(a => a.name !== fileName);
		renderAttachments();
	} catch (e) {
		showToast('Could not remove attachment: ' + e.message, true);
	}
}

async function handleFileUpload(files) {
	const grid = document.getElementById('attachment-grid');
	for (const file of files) {
		const placeholder = document.createElement('div');
		placeholder.className = 'attachment-thumb';
		placeholder.innerHTML = '<div class="attachment-icon-box"><span class="msr">upload</span><span class="attachment-icon-name">Uploading…</span></div>';
		grid.appendChild(placeholder);
		try {
			const formData = new FormData();
			formData.append('file', file, file.name);
			formData.append('doctype', 'Delivery Note');
			formData.append('docname', noteData.name);
			formData.append('is_private', '0');
			const r = await fetch('/api/method/upload_file', {
				method: 'POST',
				headers: { 'X-Frappe-CSRF-Token': csrf() },
				body: formData,
			});
			const d = await r.json();
			if (!r.ok) throw new Error(d.message || 'Upload failed');
			const uploaded = d.message;
			attachments.push({ name: uploaded.name, file_name: uploaded.file_name, file_url: uploaded.file_url });
		} catch (e) {
			showToast('Upload failed: ' + e.message, true);
		}
		placeholder.remove();
	}
	renderAttachments();
}

['upload-camera', 'upload-photo', 'upload-pdf'].forEach(id => {
	document.getElementById(id).addEventListener('change', function () {
		if (this.files.length) handleFileUpload(Array.from(this.files));
		this.value = '';
	});
});

// ── Save draft ────────────────────────────────────────
async function saveDraft() {
	if (!noteData || noteData.docstatus !== 0) return;
	if (hasInvalidQtys()) { showToast('Please correct invalid quantities before saving.', true); return; }
	const saveBtn = document.getElementById('save-btn');
	if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
	try {
		const itemsPayload = noteData.items.map(item => ({
			name: item.name, qty: itemState[item.name], ordered_qty: item.ordered_qty,
		}));
		const remarks = (document.getElementById('remarks-input') || {}).value || '';
		await apiPost('dms.api.delivery.save_delivery_note', {
			name: noteData.name,
			items_json: JSON.stringify(itemsPayload),
			remarks,
		});
		showToast('Draft saved');
		if (saveBtn) { saveBtn.textContent = 'Saved!'; }
		setTimeout(() => { if (saveBtn) { saveBtn.textContent = 'Save'; saveBtn.disabled = false; } }, 1500);
	} catch (e) {
		showToast('Save failed: ' + e.message, true);
		if (saveBtn) { saveBtn.textContent = 'Save'; saveBtn.disabled = false; }
	}
}

// ── Submit ────────────────────────────────────────────
async function submitNote() {
	if (!noteData || noteData.docstatus !== 0) return;
	if (hasInvalidQtys()) { showToast('Please correct invalid quantities before submitting.', true); return; }
	if (attachments.length === 0) { showToast('Please upload at least one proof of delivery.', true); return; }
	if (!confirm('Submit this delivery? This cannot be undone.')) return;

	const saveBtn = document.getElementById('save-btn');
	const submitBtn = document.getElementById('submit-btn');
	if (saveBtn) saveBtn.disabled = true;
	if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<span class="msr" style="font-size:20px">hourglass_top</span>Submitting…'; }

	try {
		const itemsPayload = noteData.items.map(item => ({
			name: item.name, qty: itemState[item.name], ordered_qty: item.ordered_qty,
		}));
		const remarks = (document.getElementById('remarks-input') || {}).value || '';
		await apiPost('dms.api.delivery.save_delivery_note', {
			name: noteData.name, items_json: JSON.stringify(itemsPayload), remarks,
		});
		await apiPost('dms.api.delivery.submit_delivery_note', { name: noteData.name });

		submitted = true;
		noteData.docstatus = 1;

		// Show success screen
		const detail = document.getElementById('note-detail');
		const success = document.getElementById('success-screen');
		if (detail) detail.style.display = 'none';
		if (success) {
			const sub = document.getElementById('success-sub');
			if (sub) sub.textContent = noteData.name + ' · ' + (noteData.customer_name || noteData.customer);
			success.classList.add('visible');
		}
	} catch (e) {
		showToast('Submission failed: ' + e.message, true);
		if (saveBtn) saveBtn.disabled = false;
		if (submitBtn) {
			submitBtn.disabled = false;
			submitBtn.innerHTML = '<span class="msr" style="font-size:20px;font-variation-settings:\'FILL\' 1,\'wght\' 400,\'GRAD\' 0,\'opsz\' 24">check_circle</span>Submit Delivery';
		}
	}
}

// ── Load note ─────────────────────────────────────────
(async function () {
	if (!DN_NAME) { showError('No delivery note specified.'); return; }
	try {
		noteData = await apiGet('dms.api.delivery.get_delivery_note', { name: DN_NAME });
	} catch (e) {
		showError(e.message || 'Could not load delivery note.');
		return;
	}

	noteData.items.forEach(item => { itemState[item.name] = item.qty; });
	attachments = noteData.attachments || [];

	// Header
	document.getElementById('note-id').textContent = noteData.name;
	document.getElementById('note-customer').textContent = noteData.customer_name || noteData.customer;
	document.getElementById('note-status-badge').innerHTML = statusBadge(noteData.docstatus, noteData.status);

	// Sidebar active nav (mirrors statusBadge()'s docstatus check)
	const activeNavId = noteData.docstatus === 1 ? 'snav-completed' : 'snav-pending';
	const activeNavEl = document.getElementById(activeNavId);
	if (activeNavEl) activeNavEl.classList.add('active');

	// Submitted banner
	if (noteData.docstatus === 1) {
		document.getElementById('submitted-banner').classList.add('visible');
	}

	// Customer name
	const custNameEl = document.getElementById('customer-name-value');
	if (custNameEl) custNameEl.textContent = noteData.customer_name || noteData.customer || '—';

	// Phone
	const contactEl = document.getElementById('contact-value');
	if (contactEl) {
		contactEl.textContent = noteData.contact_mobile || noteData.contact_display || '—';
	}

	// Address
	const addrSection = document.getElementById('address-section');
	if (noteData.shipping_address) {
		const addrText = noteData.shipping_address.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
		const mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addrText);
		addrSection.innerHTML = `<div class="info-row">
			<div class="info-icon" style="color:#3A5E72;background:#E4ECF0;"><span class="msr">location_on</span></div>
			<div style="flex:1;">
				<div class="info-label">Delivery Address</div>
				<div class="info-value" style="white-space:pre-line;line-height:1.45;margin-top:2px;">${esc(addrText)}</div>
				<a class="maps-link" href="${esc(mapsUrl)}" target="_blank" rel="noopener"><span class="msr">map</span>Open in Maps</a>
			</div>
		</div>`;
	} else {
		addrSection.innerHTML = `<div class="no-address-card">
			<span class="msr no-address-icon">location_off</span>
			<div>
				<div class="no-address-title">No Address Available</div>
				<div class="no-address-sub">Call the customer to confirm the location.</div>
			</div>
		</div>`;
	}

	// Remarks (from instructions field)
	if (noteData.instructions) {
		const inp = document.getElementById('remarks-input');
		if (inp) inp.value = noteData.instructions;
	}

	renderItems();
	renderAttachments();

	document.getElementById('loading-state').style.display = 'none';
	document.getElementById('note-detail').style.display = 'flex';
})();
