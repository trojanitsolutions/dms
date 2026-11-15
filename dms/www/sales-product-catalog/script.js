function csrf(){const m=document.cookie.match(/X-Frappe-CSRF-Token=([^;]+)/);return m?decodeURIComponent(m[1]):'fetch'}

const API = 'dms.api.product_catalog';
const PAGE_STEP = 24;

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
let items = [];
let shownCount = PAGE_STEP;
let loadSeq = 0;
// Selected item codes. Kept across filter changes, so a rep can search and pick items one by one.
const selected = new Set();

function getFilters() {
  return {
    search: $('search-input').value.trim(),
    item_group: $('item-group-filter').value,
    include_price: $('include-price-check').checked ? 1 : 0,
  };
}

async function loadData() {
  const seq = ++loadSeq;
  $('empty-state').hidden = true;
  $('error-state').hidden = true;
  $('catalog-grid').innerHTML = '';
  $('showing-text').textContent = 'Loading products…';
  $('load-more-btn').style.display = 'none';

  const filters = getFilters();
  const res = await get(`${API}.get_catalog`, filters).catch(() => null);
  if (seq !== loadSeq) return; // a newer request replaced this one
  if (!res || !res.items) {
    $('showing-text').textContent = '';
    $('error-state').hidden = false;
    return;
  }
  items = res.items;
  shownCount = PAGE_STEP;
  $('price-list-text').textContent = res.price_list ? `Price List: ${res.price_list}` : '';
  renderGrid();
}

function renderGrid() {
  const grid = $('catalog-grid');
  if (!items.length) {
    grid.innerHTML = '';
    $('showing-text').textContent = 'Showing 0 products';
    $('empty-state').hidden = false;
    $('load-more-btn').style.display = 'none';
    return;
  }
  const slice = items.slice(0, shownCount);
  grid.innerHTML = slice.map(it => `
    <div class="product-card${selected.has(it.item_code) ? ' selected' : ''}" data-code="${esc(it.item_code)}">
      <input type="checkbox" class="card-check" tabindex="-1" aria-label="Select ${esc(it.item_name)}"${selected.has(it.item_code) ? ' checked' : ''}>
      <div class="product-img">
        ${it.image
          ? `<img src="${esc(it.image)}" alt="${esc(it.item_name)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'no-img',textContent:'No image'}))">`
          : '<span class="no-img">No image</span>'}
      </div>
      <div class="product-body">
        <div class="product-name">${esc(it.item_name)}</div>
        <div class="product-code">${esc(it.item_code)}</div>
        ${it.stock_uom ? `<div class="product-uom">Unit: ${esc(it.stock_uom)}</div>` : ''}
        ${it.price != null ? `<div class="product-price">${fmt(it.price, it.currency)}</div>` : ''}
      </div>
    </div>
  `).join('');
  updateShowingText();
  $('load-more-btn').style.display = shownCount < items.length ? 'inline-flex' : 'none';
}

function updateShowingText() {
  const shown = Math.min(shownCount, items.length);
  const suffix = selected.size ? ` · ${selected.size} selected` : '';
  $('showing-text').textContent = items.length
    ? `Showing ${shown} of ${items.length} products${suffix}`
    : `Showing 0 products${suffix}`;
}

// ---- Selection ----
function defaultExportLabel() {
  return selected.size ? `Export Selected (${selected.size})` : 'Export PDF';
}

function updateSelectionUI() {
  $('clear-selection-btn').hidden = !selected.size;
  updateShowingText();
  if (readyFile) clearReadyExport();
  else if (!$('export-btn').disabled) setExportButton(defaultExportLabel(), false);
}

function onGridClick(e) {
  const card = e.target.closest('.product-card');
  if (!card) return;
  const code = card.dataset.code;
  const on = !selected.has(code);
  if (on) selected.add(code);
  else selected.delete(code);
  card.classList.toggle('selected', on);
  card.querySelector('.card-check').checked = on;
  updateSelectionUI();
}

function selectAll() {
  items.forEach(it => selected.add(it.item_code));
  renderGrid();
  updateSelectionUI();
}

function clearSelection() {
  selected.clear();
  renderGrid();
  updateSelectionUI();
}

async function loadItemGroups() {
  const groups = await get(`${API}.get_item_groups`).catch(() => null) || [];
  $('item-group-filter').insertAdjacentHTML('beforeend',
    groups.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join(''));
}

function resetFilters() {
  $('search-input').value = '';
  $('item-group-filter').value = '';
  $('include-price-check').checked = false;
  loadData();
}

// ---- PDF export ----
// The server builds the PDF in a background job (a full catalog is ~180 pages), so we
// start it, poll its status, then download it. On phones the share sheet needs a fresh tap,
// so a finished PDF turns the button into "Share PDF".
const POLL_MS = 3000;
let pollTimer = null;
let readyFile = null;

function setExportButton(text, busy) {
  $('export-btn').disabled = !!busy;
  $('export-label').textContent = text;
}

function canShareFiles() {
  try {
    const probe = new File([new Blob(['x'])], 'x.pdf', { type: 'application/pdf' });
    return !!(navigator.canShare && navigator.canShare({ files: [probe] }));
  } catch (e) {
    return false;
  }
}

async function post(method, args = {}) {
  const r = await fetch(`/api/method/${method}`, {
    method: 'POST',
    headers: { 'X-Frappe-CSRF-Token': csrf(), 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(args),
  });
  if (!r.ok) return null;
  return (await r.json()).message;
}

async function onExportClick() {
  if (readyFile) {
    await shareFile(readyFile);
    return;
  }
  setExportButton('Preparing PDF…', true);
  const args = getFilters();
  if (selected.size) args.item_codes = JSON.stringify([...selected]);
  const status = await post(`${API}.start_catalog_export`, args).catch(() => null);
  if (!status) {
    exportFailed();
    return;
  }
  pollExport();
}

function pollExport() {
  clearTimeout(pollTimer);
  setExportButton('Preparing PDF…', true);
  pollTimer = setTimeout(async () => {
    const status = await get(`${API}.get_catalog_export_status`).catch(() => null);
    const state = status && status.status;
    if (state === 'queued' || state === 'running') {
      pollExport();
    } else if (state === 'done') {
      await fetchExport();
    } else {
      exportFailed();
    }
  }, POLL_MS);
}

async function fetchExport() {
  setExportButton('Downloading…', true);
  try {
    const r = await fetch(`/api/method/${API}.download_catalog_export`, {
      headers: { 'X-Frappe-CSRF-Token': csrf() }
    });
    if (!r.ok || !(r.headers.get('Content-Type') || '').includes('pdf')) throw new Error(`HTTP ${r.status}`);
    const file = new File([await r.blob()], 'Product Catalog.pdf', { type: 'application/pdf' });
    if (canShareFiles()) {
      readyFile = file;
      setExportButton('Share PDF', false);
    } else {
      downloadFile(file);
      setExportButton(defaultExportLabel(), false);
    }
  } catch (err) {
    console.error(err);
    exportFailed();
  }
}

async function shareFile(file) {
  try {
    await navigator.share({ files: [file], title: 'Product Catalog' });
  } catch (err) {
    if (err.name === 'AbortError') return; // closed the share sheet: keep "Share PDF"
    downloadFile(file);
  }
  readyFile = null;
  setExportButton(defaultExportLabel(), false);
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function exportFailed() {
  setExportButton(defaultExportLabel(), false);
  alert('Could not create the catalog PDF. Please try again.');
}

// Filters changed after a PDF was made: the next tap builds a new one.
function clearReadyExport() {
  if (!readyFile) return;
  readyFile = null;
  setExportButton(defaultExportLabel(), false);
}

// Resume an export that was still running when the page was left or reloaded.
async function resumeExport() {
  const status = await get(`${API}.get_catalog_export_status`).catch(() => null);
  if (status && (status.status === 'queued' || status.status === 'running')) pollExport();
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
    searchTimeout = setTimeout(loadData, 350);
  });
  $('item-group-filter').addEventListener('change', loadData);
  $('include-price-check').addEventListener('change', loadData);

  $('reset-filters-btn').addEventListener('click', resetFilters);
  $('empty-reset-btn').addEventListener('click', resetFilters);
  $('refresh-btn').addEventListener('click', loadData);
  $('retry-btn').addEventListener('click', loadData);
  $('export-btn').addEventListener('click', onExportClick);
  $('catalog-grid').addEventListener('click', onGridClick);
  $('select-all-btn').addEventListener('click', selectAll);
  $('clear-selection-btn').addEventListener('click', clearSelection);
  $('load-more-btn').addEventListener('click', () => {
    shownCount += PAGE_STEP;
    renderGrid();
  });

  ['search-input', 'item-group-filter', 'include-price-check'].forEach(id =>
    $(id).addEventListener(id === 'search-input' ? 'input' : 'change', clearReadyExport));

  loadItemGroups();
  loadData();
  resumeExport();
});
