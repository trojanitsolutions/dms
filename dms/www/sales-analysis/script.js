function csrf(){const m=document.cookie.match(/X-Frappe-CSRF-Token=([^;]+)/);return m?decodeURIComponent(m[1]):'fetch'}

async function get(method, args = {}) {
  const p = new URLSearchParams(args);
  const r = await fetch(`/api/method/${method}?${p}`, {
    headers: { 'X-Frappe-CSRF-Token': csrf(), 'Accept': 'application/json' }
  });
  if (!r.ok) return null;
  const json = await r.json();
  return json.message;
}

function esc(s) {
  if (s == null) return '';
  const el = document.createElement('div');
  el.textContent = String(s);
  return el.innerHTML;
}

function fmt(n, cur = 'QAR') {
  return `${cur} ` + Number(n || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s.replace(' ', 'T'));
  if (isNaN(d.getTime())) return esc(s);
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getBadgeClass(status) {
  const map = {
    'Fully Completed': 'badge-success',
    'Fully Delivered': 'badge-success',
    'Fully Invoiced': 'badge-success',
    'Delivered – Invoice Pending': 'badge-warning',
    'Draft Invoice': 'badge-warning',
    'Partially Delivered': 'badge-yellow',
    'Partly Delivered': 'badge-yellow',
    'Partly Invoiced': 'badge-yellow',
    'Not Delivered': 'badge-error',
    'Not Invoiced': 'badge-error',
    'Closed': 'badge-neutral',
    'Cancelled': 'badge-neutral',
    'Not Applicable': 'badge-neutral'
  };
  return map[status] || 'badge-neutral';
}

function parseRefs(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

// App State
let allRows = [];
let filteredRows = [];
let summaryData = [];
let pageSize = 20;
let currentPage = 1;
let currentSort = { field: 'transaction_date', asc: false };
let activeDrilldownKey = null;

async function loadData() {
  setLoadingState(true);
  hideEmptyAndError();

  const apiFilters = {};
  const fromDate = document.getElementById('from-date-filter').value;
  const toDate = document.getElementById('to-date-filter').value;
  if (fromDate) apiFilters.from_date = fromDate;
  if (toDate) apiFilters.to_date = toDate;

  try {
    const res = await get('dms.api.reports.get_sales_order_status', { filters: JSON.stringify(apiFilters) });
    setLoadingState(false);
    if (!res || !res.data) {
      showError('Failed to retrieve sales order status data.');
      return;
    }

    allRows = res.data;
    summaryData = res.report_summary || [];
    applyFilters();
  } catch (err) {
    console.error(err);
    setLoadingState(false);
    showError('Network error while loading report data.');
  }
}

function applyFilters() {
  const search = (document.getElementById('search-input').value || '').trim().toLowerCase();
  const fulfilment = document.getElementById('fulfilment-filter').value;
  const delivery = document.getElementById('delivery-filter').value;
  const invoice = document.getElementById('invoice-filter').value;
  const soStatus = document.getElementById('so-status-filter').value;
  const overdueOnly = document.getElementById('overdue-only-check').checked;
  const pendingDeliveryOnly = document.getElementById('pending-delivery-check').checked;
  const pendingInvoiceOnly = document.getElementById('pending-invoice-check').checked;
  const draftInvoiceOnly = document.getElementById('draft-invoice-check').checked;

  const DELIVERY_PENDING = ['Not Delivered', 'Partly Delivered'];
  const INVOICE_PENDING = ['Not Invoiced', 'Draft Invoice', 'Partly Invoiced'];

  filteredRows = allRows.filter(r => {
    if (search) {
      const matchId = (r.sales_order || '').toLowerCase().includes(search);
      const matchCust = (r.customer_name || '').toLowerCase().includes(search);
      const matchCustId = (r.customer || '').toLowerCase().includes(search);
      if (!matchId && !matchCust && !matchCustId) return false;
    }
    if (fulfilment && r.fulfilment_status !== fulfilment) return false;
    if (delivery && r.delivery_status !== delivery) return false;
    if (invoice && r.invoice_status !== invoice) return false;
    if (soStatus && r.sales_order_status !== soStatus) return false;
    if (overdueOnly && !(Number(r.days_overdue) > 0)) return false;
    if (pendingDeliveryOnly && !DELIVERY_PENDING.includes(r.delivery_status)) return false;
    if (pendingInvoiceOnly && !INVOICE_PENDING.includes(r.invoice_status)) return false;
    if (draftInvoiceOnly && !r.has_draft_invoice) return false;
    return true;
  });

  updateKPICards();
  currentPage = 1;
  renderTable();
}

function updateKPICards() {
  const count = (fn) => allRows.filter(fn).length;
  const totalOrders = allRows.length;
  const totalVal = allRows.reduce((acc, r) => r.fulfilment_status !== 'Cancelled' ? acc + Number(r.order_value || 0) : acc, 0);
  const cur = allRows.length && allRows[0].currency ? allRows[0].currency : 'QAR';

  const completed = count(r => r.fulfilment_status === 'Fully Completed');
  const pendingDelivery = count(r => ['Not Delivered', 'Partly Delivered'].includes(r.delivery_status));
  const pendingInvoice = count(r => ['Not Invoiced', 'Draft Invoice', 'Partly Invoiced'].includes(r.invoice_status));
  const overdue = count(r => Number(r.days_overdue) > 0);

  setKPI('kpi-total', totalOrders);
  setKPI('kpi-value', fmt(totalVal, cur));
  setKPI('kpi-completed', completed);
  setKPI('kpi-pending-delivery', pendingDelivery);
  setKPI('kpi-pending-invoice', pendingInvoice);
  setKPI('kpi-overdue', overdue);

  document.querySelectorAll('.kpi-card').forEach(c => c.classList.remove('loading'));
}

function setKPI(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function renderTable() {
  const tbody = document.getElementById('table-body');
  const emptyState = document.getElementById('empty-state');
  const emptyMsg = document.getElementById('empty-state-msg');
  const showingText = document.getElementById('showing-text');
  const loadMoreBtn = document.getElementById('load-more-btn');

  if (!filteredRows.length) {
    tbody.innerHTML = '';
    emptyState.hidden = false;
    emptyMsg.textContent = allRows.length
      ? 'No orders match your selected filters.'
      : 'No sales orders found for your account.';
    showingText.textContent = 'Showing 0 orders';
    loadMoreBtn.style.display = 'none';
    return;
  }

  emptyState.hidden = true;
  const total = filteredRows.length;
  const countToShow = pageSize === 0 ? total : Math.min(currentPage * pageSize, total);
  const rowsSlice = filteredRows.slice(0, countToShow);

  showingText.textContent = `Showing ${rowsSlice.length} of ${total} orders`;
  loadMoreBtn.style.display = (pageSize !== 0 && countToShow < total) ? 'inline-flex' : 'none';

  tbody.innerHTML = rowsSlice.map((r, i) => {
    const cur = r.currency || 'QAR';
    const overdueDays = Number(r.days_overdue || 0);
    const overdueHtml = overdueDays > 0
      ? `<span class="badge-error badge">${overdueDays}d overdue</span>`
      : `<span class="text-muted">—</span>`;

    const invRefs = parseRefs(r.invoice_refs);
    const dnRefs = parseRefs(r.delivery_note_refs);
    const totalDocs = invRefs.length + dnRefs.length;
    const docsBtn = totalDocs > 0
      ? `<button class="btn-doc-pill" data-idx="${i}" title="View linked delivery notes and invoices">
          <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd"/></svg>
          ${totalDocs} docs
        </button>`
      : `<span class="text-muted">—</span>`;

    return `
      <tr>
        <td class="col-num">${i + 1}</td>
        <td>
          <a href="/sales-order?order=${encodeURIComponent(r.sales_order)}" class="order-link font-medium">
            ${esc(r.sales_order)}
          </a>
        </td>
        <td>
          <div class="cust-name font-medium">${esc(r.customer_name || r.customer)}</div>
          <div class="cust-code text-muted">${esc(r.customer)}</div>
        </td>
        <td class="whitespace-nowrap">${fmtDate(r.transaction_date)}</td>
        <td class="whitespace-nowrap">${fmtDate(r.delivery_date)}</td>
        <td class="text-right font-medium">${fmt(r.order_value, cur)}</td>
        <td class="text-right">${Number(r.ordered_qty || 0)}</td>
        <td class="text-right font-medium ${Number(r.delivered_qty) < Number(r.ordered_qty) ? 'text-warning' : 'text-success'}">
          ${Number(r.delivered_qty || 0)}
        </td>
        <td class="text-right font-medium">
          ${Number(r.invoiced_qty || 0)}
        </td>
        <td><span class="badge ${getBadgeClass(r.fulfilment_status)}">${esc(r.fulfilment_status)}</span></td>
        <td><span class="badge ${getBadgeClass(r.delivery_status)}">${esc(r.delivery_status)}</span></td>
        <td><span class="badge ${getBadgeClass(r.invoice_status)}">${esc(r.invoice_status)}</span></td>
        <td class="text-center">${overdueHtml}</td>
        <td class="text-center">${docsBtn}</td>
      </tr>
    `;
  }).join('');

  // Attach click handlers to doc pills
  tbody.querySelectorAll('.btn-doc-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      const row = rowsSlice[idx];
      if (row) openDocModal(row);
    });
  });
}

function openDocModal(row) {
  const modal = document.getElementById('doc-modal-overlay');
  const title = document.getElementById('modal-title');
  const sub = document.getElementById('modal-subtitle');
  const body = document.getElementById('modal-body');

  title.textContent = `Linked Documents for ${row.sales_order}`;
  sub.textContent = `${row.customer_name || row.customer} · Order Value ${fmt(row.order_value, row.currency)}`;

  const dnRefs = parseRefs(row.delivery_note_refs);
  const invRefs = parseRefs(row.invoice_refs);

  let html = '';

  // Delivery Notes
  html += `<div class="modal-section-title">Delivery Notes (${dnRefs.length})</div>`;
  if (!dnRefs.length) {
    html += `<div class="empty-docs-note">No Delivery Notes created yet for this order.</div>`;
  } else {
    html += `
      <div class="modal-table-wrap">
        <table class="modal-table">
          <thead>
            <tr>
              <th>Delivery Note</th>
              <th>Status</th>
              <th>Posting Date</th>
              <th class="text-right">Quantity</th>
            </tr>
          </thead>
          <tbody>
            ${dnRefs.map(dn => `
              <tr>
                <td class="font-medium">${esc(dn.name)}${dn.is_return ? ' <span class="badge badge-warning">Return</span>' : ''}</td>
                <td><span class="badge ${dn.docstatus === 1 ? 'badge-success' : dn.docstatus === 2 ? 'badge-neutral' : 'badge-warning'}">${esc(dn.state || dn.status)}</span></td>
                <td>${fmtDate(dn.posting_date)}</td>
                <td class="text-right font-medium">${Number(dn.qty || 0)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // Sales Invoices
  html += `<div class="modal-section-title mt-4">Sales Invoices (${invRefs.length})</div>`;
  if (!invRefs.length) {
    html += `<div class="empty-docs-note">No Sales Invoices created yet for this order.</div>`;
  } else {
    html += `
      <div class="modal-table-wrap">
        <table class="modal-table">
          <thead>
            <tr>
              <th>Sales Invoice</th>
              <th>Status</th>
              <th>Posting Date</th>
              <th class="text-right">Qty</th>
              <th class="text-right">Grand Total</th>
              <th class="text-right">Outstanding</th>
            </tr>
          </thead>
          <tbody>
            ${invRefs.map(inv => `
              <tr>
                <td class="font-medium">${esc(inv.name)}${inv.is_return ? ' <span class="badge badge-warning">Return</span>' : ''}</td>
                <td><span class="badge ${inv.docstatus === 1 ? 'badge-success' : inv.docstatus === 2 ? 'badge-neutral' : 'badge-warning'}">${esc(inv.state || inv.status)}</span></td>
                <td>${fmtDate(inv.posting_date)}</td>
                <td class="text-right font-medium">${Number(inv.qty || 0)}</td>
                <td class="text-right font-medium">${fmt(inv.grand_total, inv.currency)}</td>
                <td class="text-right">${inv.outstanding_amount != null ? fmt(inv.outstanding_amount, inv.currency) : '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  body.innerHTML = html;
  modal.classList.add('open');
}

function closeDocModal() {
  document.getElementById('doc-modal-overlay').classList.remove('open');
}

function setLoadingState(loading) {
  const tbody = document.getElementById('table-body');
  if (loading) {
    tbody.innerHTML = `<tr><td colspan="14" class="text-center py-8 text-muted">Loading sales analysis data…</td></tr>`;
    document.querySelectorAll('.kpi-card').forEach(c => c.classList.add('loading'));
  }
}

function hideEmptyAndError() {
  document.getElementById('empty-state').hidden = true;
  document.getElementById('error-state').hidden = true;
}

function showError(msg) {
  document.getElementById('error-state').hidden = false;
  document.getElementById('table-body').innerHTML = '';
}

// Drilldown on KPI Card Click
function handleKPIClick(key) {
  const overdueCheck = document.getElementById('overdue-only-check');
  const pendingDelCheck = document.getElementById('pending-delivery-check');
  const pendingInvCheck = document.getElementById('pending-invoice-check');
  const fulfilmentSel = document.getElementById('fulfilment-filter');

  // Clear previous toggles
  overdueCheck.checked = false;
  pendingDelCheck.checked = false;
  pendingInvCheck.checked = false;
  fulfilmentSel.value = '';

  if (activeDrilldownKey === key) {
    activeDrilldownKey = null;
    document.querySelectorAll('.kpi-card').forEach(c => c.classList.remove('active'));
    applyFilters();
    return;
  }

  activeDrilldownKey = key;
  document.querySelectorAll('.kpi-card').forEach(c => {
    c.classList.toggle('active', c.dataset.key === key);
  });

  if (key === 'completed') {
    fulfilmentSel.value = 'Fully Completed';
  } else if (key === 'pending_delivery') {
    pendingDelCheck.checked = true;
  } else if (key === 'pending_invoice') {
    pendingInvCheck.checked = true;
  } else if (key === 'overdue') {
    overdueCheck.checked = true;
  }

  applyFilters();
}

// Reset all filters
function resetFilters() {
  document.getElementById('search-input').value = '';
  document.getElementById('from-date-filter').value = '';
  document.getElementById('to-date-filter').value = '';
  document.getElementById('fulfilment-filter').value = '';
  document.getElementById('delivery-filter').value = '';
  document.getElementById('invoice-filter').value = '';
  document.getElementById('so-status-filter').value = '';
  document.getElementById('overdue-only-check').checked = false;
  document.getElementById('pending-delivery-check').checked = false;
  document.getElementById('pending-invoice-check').checked = false;
  document.getElementById('draft-invoice-check').checked = false;

  activeDrilldownKey = null;
  document.querySelectorAll('.kpi-card').forEach(c => c.classList.remove('active'));

  loadData();
}

// Export Excel
function exportExcel() {
  const fromDate = document.getElementById('from-date-filter').value;
  const toDate = document.getElementById('to-date-filter').value;
  const fulfilment = document.getElementById('fulfilment-filter').value;
  const delivery = document.getElementById('delivery-filter').value;
  const invoice = document.getElementById('invoice-filter').value;
  const soStatus = document.getElementById('so-status-filter').value;
  const overdue = document.getElementById('overdue-only-check').checked ? 1 : 0;
  const pendingDel = document.getElementById('pending-delivery-check').checked ? 1 : 0;
  const pendingInv = document.getElementById('pending-invoice-check').checked ? 1 : 0;
  const draftInv = document.getElementById('draft-invoice-check').checked ? 1 : 0;

  const filters = {
    from_date: fromDate || undefined,
    to_date: toDate || undefined,
    fulfilment_status: fulfilment || undefined,
    delivery_status: delivery || undefined,
    invoice_status: invoice || undefined,
    sales_order_status: soStatus || undefined,
    overdue_only: overdue,
    pending_delivery_only: pendingDel,
    pending_invoice_only: pendingInv,
    draft_invoice_only: draftInv
  };

  const url = `/api/method/dms.api.reports.export_sales_order_status?filters=${encodeURIComponent(JSON.stringify(filters))}`;
  window.open(url, '_blank');
}

// Initialize event listeners
document.addEventListener('DOMContentLoaded', () => {
  // Sidebar toggle for desktop & tablet
  const sidebarBtn = document.getElementById('sidebar-toggle');
  if (sidebarBtn) {
    sidebarBtn.addEventListener('click', () => {
      document.body.classList.toggle('sidebar-expanded');
    });
  }

  // Logout dialog
  const overlay = document.getElementById('logout-confirm-overlay');
  document.querySelectorAll('a[href="/sales-logout"]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      overlay.classList.add('open');
    });
  });
  document.getElementById('logout-cancel-btn').addEventListener('click', () => overlay.classList.remove('open'));
  document.getElementById('logout-confirm-btn').addEventListener('click', () => window.location.href = '/sales-logout');
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });

  // Modal close handlers
  document.getElementById('modal-close-btn').addEventListener('click', closeDocModal);
  document.getElementById('modal-ok-btn').addEventListener('click', closeDocModal);
  document.getElementById('doc-modal-overlay').addEventListener('click', e => {
    if (e.target.id === 'doc-modal-overlay') closeDocModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeDocModal();
      overlay.classList.remove('open');
    }
  });

  // KPI card clicks
  document.querySelectorAll('.kpi-card').forEach(card => {
    card.addEventListener('click', () => handleKPIClick(card.dataset.key));
  });

  // Search input debounced
  let searchTimeout = null;
  document.getElementById('search-input').addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(applyFilters, 200);
  });

  // Dropdown & Checkbox changes
  ['from-date-filter', 'to-date-filter'].forEach(id => {
    document.getElementById(id).addEventListener('change', loadData);
  });
  ['fulfilment-filter', 'delivery-filter', 'invoice-filter', 'so-status-filter',
   'overdue-only-check', 'pending-delivery-check', 'pending-invoice-check', 'draft-invoice-check'
  ].forEach(id => {
    document.getElementById(id).addEventListener('change', applyFilters);
  });

  // Reset & Refresh & Retry
  document.getElementById('reset-filters-btn').addEventListener('click', resetFilters);
  document.getElementById('empty-reset-btn').addEventListener('click', resetFilters);
  document.getElementById('refresh-btn').addEventListener('click', loadData);
  document.getElementById('retry-btn').addEventListener('click', loadData);
  document.getElementById('export-btn').addEventListener('click', exportExcel);

  // Pagination buttons
  document.querySelectorAll('.page-size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.page-size-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      pageSize = Number(btn.dataset.size);
      currentPage = 1;
      renderTable();
    });
  });

  document.getElementById('load-more-btn').addEventListener('click', () => {
    currentPage += 1;
    renderTable();
  });

  // Fetch initial report data
  loadData();
});
