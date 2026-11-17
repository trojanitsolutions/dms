/*
 * Sales portal — Sales Return popup (shared by /sales-home and /sales-invoice).
 *
 *   SalesReturn.pick({onDone})          search a submitted invoice, then return items
 *   SalesReturn.open(invoice, {onDone}) return items of a known invoice
 *
 * The return is saved as a draft credit note by dms.api.sales_invoice.create_sales_return;
 * the server decides which invoices the user may return. onDone(name) runs after a save.
 */
(function () {
  const API = 'dms.api.sales_invoice.';
  const SEARCH_DELAY = 300;
  const ret = { invoice: null, items: [], busy: false, onDone: null, fromPicker: false, data: null, confirmReturns: false };
  let modal, searchTimer, searchSeq = 0, toastTimer;

  /* ── HTTP ─────────────────────────────────────────────── */
  function csrf() {
    const m = document.cookie.match(/X-Frappe-CSRF-Token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : (window.csrf_token || 'fetch');
  }

  async function call(method, args, post) {
    const params = new URLSearchParams(args);
    const headers = { 'X-Frappe-CSRF-Token': csrf(), Accept: 'application/json' };
    const r = post
      ? await fetch(`/api/method/${API}${method}`, {
          method: 'POST', body: params,
          headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
        })
      : await fetch(`/api/method/${API}${method}?${params}`, { headers });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(serverError(data));
    return data.message;
  }

  // Frappe puts user-facing errors in _server_messages (JSON list of JSON objects).
  function serverError(data) {
    try {
      const msgs = JSON.parse(data._server_messages || '[]')
        .map((m) => { try { return JSON.parse(m).message; } catch (e) { return m; } });
      if (msgs.length) return msgs.map(stripHtml).join(' ');
    } catch (e) { /* fall through */ }
    if (data.exception) return String(data.exception).split(':').slice(1).join(':').trim() || data.exception;
    return 'Something went wrong.';
  }

  /* ── Formatting ───────────────────────────────────────── */
  function stripHtml(html) { const d = document.createElement('div'); d.innerHTML = html; return d.textContent; }
  function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function fmt(n) {
    return 'QAR ' + Number(n || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtDate(s) {
    if (!s) return '';
    return new Date(String(s).replace(' ', 'T')).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function docTotal(d) { return d.disable_rounded_total || !d.rounded_total ? d.grand_total : d.rounded_total; }

  /* ── Modal shell ──────────────────────────────────────── */
  function ensureModal() {
    if (modal) return;
    modal = document.createElement('div');
    modal.className = 'ret-overlay modal-overlay';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="ret-box modal-box" role="dialog" aria-modal="true" aria-labelledby="ret-title">
        <div class="ret-head">
          <div>
            <button type="button" class="ret-back" data-back hidden>‹ Back</button>
            <div class="ret-title" id="ret-title">Sales Return</div>
            <div class="ret-sub" data-sub></div>
          </div>
          <button type="button" class="ret-close" data-close aria-label="Close">&times;</button>
        </div>
        <div class="ret-search-wrap" data-search-wrap hidden>
          <input type="search" class="ret-search" data-search placeholder="Search invoice no. or customer" autocomplete="off">
        </div>
        <div class="ret-body" data-body></div>
        <div class="ret-error" data-error hidden></div>
        <div class="ret-foot" data-foot>
          <div class="ret-total">Return Total <strong data-total>QAR 0.00</strong></div>
          <div class="ret-actions">
            <button type="button" class="ret-btn" data-close>Cancel</button>
            <button type="button" class="ret-btn ret-btn-primary" data-submit>Create Return</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const toast = document.createElement('div');
    toast.className = 'ret-toast';
    toast.hidden = true;
    toast.dataset.retToast = '';
    document.body.appendChild(toast);

    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.closest('[data-close]')) return close();
      if (e.target.closest('[data-back]')) return showPicker();
      const row = e.target.closest('[data-pick]');
      if (row) openItems(row.dataset.pick, true);
    });
    q('[data-body]').addEventListener('input', (e) => { if (e.target.matches('input[data-idx]')) updateTotal(); });
    q('[data-search]').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => searchInvoices(e.target.value.trim()), SEARCH_DELAY);
    });
    q('[data-submit]').addEventListener('click', submit);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) close(); });
  }

  function q(sel) { return modal.querySelector(sel); }
  function setText(sel, text) { q(sel).textContent = text; }
  function showError(msg) { const el = q('[data-error]'); el.textContent = msg; el.hidden = !msg; }
  function setSubmitEnabled(on) { q('[data-submit]').disabled = !on; }

  function close() {
    modal.hidden = true;
    ret.invoice = null;
    searchSeq++;
  }

  function toast(msg) {
    const el = document.querySelector('[data-ret-toast]');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
  }

  /* ── Step 1: pick an invoice ──────────────────────────── */
  function pick(opts = {}) {
    ensureModal();
    ret.onDone = opts.onDone || null;
    q('[data-search]').value = '';
    modal.hidden = false;
    showPicker();
    q('[data-search]').focus();
  }

  function showPicker() {
    ret.invoice = null;
    ret.fromPicker = true;
    setText('#ret-title', 'Sales Return');
    setText('[data-sub]', 'Choose the invoice to return.');
    q('[data-back]').hidden = true;
    q('[data-search-wrap]').hidden = false;
    q('[data-foot]').hidden = true;
    showError('');
    searchInvoices(q('[data-search]').value.trim());
  }

  async function searchInvoices(search) {
    const seq = ++searchSeq;
    const body = q('[data-body]');
    body.innerHTML = '<div class="ret-empty">Loading invoices…</div>';
    let res;
    try {
      res = await call('get_sales_invoices', { kind: 'invoices', submitted_only: 1, search, limit_page_length: 20 });
    } catch (e) {
      if (seq === searchSeq) { body.innerHTML = ''; showError(e.message); }
      return;
    }
    if (seq !== searchSeq || ret.invoice) return;
    showError('');
    const rows = res.invoices || [];
    body.innerHTML = rows.length
      ? rows.map(pickRow).join('')
      : `<div class="ret-empty">${search ? `No submitted invoices match "${esc(search)}".` : 'No submitted invoices to return.'}</div>`;
  }

  function pickRow(inv) {
    const tag = inv.has_returns ? '<span class="ret-pick-tag">Has returns</span>' : '';
    return `<button type="button" class="ret-pick-row" data-pick="${esc(inv.name)}">
      <span class="ret-pick-main">
        <span class="ret-item-code">${esc(inv.name)}</span>
        <span class="ret-item-name">${esc(inv.customer_name || inv.customer)} · ${fmtDate(inv.posting_date)}</span>
      </span>
      <span class="ret-pick-side">${tag}<span class="ret-line">${fmt(docTotal(inv))}</span></span>
    </button>`;
  }

  /* ── Step 2: items and quantities ─────────────────────── */
  function open(invoice, opts = {}) {
    ensureModal();
    ret.onDone = opts.onDone || null;
    ret.fromPicker = false;
    modal.hidden = false;
    openItems(invoice, false);
  }

  async function openItems(invoice, fromPicker) {
    Object.assign(ret, { invoice, items: [], busy: false, fromPicker, data: null, confirmReturns: false });
    searchSeq++;
    setText('#ret-title', `Return ${invoice}`);
    setText('[data-sub]', '');
    q('[data-back]').hidden = !fromPicker;
    q('[data-search-wrap]').hidden = true;
    q('[data-foot]').hidden = false;
    q('[data-body]').innerHTML = '<div class="ret-empty">Loading items…</div>';
    showError('');
    setSubmitEnabled(false);
    setSubmitLabel('Create Return');
    q('[data-submit]').hidden = false;
    q('.ret-total').hidden = false;
    setText('[data-total]', fmt(0));

    let data;
    try {
      data = await call('get_return_items', { invoice });
    } catch (e) {
      if (ret.invoice !== invoice) return;
      q('[data-body]').innerHTML = '';
      showError(e.message);
      return;
    }
    if (ret.invoice !== invoice) return;
    ret.data = data;
    setText('[data-sub]', data.customer || '');
    if ((data.returns || []).length) showExistingReturns(data);
    else if (!data.items.length) showNothingLeft(data);
    else renderItems(data);
  }

  function renderItems(data) {
    ret.confirmReturns = false;
    ret.items = data.items;
    setSubmitLabel('Create Return');
    q('.ret-total').hidden = false;
    q('[data-body]').innerHTML = data.items.map(itemRow).join('');
    updateTotal();
  }

  /* ── Step 1b: show returns already made against the invoice ── */
  function showExistingReturns(data) {
    const returns = data.returns;
    const n = returns.length;
    const canReturn = data.items.length > 0;
    const banner = canReturn
      ? `<div class="ret-warn">
          ${esc(data.invoice)} already has ${n === 1 ? 'a return' : `${n} returns`}.
          Items in ${n === 1 ? 'it' : 'them'} can't be returned again. Create another return?
        </div>`
      : `<div class="ret-info">Everything on ${esc(data.invoice)} has already been returned.</div>`;
    q('.ret-total').hidden = true;
    q('[data-body]').innerHTML = banner + returns.map(returnCard).join('');
    ret.confirmReturns = canReturn;
    q('[data-submit]').hidden = !canReturn;
    setSubmitLabel('Continue');
    setSubmitEnabled(canReturn);
  }

  // Safety case: nothing left and no return found (e.g. cancelled history).
  function showNothingLeft(data) {
    q('.ret-total').hidden = true;
    q('[data-submit]').hidden = true;
    q('[data-body]').innerHTML = `<div class="ret-info">Nothing left to return on ${esc(data.invoice)}.</div>`;
  }

  function returnCard(d) {
    const items = (d.items || []).map((it) => `
      <div class="ret-draft-item">
        <span><span class="ret-item-code">${esc(it.item_code)}</span>
          <span class="ret-item-name">${esc(it.item_name)}</span></span>
        <span class="ret-draft-qty">${esc(Math.abs(Number(it.qty) || 0))} ${esc(it.uom || '')}</span>
      </div>`).join('');
    const tag = d.docstatus === 1
      ? '<span class="ret-pick-tag ret-tag-submitted">Submitted</span>'
      : '<span class="ret-pick-tag">Draft</span>';
    return `<div class="ret-draft">
      <div class="ret-draft-head">
        <span><strong>${esc(d.name)}</strong> · ${fmtDate(d.posting_date)} ${tag}</span>
        <span class="ret-line">${fmt(Math.abs(docTotal(d)))}</span>
      </div>
      ${items}
    </div>`;
  }

  function setSubmitLabel(text) { q('[data-submit]').textContent = text; }

  function itemRow(it, i) {
    return `<div class="ret-row">
      <div>
        <div class="ret-item-code">${esc(it.item_code)}</div>
        <div class="ret-item-name">${esc(it.item_name)}</div>
      </div>
      <label class="ret-qty">
        <input type="number" inputmode="decimal" min="0" max="${it.returnable}" step="any" value="${it.returnable}"
          data-idx="${i}" aria-label="Return qty for ${esc(it.item_code)}">
      </label>
      <div class="ret-item-meta">${fmt(it.rate)} × up to ${esc(it.returnable)} ${esc(it.uom || '')}</div>
      <div class="ret-line" data-line="${i}"></div>
    </div>`;
  }

  function readQty(input) {
    const it = ret.items[input.dataset.idx];
    const qty = Number(input.value);
    return { it, qty: Number.isFinite(qty) ? qty : 0 };
  }

  function updateTotal() {
    let total = 0, any = false, invalid = false;
    modal.querySelectorAll('[data-body] input[data-idx]').forEach((input) => {
      const { it, qty } = readQty(input);
      const bad = qty < 0 || qty > it.returnable;
      input.setCustomValidity(bad ? `Between 0 and ${it.returnable}` : '');
      invalid = invalid || bad;
      const line = bad ? 0 : qty * it.rate;
      total += line;
      any = any || (qty > 0 && !bad);
      q(`[data-line="${input.dataset.idx}"]`).textContent = fmt(line);
    });
    setText('[data-total]', fmt(total));
    setSubmitEnabled(any && !invalid);
  }

  async function submit() {
    if (ret.busy || !ret.invoice) return;
    if (ret.confirmReturns) return renderItems(ret.data);
    const items = {};
    modal.querySelectorAll('[data-body] input[data-idx]').forEach((input) => {
      const { it, qty } = readQty(input);
      if (qty > 0) items[it.si_detail] = qty;
    });
    const btn = q('[data-submit]');
    ret.busy = true;
    setSubmitEnabled(false);
    btn.textContent = 'Creating…';
    showError('');
    try {
      const res = await call('create_sales_return', { invoice: ret.invoice, items: JSON.stringify(items) }, true);
      const onDone = ret.onDone;
      close();
      toast(`Return draft ${res.name} created`);
      if (onDone) onDone(res.name);
    } catch (e) {
      showError(e.message);
      setSubmitEnabled(true);
    } finally {
      ret.busy = false;
      btn.textContent = 'Create Return';
    }
  }

  window.SalesReturn = { open, pick };
})();
