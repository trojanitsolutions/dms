function csrf(){const m=document.cookie.match(/X-Frappe-CSRF-Token=([^;]+)/);return m?decodeURIComponent(m[1]):'fetch'}

const API = 'dms.api.customer_invoice_balance_report';

// Returns {ok, message, error}. `error` is the server's own message when it sends one.
async function call(method, args = {}) {
  const r = await fetch(`/api/method/${method}?${new URLSearchParams(args)}`, {
    headers: { 'X-Frappe-CSRF-Token': csrf(), 'Accept': 'application/json' }
  });
  const json = await r.json().catch(() => ({}));
  if (r.ok) return { ok: true, message: json.message };
  return { ok: false, error: serverError(json) };
}

function serverError(json) {
  let error = '';
  try {
    error = JSON.parse(json._server_messages || '[]').map(m => JSON.parse(m).message).join(' ');
  } catch (e) { /* keep generic text */ }
  const tmp = document.createElement('div');
  tmp.innerHTML = error;
  return tmp.textContent.trim();
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

function displayDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// App State
let columns = [];
let allRows = [];
let filteredRows = [];
let summary = [];
let currency = 'QAR';
let pageSize = 20;
let currentPage = 1;
let loadSeq = 0;
const selected = new Set();

function getServerFilters() {
  const filters = {};
  const values = {
    company: $('company-filter').value,
    customer: $('customer-filter').value.trim(),
    customer_address: $('customer-address-filter').value.trim(),
    customer_group: $('customer-group-filter').value.trim(),
    from_date: $('from-date-filter').value,
    to_date: $('to-date-filter').value,
  };
  Object.entries(values).forEach(([key, value]) => { if (value) filters[key] = value; });
  if ($('paid-check').checked) filters.show_paid_invoices = 1;
  return filters;
}

async function loadData() {
  const seq = ++loadSeq;
  setLoadingState();
  hideEmptyAndError();
  selected.clear();

  try {
    const res = await call(`${API}.get_customer_invoice_balance`, { filters: JSON.stringify(getServerFilters()) });
    if (seq !== loadSeq) return; // a newer request has started
    if (!res.ok || !res.message) {
      showError(res.error);
      return;
    }
    columns = res.message.columns || [];
    allRows = res.message.data || [];
    summary = res.message.report_summary || [];
    currency = (allRows[0] && allRows[0].currency) || 'QAR';
    applyFilters();
  } catch (err) {
    console.error(err);
    if (seq === loadSeq) showError();
  }
}

function applyFilters() {
  const search = ($('search-input').value || '').trim().toLowerCase();
  filteredRows = search
    ? allRows.filter(r => ['invoice', 'customer', 'customer_name'].some(
        f => String(r[f] || '').toLowerCase().includes(search)))
    : allRows;

  renderKPICards();
  currentPage = 1;
  renderTable();
}

function sum(rows, field) {
  return rows.reduce((acc, r) => acc + Number(r[field] || 0), 0);
}

// The customer cards come from the report. Money and counts follow the rows listed (filters + search).
function renderKPICards() {
  const cards = summary
    .filter(c => c.datatype === 'Data')
    .map(c => ({ label: c.label, value: esc(c.value), small: true }));
  cards.push(
    { label: 'Total Invoice Amount', value: fmt(sum(filteredRows, 'invoice_amount'), currency) },
    { label: 'Total Outstanding', value: fmt(sum(filteredRows, 'outstanding_amount'), currency), cls: 'text-error' },
    { label: 'Invoices', value: filteredRows.length },
  );
  if (!$('customer-filter').value.trim()) {
    cards.push({ label: 'Customers', value: new Set(filteredRows.map(r => r.customer)).size });
  }
  $('kpi-summary').innerHTML = cards.map(c => `
    <div class="kpi-card">
      <div class="kpi-label">${esc(c.label)}</div>
      <div class="kpi-value${c.small ? ' kpi-text' : ''} ${c.cls || ''}">${c.value}</div>
    </div>`).join('');
}

const isMoney = col => col.fieldtype === 'Currency';
const isNumber = col => isMoney(col) || col.fieldtype === 'Int';

function cellHtml(row, col) {
  const value = row[col.fieldname];
  if (col.fieldname === 'invoice') {
    return `<td class="sticky font-medium"><a class="inv-link" href="/sales-invoice?invoice=${encodeURIComponent(value)}" title="Open invoice">${esc(value)}</a></td>`;
  }
  if (isMoney(col)) {
    const cls = col.fieldname === 'outstanding_amount' && Number(value) > 0 ? ' font-medium text-error' : '';
    return `<td class="num${cls}">${fmt(value, row.currency || currency)}</td>`;
  }
  if (col.fieldname === 'overdue_days') {
    return `<td class="num${Number(value) > 0 ? ' text-warning font-medium' : ''}">${esc(value || 0)}</td>`;
  }
  if (col.fieldname === 'status') {
    return `<td><span class="status-pill status-${esc(String(value || '').toLowerCase().replace(/\s+/g, '-'))}">${esc(value)}</span></td>`;
  }
  if (col.fieldtype === 'Date') return `<td>${esc(displayDate(value))}</td>`;
  const wrap = col.fieldname === 'customer_name' ? ' wrap' : '';
  return `<td class="${isNumber(col) ? 'num' : ''}${wrap}">${esc(value == null ? '' : value)}</td>`;
}

// Sl No is shown in its own column from the report, so the checkbox column comes first.
function renderHead() {
  $('table-head').innerHTML = `<tr>
    <th class="col-check"><input type="checkbox" id="select-all" title="Select all shown rows"></th>
    ${columns.map(c => `<th class="${isNumber(c) ? 'num' : ''}${c.fieldname === 'invoice' ? ' sticky' : ''}">${esc(c.label)}</th>`).join('')}
  </tr>`;
  $('select-all').addEventListener('change', toggleSelectAll);
}

function renderTable() {
  const tbody = $('table-body');
  const loadMoreBtn = $('load-more-btn');
  renderHead();

  if (!filteredRows.length) {
    tbody.innerHTML = '';
    $('table-container').hidden = true;
    $('empty-state').hidden = false;
    $('empty-state-msg').textContent = allRows.length
      ? 'No invoices match your search.'
      : 'No invoices with a balance match your selected filters.';
    $('table-foot').hidden = true;
    updateSelectionUI([]);
    return;
  }

  $('table-container').hidden = false;
  $('empty-state').hidden = true;
  const total = filteredRows.length;
  const countToShow = pageSize === 0 ? total : Math.min(currentPage * pageSize, total);
  const rowsSlice = filteredRows.slice(0, countToShow);

  $('showing-text').textContent = `Showing ${rowsSlice.length} of ${total} invoices`;
  loadMoreBtn.style.display = (pageSize !== 0 && countToShow < total) ? 'inline-flex' : 'none';

  tbody.innerHTML = rowsSlice.map(r => `
    <tr>
      <td class="col-check"><input type="checkbox" class="row-check" data-invoice="${esc(r.invoice)}" ${selected.has(r.invoice) ? 'checked' : ''}></td>
      ${columns.map(c => cellHtml(r, c)).join('')}
    </tr>`).join('');
  renderTotalRow();

  tbody.querySelectorAll('.row-check').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) selected.add(cb.dataset.invoice);
      else selected.delete(cb.dataset.invoice);
      updateSelectionUI(rowsSlice);
    });
  });
  updateSelectionUI(rowsSlice);
}

// Totals cover every listed row (all pages), like the exported file.
function renderTotalRow() {
  const cells = columns.map(c => {
    if (isMoney(c)) {
      const t = sum(filteredRows, c.fieldname);
      const cls = c.fieldname === 'outstanding_amount' && t > 0 ? ' text-error' : '';
      return `<td class="num font-medium${cls}">${fmt(t, currency)}</td>`;
    }
    return c.fieldname === 'invoice' ? '<td class="sticky font-medium">Total</td>' : '<td></td>';
  }).join('');
  $('table-foot').innerHTML = `<tr class="total-row"><td class="col-check"></td>${cells}</tr>`;
  $('table-foot').hidden = false;
}

function updateSelectionUI(rowsShown) {
  const selectAll = $('select-all');
  const checkedShown = rowsShown.filter(r => selected.has(r.invoice)).length;
  selectAll.checked = rowsShown.length > 0 && checkedShown === rowsShown.length;
  selectAll.indeterminate = checkedShown > 0 && checkedShown < rowsShown.length;
  $('export-label').textContent = selected.size ? `Export Selected (${selected.size})` : 'Export Excel';
  $('export-pdf-label').textContent = selected.size ? `PDF Selected (${selected.size})` : 'Export PDF';
}

function toggleSelectAll() {
  const checked = $('select-all').checked;
  document.querySelectorAll('.row-check').forEach(cb => {
    cb.checked = checked;
    if (checked) selected.add(cb.dataset.invoice);
    else selected.delete(cb.dataset.invoice);
  });
  updateSelectionUI(filteredRows.slice(0, document.querySelectorAll('.row-check').length));
}

function setLoadingState() {
  $('table-container').hidden = false;
  $('table-head').innerHTML = '';
  $('table-foot').hidden = true;
  $('table-body').innerHTML = `<tr><td class="text-center py-8 text-muted">Loading invoices…</td></tr>`;
  $('load-more-btn').style.display = 'none';
  $('showing-text').textContent = '';
  document.querySelectorAll('.kpi-card').forEach(c => c.classList.add('loading'));
}

function hideEmptyAndError() {
  $('empty-state').hidden = true;
  $('error-state').hidden = true;
}

function showError(message) {
  $('error-msg').textContent = message || 'Something went wrong while fetching the Customer Invoice Balance report.';
  $('error-state').hidden = false;
  $('table-container').hidden = true;
}

function resetFilters() {
  ['search-input', 'customer-filter', 'customer-address-filter', 'customer-group-filter', 'from-date-filter', 'to-date-filter']
    .forEach(id => { $(id).value = ''; });
  $('paid-check').checked = false;
  history.replaceState(null, '', location.pathname);
  loadData();
}

// Export (Excel or PDF) the checked rows. With none checked, export every row currently listed.
// The file is fetched here (not opened in a tab) so a server error shows on this page.
async function exportReport(fileFormat) {
  const filters = getServerFilters();
  if (selected.size) {
    filters.selected = [...selected];
  } else if (filteredRows.length !== allRows.length) {
    if (!filteredRows.length) return;
    filters.selected = filteredRows.map(r => r.invoice);
  }
  const btn = $(fileFormat === 'pdf' ? 'export-pdf-btn' : 'export-btn');
  const label = $(fileFormat === 'pdf' ? 'export-pdf-label' : 'export-label');
  const original = label.textContent;
  const errorBox = $('export-error');
  errorBox.hidden = true;
  btn.disabled = true;
  label.textContent = 'Preparing…';
  try {
    const file = (fileFormat === 'pdf' && await printFormatPdf(filters)) || await serverExport(filters, fileFormat);
    download(file.blob, file.name);
  } catch (e) {
    errorBox.textContent = e.message || 'Export failed. Please try again.';
    errorBox.hidden = false;
  } finally {
    label.textContent = original;
    btn.disabled = false;
  }
}

// Read a file response. A JSON response is a server error, even with status 200.
async function fileResponse(r, fallbackName) {
  const type = r.headers.get('Content-Type') || '';
  if (!r.ok || type.includes('application/json')) {
    const json = await r.json().catch(() => ({}));
    throw new Error(serverError(json) || 'Export failed. Please try again.');
  }
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(r.headers.get('Content-Disposition') || '');
  return { blob: await r.blob(), name: match ? decodeURIComponent(match[1]) : fallbackName };
}

// Excel, or the plain table PDF, built by the server.
async function serverExport(filters, fileFormat) {
  const args = new URLSearchParams({ filters: JSON.stringify(filters), file_format: fileFormat });
  const r = await fetch(`/api/method/${API}.export_customer_invoice_balance?${args}`, {
    headers: { 'X-Frappe-CSRF-Token': csrf() }
  });
  return fileResponse(r, `Customer Invoice Balance Report.${fileFormat}`);
}

// PDF in the print format set for this report in Sales Management Settings (e.g. "CIB Standard").
// The format is a Desk JS template, so it is rendered here and the server turns the HTML into a PDF,
// the same way Desk's report "PDF" works. Returns null when no format is set.
async function printFormatPdf(filters) {
  const res = await call(`${API}.get_print_data`, { filters: JSON.stringify(filters) });
  if (!res.ok) throw new Error(res.error || 'Could not load the print format.');
  const pf = res.message;
  if (!pf || !pf.print_format) return null;

  const html = window.DmsReportPrint.render({
    title: 'Customer Invoice Balance',
    html: pf.html,
    css: pf.css,
    currency: pf.statement_details && pf.statement_details.currency,
    context: { data: pf.data, filters, report: { statement_details: pf.statement_details } },
  });
  const body = new URLSearchParams({
    html,
    orientation: /landscape/i.test(pf.css || '') ? 'Landscape' : 'Portrait',
  });
  const r = await fetch('/api/method/frappe.utils.print_format.report_to_pdf', {
    method: 'POST',
    headers: { 'X-Frappe-CSRF-Token': csrf(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const file = await fileResponse(r, '');
  const customer = (pf.statement_details.customer || {}).id;
  file.name = `${pf.print_format}${customer ? ` - ${customer}` : ''}.pdf`;
  return file;
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Search dropdown under a filter input, like a Desk Link field: it opens on click,
// narrows as the user types, and shows the name with the ID under it.
// `extraArgs` returns more search args, for example the picked customer.
function bindTypeahead(inputId, listId, method, extraArgs = () => ({})) {
  const input = $(inputId);
  const list = $(listId);
  let timer = null;
  let requestId = 0;
  let options = [];
  let active = -1;
  let committed = '';

  function close() {
    list.hidden = true;
    active = -1;
  }

  function render() {
    if (!options.length) {
      list.innerHTML = '<div class="ta-empty">No results</div>';
    } else {
      list.innerHTML = options.map((o, i) => {
        const sub = o.label !== o.value ? o.value : (o.description || '');
        return `<div class="ta-item${i === active ? ' active' : ''}" role="option" data-index="${i}">
          <div class="ta-label">${esc(o.label || o.value)}</div>
          ${sub ? `<div class="ta-sub">${esc(sub)}</div>` : ''}
        </div>`;
      }).join('');
    }
    list.hidden = false;
  }

  async function load() {
    const id = ++requestId;
    const result = await get(method, { txt: input.value, ...extraArgs() }) || [];
    // Skip answers that came back after a newer search, or after the input lost focus.
    if (id !== requestId || document.activeElement !== input) return;
    options = result;
    active = -1;
    render();
  }

  // Reload the report only when the value really changed.
  function commit() {
    if (input.value === committed) return;
    committed = input.value;
    input.dispatchEvent(new Event('change'));
  }

  function pick(index) {
    input.value = options[index].value;
    close();
    commit();
  }

  // Remember the value at focus, so blur reloads only when it changed.
  input.addEventListener('focus', () => { committed = input.value; load(); });
  input.addEventListener('click', () => { if (list.hidden) load(); });
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(load, 250);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (list.hidden || !options.length) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      render();
      list.querySelector('.ta-item.active')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!list.hidden && active >= 0) pick(active);
      else { close(); commit(); }
    } else if (e.key === 'Escape') {
      close();
    }
  });
  input.addEventListener('blur', () => {
    requestId++;
    close();
    commit();
  });
  // `mousedown` runs before the input's blur, so the pick is not lost.
  list.addEventListener('mousedown', e => {
    e.preventDefault();
    const item = e.target.closest('.ta-item');
    if (item) pick(Number(item.dataset.index));
  });

  // The native `change` from blur is replaced by commit(); only the dispatched one reloads.
  input.addEventListener('change', e => {
    if (e.isTrusted) { e.stopImmediatePropagation(); return; }
    loadData();
  });
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

  // The Customer Balance page links here with `?customer=...` (and the filters it had set).
  const params = new URLSearchParams(location.search);
  if (params.get('customer')) $('customer-filter').value = params.get('customer');
  if (params.get('customer_group')) $('customer-group-filter').value = params.get('customer_group');

  let searchTimeout = null;
  $('search-input').addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(applyFilters, 200);
  });

  $('from-date-filter').addEventListener('change', loadData);
  $('to-date-filter').addEventListener('change', loadData);
  $('paid-check').addEventListener('change', loadData);
  // An address picked for another customer no longer applies. Runs before the reload below.
  $('customer-filter').addEventListener('change', () => {
    $('customer-address-filter').value = '';
    $('customer-address-options').innerHTML = '';
  });
  bindTypeahead('customer-filter', 'customer-options', 'dms.api.reports.search_customers');
  bindTypeahead('customer-address-filter', 'customer-address-options', 'dms.api.reports.search_customer_addresses',
    () => ({ customer: $('customer-filter').value.trim() }));
  bindTypeahead('customer-group-filter', 'customer-group-options', 'dms.api.customer_balance_report.search_customer_groups');

  $('reset-filters-btn').addEventListener('click', resetFilters);
  $('empty-reset-btn').addEventListener('click', resetFilters);
  $('refresh-btn').addEventListener('click', loadData);
  $('retry-btn').addEventListener('click', loadData);
  $('export-btn').addEventListener('click', () => exportReport('xlsx'));
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

  loadData();
});
