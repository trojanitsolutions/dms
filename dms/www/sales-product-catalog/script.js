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
    <div class="product-card">
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
  $('showing-text').textContent = `Showing ${slice.length} of ${items.length} products`;
  $('load-more-btn').style.display = shownCount < items.length ? 'inline-flex' : 'none';
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

// Build the PDF on the server. On phones, open the share sheet; elsewhere, download it.
async function exportPdf() {
  const btn = $('export-btn');
  const label = $('export-label');
  btn.disabled = true;
  label.textContent = 'Preparing PDF…';
  try {
    const p = new URLSearchParams(getFilters());
    const r = await fetch(`/api/method/${API}.export_catalog_pdf?${p}`, {
      headers: { 'X-Frappe-CSRF-Token': csrf() }
    });
    if (!r.ok || !(r.headers.get('Content-Type') || '').includes('pdf')) throw new Error(`HTTP ${r.status}`);
    const blob = await r.blob();
    const fileName = 'Product Catalog.pdf';
    const file = new File([blob], fileName, { type: 'application/pdf' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Product Catalog' });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return; // user closed the share sheet
      }
    }
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (err) {
    console.error(err);
    alert('Could not create the catalog PDF. Please try again.');
  } finally {
    btn.disabled = false;
    label.textContent = 'Export PDF';
  }
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
  $('export-btn').addEventListener('click', exportPdf);
  $('load-more-btn').addEventListener('click', () => {
    shownCount += PAGE_STEP;
    renderGrid();
  });

  loadItemGroups();
  loadData();
});
