function csrf() {
	const m = document.cookie.match(/X-Frappe-CSRF-Token=([^;]+)/);
	return m ? decodeURIComponent(m[1]) : 'fetch';
}
async function get(method, args) {
	const p = new URLSearchParams(args);
	const r = await fetch('/api/method/' + method + (p.toString() ? '?' + p : ''), {
		headers: { 'X-Frappe-CSRF-Token': csrf(), 'Accept': 'application/json' },
	});
	if (!r.ok) return null;
	return (await r.json()).message;
}
async function post(method, args) {
	const r = await fetch('/api/method/' + method, {
		method: 'POST',
		headers: { 'X-Frappe-CSRF-Token': csrf(), 'Content-Type': 'application/json', 'Accept': 'application/json' },
		body: JSON.stringify(args),
	});
	if (!r.ok) return null;
	return (await r.json()).message;
}

function fmtDate(s) {
	if (!s) return '';
	const d = new Date(s + 'T00:00:00');
	return d.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}
function esc(s) {
	return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function stripHtml(s) {
	return (s || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').trim();
}

// ── Status badge ──────────────────────────────────────
function badgeHtml(row) {
	if (row.docstatus === 1) return '<span class="badge badge-completed">Completed</span>';
	const s = (row.status || '').toLowerCase();
	if (s.includes('transit') || s.includes('progress')) return '<span class="badge badge-inprogress">In Progress</span>';
	return '<span class="badge badge-pending">Pending</span>';
}

// ── DN card for pending list ──────────────────────────
function pendingCard(n) {
	const addr = stripHtml(n.shipping_address || '');
	const hasAddr = addr.length > 0;
	const addrBadge = hasAddr
		? `<span class="addr-badge addr-badge-ok"><span class="msr" style="font-size:16px">location_on</span>Address available</span>`
		: `<span class="addr-badge addr-badge-missing"><span class="msr" style="font-size:16px">location_off</span>No address available</span>`;
	return `<button class="dn-card" onclick="location.href='/delivery-note?name=${encodeURIComponent(n.name)}'">
		<div class="dn-card-top">
			<span class="dn-number">${esc(n.name)}</span>
			${badgeHtml(n)}
		</div>
		<div class="dn-customer">${esc(n.customer_name || '')}</div>
		<div class="dn-meta">
			<span class="dn-meta-item"><span class="msr">event</span>${fmtDate(n.posting_date)}</span>
		</div>
		${addrBadge}
	</button>`;
}

// ── DN card for completed list ────────────────────────
function completedCard(n) {
	return `<button class="dn-card" onclick="location.href='/delivery-note?name=${encodeURIComponent(n.name)}'">
		<div class="dn-card-top">
			<span class="dn-number">${esc(n.name)}</span>
			${badgeHtml(n)}
		</div>
		<div class="dn-customer">${esc(n.customer_name || '')}</div>
		<div class="card-bottom">
			<span class="proof-meta"><span class="msr">attachment</span>${n.item_count || 0} item${n.item_count === 1 ? '' : 's'}</span>
			<span class="card-view">View<span class="msr">chevron_right</span></span>
		</div>
	</button>`;
}

// ── Data cache ────────────────────────────────────────
let pendingNotes = null;
let completedNotes = null;
let assignNotes = null;

// ── Section switching ─────────────────────────────────
const SECTIONS = ['home', 'pending', 'completed', 'assign', 'profile'];
const SIDEBAR_IDS = ['snav-home', 'snav-pending', 'snav-completed', 'snav-assign', 'snav-profile'];
const BNAV_IDS = ['bnav-home', 'bnav-pending', 'bnav-completed', 'bnav-assign', 'bnav-profile'];

function setSection(sec) {
	if (!SECTIONS.includes(sec)) sec = 'home';
	SECTIONS.forEach(s => {
		const el = document.getElementById('s-' + s);
		if (el) {
			el.classList.toggle('active', s === sec);
		}
	});
	SIDEBAR_IDS.forEach(id => {
		const btn = document.getElementById(id);
		if (btn) btn.classList.toggle('active', id === 'snav-' + sec);
	});
	BNAV_IDS.forEach(id => {
		const btn = document.getElementById(id);
		if (btn) btn.classList.toggle('active', id === 'bnav-' + sec);
	});
	const url = new URL(location.href);
	url.searchParams.set('tab', sec);
	history.replaceState(null, '', url);
	if (sec === 'pending') loadPending();
	if (sec === 'completed') loadCompleted();
	if (sec === 'assign') loadAssign();
}

// ── Load functions ────────────────────────────────────
async function loadPending() {
	if (pendingNotes !== null) { renderList('pending-list', pendingNotes, 'pending'); return; }
	document.getElementById('pending-list').innerHTML = '<div class="empty-state">Loading…</div>';
	pendingNotes = await get('dms.api.delivery.get_delivery_notes', { status: 'pending' }) || [];
	renderList('pending-list', pendingNotes, 'pending');
	const badge = document.getElementById('pending-count-badge');
	if (badge) badge.textContent = pendingNotes.length;
}

async function loadCompleted() {
	if (completedNotes !== null) { renderList('completed-list', completedNotes, 'completed'); return; }
	document.getElementById('completed-list').innerHTML = '<div class="empty-state">Loading…</div>';
	completedNotes = await get('dms.api.delivery.get_delivery_notes', { status: 'completed' }) || [];
	renderList('completed-list', completedNotes, 'completed');
	const badge = document.getElementById('completed-count-badge');
	if (badge) badge.textContent = completedNotes.length;
}

function renderList(listId, notes, type) {
	const list = document.getElementById(listId);
	if (!notes.length) { list.innerHTML = '<div class="empty-state">No ' + type + ' deliveries found.</div>'; return; }
	list.innerHTML = type === 'completed' ? notes.map(completedCard).join('') : notes.map(pendingCard).join('');
}

// ── Search / filter ───────────────────────────────────
function filterCards(type) {
	const q = document.getElementById('search-' + type).value.trim().toLowerCase();
	const src = type === 'pending' ? (pendingNotes || []) : (completedNotes || []);
	const filtered = q ? src.filter(n => (n.name || '').toLowerCase().includes(q) || (n.customer_name || '').toLowerCase().includes(q)) : src;
	renderList(type + '-list', filtered, type);
}

// ── Assign card ───────────────────────────────────────
function assignCard(n, isMine) {
	const addr = stripHtml(n.shipping_address || '');
	const hasAddr = addr.length > 0;
	const addrStyle = hasAddr
		? 'display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:600;color:#3A5A48;background:#EAF0EC;padding:4px 10px;border-radius:999px;'
		: 'display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:600;color:#9A4A35;background:#F4E6E0;padding:4px 10px;border-radius:999px;';
	const addrIcon = hasAddr ? 'location_on' : 'location_off';
	const addrText = hasAddr ? 'Address available' : 'No address';
	const btnStyle = isMine
		? 'display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:13px;border:1px solid #DCD5C8;border-radius:13px;background:#fff;color:#6F675B;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;'
		: 'display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:13px;border:none;border-radius:13px;background:#2E4034;color:#F6F3ED;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer;';
	const btnIcon = isMine ? 'person_remove' : 'person_add';
	const btnLabel = isMine ? 'Unassign Me' : 'Assign to Me';
	// ponytail: single-quote arg — DN names never contain single quotes, avoids broken onclick="doAssign("...")"
	const onclick = isMine ? `doUnassign('${n.name}')` : `doAssign('${n.name}')`;
	const itemsLabel = (n.item_count || 0) + ' item' + (n.item_count === 1 ? '' : 's');
	return `<div style="background:#fff;border:1px solid #ECE6DB;border-radius:18px;padding:17px;display:flex;flex-direction:column;gap:12px;box-shadow:0 1px 2px rgba(35,32,28,.04);">
		<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
			<span style="font-family:ui-monospace,Menlo,monospace;font-size:12.5px;font-weight:600;color:#8A8275;letter-spacing:.02em;">${esc(n.name)}</span>
			<span style="${addrStyle}"><span class="msr" style="font-size:16px;">${addrIcon}</span>${addrText}</span>
		</div>
		<div style="font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:600;color:#23201C;line-height:1.08;">${esc(n.customer_name || '')}</div>
		<div style="display:flex;flex-wrap:wrap;gap:14px;font-size:13px;color:#6F675B;">
			<span style="display:inline-flex;align-items:center;gap:6px;"><span class="msr" style="font-size:17px;color:#A59C8C;">event</span>${fmtDate(n.posting_date)}</span>
			<span style="display:inline-flex;align-items:center;gap:6px;"><span class="msr" style="font-size:17px;color:#A59C8C;">inventory_2</span>${itemsLabel}</span>
		</div>
		<button onclick="${onclick}" style="${btnStyle}"><span class="msr" style="font-size:19px">${btnIcon}</span>${btnLabel}</button>
	</div>`;
}

// ── Load / filter assign ──────────────────────────────
async function loadAssign() {
	if (assignNotes !== null) { renderAssignFiltered(); return; }
	document.getElementById('assign-unassigned-list').innerHTML = '<div class="empty-state">Loading…</div>';
	document.getElementById('assign-mine-list').innerHTML = '<div class="empty-state">Loading…</div>';
	assignNotes = await get('dms.api.delivery.get_assignable_delivery_notes') || [];
	renderAssignFiltered();
}

function renderAssignFiltered() {
	const q = (document.getElementById('search-assign').value || '').trim().toLowerCase();
	const dateVal = document.getElementById('assign-date-filter').value;
	const now = new Date();
	const todayStr = now.toISOString().slice(0, 10);
	const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay());
	const weekStr = weekStart.toISOString().slice(0, 10);
	const monthStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';

	let list = assignNotes;
	if (q) list = list.filter(n => (n.name || '').toLowerCase().includes(q) || (n.customer_name || '').toLowerCase().includes(q));
	if (dateVal === 'today') list = list.filter(n => n.posting_date === todayStr);
	else if (dateVal === 'week') list = list.filter(n => (n.posting_date || '') >= weekStr);
	else if (dateVal === 'month') list = list.filter(n => (n.posting_date || '') >= monthStr);

	const unassigned = list.filter(n => !n.is_mine);
	const mine = list.filter(n => n.is_mine);

	const uContainer = document.getElementById('assign-unassigned-list');
	uContainer.innerHTML = unassigned.length
		? unassigned.map(n => assignCard(n, false)).join('')
		: '<div style="text-align:center;padding:38px 20px;color:#A59C8C;font-size:14px;background:#fff;border:1px dashed #E0D9CB;border-radius:18px;">No deliveries are available for assignment.</div>';

	const mContainer = document.getElementById('assign-mine-list');
	mContainer.innerHTML = mine.length
		? mine.map(n => assignCard(n, true)).join('')
		: '<div style="text-align:center;padding:38px 20px;color:#A59C8C;font-size:14px;background:#fff;border:1px dashed #E0D9CB;border-radius:18px;">You have no assigned deliveries.</div>';

	const uBadge = document.getElementById('assign-unassigned-count-badge');
	if (uBadge) uBadge.textContent = unassigned.length;
	const mBadge = document.getElementById('assign-mine-count-badge');
	if (mBadge) mBadge.textContent = mine.length;
	const openEl = document.getElementById('stat-open-deliveries');
	if (openEl) openEl.textContent = (assignNotes || []).filter(n => !n.is_mine).length;
}

function filterAssignCards() { renderAssignFiltered(); }

// ── Assign / Unassign actions ─────────────────────────
async function doAssign(name) {
	const result = await post('dms.api.delivery.assign_delivery_note', { name });
	if (result) { assignNotes = null; pendingNotes = null; loadAssign(); }
}

async function doUnassign(name) {
	const result = await post('dms.api.delivery.unassign_delivery_note', { name });
	if (result) { assignNotes = null; pendingNotes = null; loadAssign(); }
}

// ── Greeting + date ───────────────────────────────────
(function () {
	const h = new Date().getHours();
	const g = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
	const titleEl = document.getElementById('home-title');
	if (titleEl) titleEl.textContent = titleEl.textContent.replace('morning', g);
	const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
	const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
	const now = new Date();
	const dateEl = document.getElementById('home-date');
	if (dateEl) dateEl.textContent = days[now.getDay()] + ' · ' + now.getDate() + ' ' + months[now.getMonth()].toUpperCase();
})();

// ── Recent activity ───────────────────────────────────
function renderActivity(items) {
	const list = document.getElementById('activity-list');
	if (!items || !items.length) {
		list.innerHTML = '<div style="padding:12px 0;font-size:13px;color:#A59C8C;">No recent activity.</div>';
		return;
	}
	const iconMap = { 1: { icon: 'task_alt', bg: '#E2EDE5', color: '#356048' } };
	list.innerHTML = items.map(r => {
		const meta = iconMap[r.docstatus] || { icon: 'inventory_2', bg: '#F6EAD2', color: '#9A6B12' };
		const when = r.modified ? new Date(r.modified).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' }) : '';
		return `<div class="activity-row">
			<div class="activity-icon" style="background:${meta.bg};color:${meta.color};"><span class="msr" style="font-size:20px">${meta.icon}</span></div>
			<div class="activity-text">${esc(r.name)} — ${esc(r.customer_name || '')}</div>
			<div class="activity-time">${when}</div>
		</div>`;
	}).join('');
}

// ── Init ──────────────────────────────────────────────
(async function () {
	const tab = new URLSearchParams(location.search).get('tab') || 'home';
	setSection(tab);
	loadAssign(); // populates stat-open-deliveries with unassigned count

	const stats = await get('dms.api.delivery.get_delivery_dashboard');
	if (stats) {
		const setText = (id, val) => {
			const el = document.getElementById(id);
			if (el) el.textContent = val;
		};
		setText('stat-pending', stats.pending);
		setText('stat-inprogress', stats.in_progress);
		setText('stat-completed-today', stats.completed_today);
		setText('stat-total', stats.total_assigned);

		const sub = document.getElementById('home-sub');
		if (sub) sub.textContent = 'You have ' + stats.pending + ' deliver' + (stats.pending === 1 ? 'y' : 'ies') + ' waiting today.';

		renderActivity(stats.recent_activity || []);

		const pendingBadge = document.getElementById('pending-count-badge');
		if (pendingBadge && pendingBadge.textContent === '') pendingBadge.textContent = stats.pending;
	}
})();
