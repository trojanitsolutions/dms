function csrf(){const m=document.cookie.match(/X-Frappe-CSRF-Token=([^;]+)/);return m?decodeURIComponent(m[1]):'fetch'}

const API = 'dms.api.customer_balance_report';

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
  return `${cur || 'QAR'} ` + Number(n || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function $(id) { return document.getElementById(id); }

// App State
let allRows = [];
let filteredRows = [];
let pageSize = 20;
let currentPage = 1;
const selected = new Set();

// Filters sent to the report. Customer search is client-side.
function getServerFilters() {
  const filters = {};
  const company = $('company-filter').value;
  const asOnDate = $('as-on-date-filter').value;
  const customer = $('customer-filter').value.trim();
  const customerGroup = $('customer-group-filter').value.trim();
  if (company) filters.company = company;
  if (asOnDate) filters.as_on_date = asOnDate;
  if (customer) filters.customer = customer;
  if (customerGroup) filters.customer_group = customerGroup;
  if ($('zero-balance-check').checked) filters.show_zero_balance = 1;
  return filters;
}

async function loadData() {
  setLoadingState(true);
  hideEmptyAndError();
  selected.clear();

  try {
    const res = await get(`${API}.get_customer_balance`, { filters: JSON.stringify(getServerFilters()) });
    if (!res || !res.data) {
      showError();
      return;
    }
    allRows = res.data;
    applyFilters();
  } catch (err) {
    console.error(err);
    showError();
  }
}

function applyFilters() {
  const search = ($('search-input').value || '').trim().toLowerCase();
  filteredRows = search
    ? allRows.filter(r =>
        (r.customer || '').toLowerCase().includes(search) ||
        (r.customer_name || '').toLowerCase().includes(search))
    : allRows;

  updateKPICards();
  currentPage = 1;
  renderTable();
}

// KPIs follow the rows currently listed (server filters + search).
function updateKPICards() {
  const total = filteredRows.reduce((acc, r) => acc + Number(r.outstanding_balance || 0), 0);
  const cur = allRows.length ? allRows[0].currency : '';
  $('kpi-balance').textContent = fmt(total, cur);
  $('kpi-customers').textContent = filteredRows.length;
  document.querySelectorAll('.kpi-card').forEach(c => c.classList.remove('loading'));
}

function balanceClass(value) {
  const n = Number(value || 0);
  if (n > 0) return 'text-error';
  if (n < 0) return 'text-success';
  return 'text-muted';
}

function renderTable() {
  const tbody = $('table-body');
  const loadMoreBtn = $('load-more-btn');

  if (!filteredRows.length) {
    tbody.innerHTML = '';
    $('empty-state').hidden = false;
    $('empty-state-msg').textContent = allRows.length
      ? 'No customers match your search.'
      : 'No customer balances match your selected filters.';
    $('showing-text').textContent = 'Showing 0 customers';
    $('table-foot').hidden = true;
    loadMoreBtn.style.display = 'none';
    updateSelectionUI([]);
    return;
  }

  $('empty-state').hidden = true;
  const total = filteredRows.length;
  const countToShow = pageSize === 0 ? total : Math.min(currentPage * pageSize, total);
  const rowsSlice = filteredRows.slice(0, countToShow);

  $('showing-text').textContent = `Showing ${rowsSlice.length} of ${total} customers`;
  loadMoreBtn.style.display = (pageSize !== 0 && countToShow < total) ? 'inline-flex' : 'none';

  tbody.innerHTML = rowsSlice.map((r, i) => `
    <tr>
      <td class="col-check"><input type="checkbox" class="row-check" data-customer="${esc(r.customer)}" ${selected.has(r.customer) ? 'checked' : ''}></td>
      <td class="col-num">${i + 1}</td>
      <td class="font-medium"><a class="inv-link" href="${invoiceBalanceUrl(r.customer)}" title="Open this customer's invoices">${esc(r.customer)}</a></td>
      <td>${esc(r.customer_name || r.customer)}</td>
      <td class="text-right font-medium ${balanceClass(r.outstanding_balance)}">${fmt(r.outstanding_balance, r.currency)}</td>
    </tr>
  `).join('');
  renderTotalRow(rowsSlice);

  tbody.querySelectorAll('.row-check').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) selected.add(cb.dataset.customer);
      else selected.delete(cb.dataset.customer);
      updateSelectionUI(rowsSlice);
    });
  });
  updateSelectionUI(rowsSlice);
}

// Link to the Customer Invoice Balance page, for one customer or for the current filters.
function invoiceBalanceUrl(customer) {
  const params = new URLSearchParams();
  const group = $('customer-group-filter').value.trim();
  if (customer) params.set('customer', customer);
  else if ($('customer-filter').value.trim()) params.set('customer', $('customer-filter').value.trim());
  if (group && !customer) params.set('customer_group', group);
  const query = params.toString();
  return `/sales-customer-invoice-balance${query ? `?${query}` : ''}`;
}

// Total of the rows shown in the table, like the total row in the desk report.
function renderTotalRow(rowsShown) {
  const total = rowsShown.reduce((acc, r) => acc + Number(r.outstanding_balance || 0), 0);
  const cell = $('table-total');
  cell.textContent = fmt(total, rowsShown[0].currency);
  cell.className = `text-right ${balanceClass(total)}`;
  $('table-foot').hidden = false;
}

function updateSelectionUI(rowsShown) {
  const selectAll = $('select-all');
  const checkedShown = rowsShown.filter(r => selected.has(r.customer)).length;
  selectAll.checked = rowsShown.length > 0 && checkedShown === rowsShown.length;
  selectAll.indeterminate = checkedShown > 0 && checkedShown < rowsShown.length;
  $('export-label').textContent = selected.size ? `Export Selected (${selected.size})` : 'Export Excel';
}

function toggleSelectAll() {
  const checked = $('select-all').checked;
  document.querySelectorAll('.row-check').forEach(cb => {
    cb.checked = checked;
    if (checked) selected.add(cb.dataset.customer);
    else selected.delete(cb.dataset.customer);
  });
  const shown = filteredRows.slice(0, document.querySelectorAll('.row-check').length);
  updateSelectionUI(shown);
}

function setLoadingState(loading) {
  if (!loading) return;
  $('table-body').innerHTML = `<tr><td colspan="5" class="text-center py-8 text-muted">Loading customer balances…</td></tr>`;
  document.querySelectorAll('.kpi-card').forEach(c => c.classList.add('loading'));
}

function hideEmptyAndError() {
  $('empty-state').hidden = true;
  $('error-state').hidden = true;
}

function showError() {
  $('error-state').hidden = false;
  $('table-body').innerHTML = '';
}

function resetFilters() {
  $('search-input').value = '';
  $('as-on-date-filter').value = '';
  $('customer-filter').value = '';
  $('customer-group-filter').value = '';
  $('zero-balance-check').checked = false;
  loadData();
}

// Export the checked rows. With none checked, export every row currently listed.
function exportExcel() {
  const filters = getServerFilters();
  if (selected.size) {
    filters.selected = [...selected];
  } else if (filteredRows.length !== allRows.length) {
    if (!filteredRows.length) return;
    filters.selected = filteredRows.map(r => r.customer);
  }
  const url = `/api/method/${API}.export_customer_balance?filters=${encodeURIComponent(JSON.stringify(filters))}`;
  window.open(url, '_blank');
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

  $('as-on-date-filter').addEventListener('change', loadData);
  $('zero-balance-check').addEventListener('change', loadData);
  bindTypeahead('customer-filter', 'customer-options', 'dms.api.reports.search_customers');
  bindTypeahead('customer-group-filter', 'customer-group-options', `${API}.search_customer_groups`);

  $('select-all').addEventListener('change', toggleSelectAll);
  $('reset-filters-btn').addEventListener('click', resetFilters);
  $('empty-reset-btn').addEventListener('click', resetFilters);
  $('refresh-btn').addEventListener('click', loadData);
  $('retry-btn').addEventListener('click', loadData);
  $('export-btn').addEventListener('click', exportExcel);
  // Carry the customer filters over when opening the invoice page.
  $('invoice-balance-btn').addEventListener('click', e => {
    e.preventDefault();
    window.location.href = invoiceBalanceUrl();
  });

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
