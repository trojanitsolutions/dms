function csrf(){const m=document.cookie.match(/X-Frappe-CSRF-Token=([^;]+)/);return m?decodeURIComponent(m[1]):'fetch'}

const API = 'dms.api.customer_ledger_report';
const MONEY_KPIS = { opening_balance: 'kpi-opening', invoiced_amount: 'kpi-invoiced', paid_amount: 'kpi-paid', closing_balance: 'kpi-closing' };

// Returns {ok, message, error}. `error` is the server's own message when it sends one.
async function call(method, args = {}) {
  const r = await fetch(`/api/method/${method}?${new URLSearchParams(args)}`, {
    headers: { 'X-Frappe-CSRF-Token': csrf(), 'Accept': 'application/json' }
  });
  const json = await r.json().catch(() => ({}));
  if (r.ok) return { ok: true, message: json.message };
  let error = '';
  try {
    const msgs = JSON.parse(json._server_messages || '[]');
    error = msgs.map(m => JSON.parse(m).message).join(' ');
  } catch (e) { /* keep generic text */ }
  const tmp = document.createElement('div');
  tmp.innerHTML = error;
  return { ok: false, error: tmp.textContent.trim() };
}

async function get(method, args) {
  const res = await call(method, args);
  return res.ok ? res.message : null;
}

function esc(s) {
  if (s == null) return '';
  const el = document.createElement('div');
  el.textContent = String(s);
  return el.innerHTML;
}

function fmt(n, cur = 'QAR') {
  return `${cur || 'QAR'} ` + Number(n || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function $(id) { return document.getElementById(id); }

function isoDate(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function defaultDates() {
  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - 1);
  $('from-date-filter').value = isoDate(from);
  $('to-date-filter').value = isoDate(to);
}

function displayDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// App State
let columns = [];
let allRows = [];
let filteredRows = [];
let currency = 'QAR';
let pageSize = 20;
let currentPage = 1;
let loadSeq = 0;

function getServerFilters() {
  const filters = {
    from_date: $('from-date-filter').value,
    to_date: $('to-date-filter').value,
  };
  const company = $('company-filter').value;
  const customer = $('customer-filter').value.trim();
  const customerGroup = $('customer-group-filter').value.trim();
  if (company) filters.company = company;
  if (customer) filters.party = customer;
  if (customerGroup) filters.customer_group = customerGroup;
  return filters;
}

function datesValid() {
  const from = $('from-date-filter').value;
  const to = $('to-date-filter').value;
  const ok = Boolean(from && to && from <= to);
  $('date-error').hidden = ok || !(from && to);
  ['refresh-btn', 'export-xlsx-btn', 'export-pdf-btn'].forEach(id => { $(id).disabled = !ok; });
  return ok;
}

async function loadData() {
  if (!datesValid()) return;
  const seq = ++loadSeq;
  setLoadingState();
  hideEmptyAndError();

  try {
    const res = await call(`${API}.get_customer_ledger`, { filters: JSON.stringify(getServerFilters()) });
    if (seq !== loadSeq) return; // a newer request has started
    if (!res.ok || !res.message) {
      showError(res.error);
      return;
    }
    columns = res.message.columns || [];
    allRows = res.message.data || [];
    currency = (allRows[0] && allRows[0].currency) || 'QAR';
    const f = res.message.filters || {};
    $('page-sub').textContent = `Customer Ledger Summary · ${displayDate(f.from_date)} – ${displayDate(f.to_date)}`;
    applyFilters();
  } catch (err) {
    console.error(err);
    if (seq === loadSeq) showError();
  }
}

function applyFilters() {
  const search = ($('search-input').value || '').trim().toLowerCase();
  filteredRows = search
    ? allRows.filter(r =>
        (r.party || '').toLowerCase().includes(search) ||
        (r.party_name || '').toLowerCase().includes(search))
    : allRows;

  updateKPICards();
  currentPage = 1;
  renderTable();
}

function sum(rows, field) {
  return rows.reduce((acc, r) => acc + Number(r[field] || 0), 0);
}

// KPIs follow the rows currently listed (server filters + search).
function updateKPICards() {
  Object.entries(MONEY_KPIS).forEach(([field, id]) => { $(id).textContent = fmt(sum(filteredRows, field), currency); });
  document.querySelectorAll('.kpi-card').forEach(c => c.classList.remove('loading'));
}

const isMoney = col => col.fieldtype === 'Currency';

function cellHtml(row, col, idx) {
  const value = row[col.fieldname];
  if (isMoney(col)) {
    const cls = col.fieldname === 'closing_balance' ? ` font-medium ${balanceClass(value)}` : '';
    return `<td class="num${cls}">${fmt(value, row.currency || currency)}</td>`;
  }
  if (col.fieldname === 'dr_or_cr') {
    return value ? `<td><span class="drcr ${String(value).toLowerCase()}">${esc(value)}</span></td>` : '<td></td>';
  }
  const sticky = idx === 0 ? ' sticky font-medium' : '';
  const wrap = col.fieldname === 'party_name' ? ' wrap' : '';
  return `<td class="${sticky}${wrap}">${esc(value == null ? '' : value)}</td>`;
}

function balanceClass(value) {
  const n = Number(value || 0);
  if (n > 0) return 'text-error';
  if (n < 0) return 'text-success';
  return 'text-muted';
}

function renderHead() {
  $('table-head').innerHTML = `<tr><th class="col-num">#</th>${columns.map((c, i) =>
    `<th class="${isMoney(c) ? 'num' : ''}${i === 0 ? ' sticky' : ''}">${esc(c.label)}</th>`).join('')}</tr>`;
}

function renderTable() {
  const tbody = $('table-body');
  const loadMoreBtn = $('load-more-btn');
  renderHead();

  if (!filteredRows.length) {
    tbody.innerHTML = '';
    $('table-container').hidden = true;
    $('empty-state').hidden = false;
    const customer = $('customer-filter').value.trim();
    const upTo = displayDate($('to-date-filter').value);
    $('empty-state-msg').textContent = allRows.length
      ? 'No customers match your search.'
      : customer
        ? `No customer matching "${customer}" has ledger entries up to ${upTo}. Check the name, or pick it from the suggestions.`
        : 'No customers have ledger entries for the selected filters.';
    $('table-foot').hidden = true;
    return;
  }

  $('table-container').hidden = false;
  $('empty-state').hidden = true;
  const total = filteredRows.length;
  const countToShow = pageSize === 0 ? total : Math.min(currentPage * pageSize, total);
  const rowsSlice = filteredRows.slice(0, countToShow);

  $('showing-text').textContent = `Showing ${rowsSlice.length} of ${total} customers`;
  loadMoreBtn.style.display = (pageSize !== 0 && countToShow < total) ? 'inline-flex' : 'none';

  tbody.innerHTML = rowsSlice.map((r, i) =>
    `<tr><td class="col-num">${i + 1}</td>${columns.map((c, idx) => cellHtml(r, c, idx)).join('')}</tr>`
  ).join('');
  renderTotalRow();
}

// Totals cover every listed row (all pages), like the exported files.
function renderTotalRow() {
  const cells = columns.map((c, i) => {
    if (isMoney(c)) {
      const t = sum(filteredRows, c.fieldname);
      const cls = c.fieldname === 'closing_balance' ? ` ${balanceClass(t)}` : '';
      return `<td class="num${cls}">${fmt(t, currency)}</td>`;
    }
    return i === 0 ? '<td class="sticky">Total</td>' : '<td></td>';
  }).join('');
  $('table-foot').innerHTML = `<tr class="total-row"><td class="col-num"></td>${cells}</tr>`;
  $('table-foot').hidden = false;
}

function setLoadingState() {
  $('table-container').hidden = false;
  $('table-head').innerHTML = '';
  $('table-foot').hidden = true;
  $('table-body').innerHTML = `<tr><td class="text-center py-8 text-muted">Loading customer ledger…</td></tr>`;
  $('load-more-btn').style.display = 'none';
  $('showing-text').textContent = '';
  document.querySelectorAll('.kpi-card').forEach(c => c.classList.add('loading'));
}

function hideEmptyAndError() {
  $('empty-state').hidden = true;
  $('error-state').hidden = true;
}

function showError(message) {
  $('error-msg').textContent = message || 'Something went wrong while fetching the Customer Ledger Summary.';
  $('error-state').hidden = false;
  $('table-container').hidden = true;
}

function resetFilters() {
  $('search-input').value = '';
  $('customer-filter').value = '';
  $('customer-group-filter').value = '';
  defaultDates();
  loadData();
}

// Export every listed row; when a search narrows the list, export only those customers.
// The file is fetched here (not opened in a tab) so a server error shows on this page.
async function exportReport(fileFormat) {
  if (!datesValid()) return;
  const filters = getServerFilters();
  if (filteredRows.length !== allRows.length) {
    if (!filteredRows.length) return;
    filters.selected = filteredRows.map(r => r.party);
  }
  const btn = $(fileFormat === 'pdf' ? 'export-pdf-btn' : 'export-xlsx-btn');
  const label = btn.lastChild;
  const original = label.textContent;
  const errorBox = $('export-error');
  errorBox.hidden = true;
  btn.disabled = true;
  label.textContent = ' Preparing…';
  try {
    const args = new URLSearchParams({ filters: JSON.stringify(filters), file_format: fileFormat });
    const r = await fetch(`/api/method/${API}.export_customer_ledger?${args}`, {
      headers: { 'X-Frappe-CSRF-Token': csrf() }
    });
    const type = r.headers.get('Content-Type') || '';
    if (!r.ok || type.includes('application/json')) {
      const json = await r.json().catch(() => ({}));
      let error = '';
      try {
        error = JSON.parse(json._server_messages || '[]').map(m => JSON.parse(m).message).join(' ');
      } catch (e) { /* keep generic text */ }
      const tmp = document.createElement('div');
      tmp.innerHTML = error;
      throw new Error(tmp.textContent.trim() || 'Export failed. Please try again.');
    }
    const blob = await r.blob();
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(r.headers.get('Content-Disposition') || '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = match ? decodeURIComponent(match[1]) : `Customer Ledger Summary.${fileFormat}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (e) {
    errorBox.textContent = e.message || 'Export failed. Please try again.';
    errorBox.hidden = false;
  } finally {
    label.textContent = original;
    btn.disabled = false;
    datesValid();
  }
}

// Fill a <datalist> from a search endpoint as the user types.
function bindTypeahead(inputId, listId, method) {
  const input = $(inputId);
  const list = $(listId);
  let timer = null;

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const options = await get(method, { txt: input.value }) || [];
      list.innerHTML = options.map(o =>
        `<option value="${esc(o.value)}">${esc(o.label !== o.value ? o.label : (o.description || ''))}</option>`
      ).join('');
    }, 250);
  });

  // `change` fires when the value is committed (pick, Enter, blur), not on every keystroke.
  input.addEventListener('change', loadData);
}

document.addEventListener('DOMContentLoaded', () => {
  const sidebarBtn = $('sidebar-toggle');
  if (sidebarBtn) {
    sidebarBtn.addEventListener('click', () => document.body.classList.toggle('sidebar-expanded'));
  }

  // Logout dialog
  const overlay = $('logout-confirm-overlay');
  document.querySelectorAll('a[href="/sales-logout"]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      overlay.classList.add('open');
    });
  });
  $('logout-cancel-btn').addEventListener('click', () => overlay.classList.remove('open'));
  $('logout-confirm-btn').addEventListener('click', () => window.location.href = '/sales-logout');
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') overlay.classList.remove('open'); });

  let searchTimeout = null;
  $('search-input').addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(applyFilters, 200);
  });

  $('from-date-filter').addEventListener('change', loadData);
  $('to-date-filter').addEventListener('change', loadData);
  bindTypeahead('customer-filter', 'customer-options', 'dms.api.reports.search_customers');
  bindTypeahead('customer-group-filter', 'customer-group-options', 'dms.api.customer_balance_report.search_customer_groups');

  $('reset-filters-btn').addEventListener('click', resetFilters);
  $('empty-reset-btn').addEventListener('click', resetFilters);
  $('refresh-btn').addEventListener('click', loadData);
  $('retry-btn').addEventListener('click', loadData);
  $('export-xlsx-btn').addEventListener('click', () => exportReport('xlsx'));
  $('export-pdf-btn').addEventListener('click', () => exportReport('pdf'));

  document.querySelectorAll('.page-size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.page-size-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      pageSize = Number(btn.dataset.size);
      currentPage = 1;
      renderTable();
    });
  });

  $('load-more-btn').addEventListener('click', () => {
    currentPage += 1;
    renderTable();
  });

  defaultDates();
  loadData();
});
