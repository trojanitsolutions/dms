/*
 * Sales portal — glass calendar.
 * Upgrades every <input type="date"> to a flatpickr picker themed by
 * /sales-glass.css. The original input keeps its id and its YYYY-MM-DD value,
 * so page scripts that read/write .value, .min, .max or listen for "change"
 * keep working without changes. If flatpickr did not load, nothing happens
 * and the native date picker stays.
 */
(function () {
  const proto = HTMLInputElement.prototype;
  const native = {
    value: Object.getOwnPropertyDescriptor(proto, 'value'),
    min: Object.getOwnPropertyDescriptor(proto, 'min'),
    max: Object.getOwnPropertyDescriptor(proto, 'max'),
  };

  function init(root) {
    if (!window.flatpickr) return;
    (root || document).querySelectorAll('input[type="date"]').forEach(upgrade);
  }

  function upgrade(input) {
    if (input._flatpickr) return;
    const fp = window.flatpickr(input, {
      dateFormat: 'Y-m-d',
      altInput: true,
      altFormat: 'd M Y',
      altInputClass: (input.className + ' glass-date').trim(),
      disableMobile: true,
      defaultDate: input.value || null,
      minDate: input.min || null,
      maxDate: input.max || null,
      onReady: (_d, _s, inst) => addYearPicker(inst),
      onOpen: (_d, _s, inst) => syncYearPicker(inst),
      onClose: (_d, _s, inst) => closeYearPanel(inst),
      onMonthChange: (_d, _s, inst) => syncYearPicker(inst),
      onYearChange: (_d, _s, inst) => syncYearPicker(inst),
    });
    if (fp.altInput && input.placeholder) fp.altInput.placeholder = input.placeholder;
    bindProperties(input, fp);
  }

  function bindProperties(input, fp) {
    Object.defineProperty(input, 'value', {
      configurable: true,
      get() { return native.value.get.call(this); },
      set(v) {
        native.value.set.call(this, v);
        syncValue(fp, v);
      },
    });
    bindLimit(input, fp, 'min', 'minDate');
    bindLimit(input, fp, 'max', 'maxDate');
  }

  function bindLimit(input, fp, prop, option) {
    Object.defineProperty(input, prop, {
      configurable: true,
      get() { return native[prop].get.call(this); },
      set(v) {
        native[prop].set.call(this, v);
        fp.set(option, v || null);
      },
    });
  }

  // ERPNext-style year picker: the header year is a button that opens a
  // decade grid (12 cells: the decade plus one year either side).
  const GRID_SIZE = 12;

  function addYearPicker(fp) {
    const wrapper = fp.calendarContainer.querySelector('.flatpickr-current-month .numInputWrapper');
    if (!wrapper || fp._yearBtn) return;
    wrapper.style.display = 'none';

    const btn = el('button', 'glass-year-btn');
    btn.setAttribute('aria-label', 'Choose year');
    btn.addEventListener('click', () => toggleYearPanel(fp));
    wrapper.parentNode.insertBefore(btn, wrapper);
    fp._yearBtn = btn;

    fp._yearPanel = buildYearPanel(fp);
    fp.calendarContainer.appendChild(fp._yearPanel.root);
    syncYearPicker(fp);
  }

  function buildYearPanel(fp) {
    const root = el('div', 'glass-year-panel');
    const head = el('div', 'glass-year-head');
    const prev = el('button', 'glass-year-nav', '‹');
    const title = el('span', 'glass-year-title');
    const next = el('button', 'glass-year-nav', '›');
    prev.setAttribute('aria-label', 'Previous decade');
    next.setAttribute('aria-label', 'Next decade');
    head.append(prev, title, next);

    const grid = el('div', 'glass-year-grid');
    const cells = [];
    for (let i = 0; i < GRID_SIZE; i++) {
      const cell = el('button', 'glass-year-cell');
      cell.addEventListener('click', () => pickYear(fp, Number(cell.dataset.year)));
      cells.push(cell);
      grid.appendChild(cell);
    }
    root.append(head, grid);

    const panel = { root, title, cells, decade: 0 };
    prev.addEventListener('click', () => renderDecade(fp, panel.decade - 10));
    next.addEventListener('click', () => renderDecade(fp, panel.decade + 10));
    return panel;
  }

  function toggleYearPanel(fp) {
    const panel = fp._yearPanel;
    const open = !panel.root.classList.contains('open');
    if (open) renderDecade(fp, Math.floor(fp.currentYear / 10) * 10);
    panel.root.classList.toggle('open', open);
  }

  function renderDecade(fp, decade) {
    const panel = fp._yearPanel;
    const { minDate, maxDate } = fp.config;
    const minYear = minDate ? minDate.getFullYear() : -Infinity;
    const maxYear = maxDate ? maxDate.getFullYear() : Infinity;
    const thisYear = new Date().getFullYear();
    panel.decade = decade;
    panel.title.textContent = `${decade} – ${decade + 9}`;
    panel.cells.forEach((cell, i) => {
      const year = decade - 1 + i;
      cell.textContent = year;
      cell.dataset.year = year;
      cell.disabled = year < minYear || year > maxYear;
      cell.classList.toggle('outside', i === 0 || i === GRID_SIZE - 1);
      cell.classList.toggle('current', year === thisYear);
      cell.classList.toggle('selected', year === fp.currentYear);
    });
  }

  function pickYear(fp, year) {
    fp.changeYear(year);
    closeYearPanel(fp);
  }

  function closeYearPanel(fp) {
    if (fp._yearPanel) fp._yearPanel.root.classList.remove('open');
  }

  function syncYearPicker(fp) {
    if (fp._yearBtn) fp._yearBtn.textContent = fp.currentYear;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (tag === 'button') node.type = 'button';
    if (text) node.textContent = text;
    return node;
  }

  // flatpickr also writes .value itself; only push values it does not already hold.
  function syncValue(fp, v) {
    const current = fp.selectedDates[0] ? fp.formatDate(fp.selectedDates[0], 'Y-m-d') : '';
    if ((v || '') === current) return;
    if (v) fp.setDate(v, false);
    else fp.clear(false);
  }

  window.GlassDatepicker = { init };
  init();
})();
