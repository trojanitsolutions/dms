import dayjs from 'dayjs'

// Renders Desk report print formats (JS microtemplates) outside Desk.

type Context = Record<string, unknown>

/** Port of `frappe.template.compile` (frappe/public/js/frappe/microtemplate.js). */
export function compileTemplate(str: string): (context: Context) => string {
  let counter = 0
  const nextVar = () => `_v${counter++}`

  str = str.replace(/{{/g, '{%=').replace(/}}/g, '%}')
  str = str.replace(/{%\s?if\s?\s?not\s?([^(][^%{]+)\s?%}/g, '{% if (! $1) { %}')
  str = str.replace(/{%\s?if\s?([^(][^%{]+)\s?%}/g, '{% if ($1) { %}')
  str = str.replace(/{%\s?for\s([a-z._]+)\sin\s([a-z._]+)\s?%}/g, (_m, item, list) => {
    const i = nextVar()
    const len = nextVar()
    return `{% for (var ${i}=0, ${len}=${list}.length; ${i}<${len}; ${i}++) { var ${item} = ${list}[${i}]; ${item}._index = ${i}; %}`
  })
  str = str.replace(/{%\s?endif\s?%}/g, '{% }; %}')
  str = str.replace(/{%\s?else\s?%}/g, '{% } else { %}')
  str = str.replace(/{%\s?endfor\s?%}/g, '{% }; %}')

  const body =
    'var _p=[],print=function(){_p.push.apply(_p,arguments)};' +
    "with(obj){\n_p.push('" +
    str
      .replace(/[\r\t\n]/g, ' ')
      .split('{%')
      .join('\t')
      .replace(/((^|%})[^\t]*)'/g, '$1\r')
      .replace(/\t=(.*?)%}/g, "',$1,'")
      .split('\t')
      .join("');\n")
      .split('%}')
      .join("\n_p.push('")
      .split('\r')
      .join("\\'") +
    "');}return _p.join('');"

  return new Function('obj', body) as (context: Context) => string
}

const flt = (value: unknown, precision?: number) => {
  const num = Number.parseFloat(String(value ?? 0).replace(/,/g, ''))
  if (Number.isNaN(num)) return 0
  return precision == null ? num : Number(num.toFixed(precision))
}

const cint = (value: unknown) => Math.trunc(flt(value))

/** The Desk globals that report print formats use. */
export function templateHelpers(currency?: string): Context {
  return {
    flt,
    cint,
    __: (text: string) => text,
    format_number: (value: unknown, _format?: unknown, decimals = 2) =>
      flt(value).toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }),
    get_currency_symbol: (code?: string) => code || currency || '',
    moment: (date?: unknown) => dayjs(date as string),
    frappe: {
      boot: { sysdefaults: { currency } },
      datetime: { get_today: () => dayjs().format('YYYY-MM-DD') },
    },
  }
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/**
 * Open the print window. Call this directly in the click handler, before any request,
 * so pop-up blockers allow it.
 */
export function openPrintWindow(): Window {
  const win = window.open('', '_blank')
  if (!win) throw new Error('Allow pop-ups for this site to print.')
  win.document.write('<p style="font-family: sans-serif">Preparing print…</p>')
  return win
}

/** Render a print format into `win` and open the browser print dialog. */
export function printReport(
  win: Window,
  options: {
    title: string
    html: string
    css?: string | null
    context: Context
    currency?: string
  },
) {
  const content = compileTemplate(options.html)({
    ...templateHelpers(options.currency),
    ...options.context,
  })

  win.document.open()
  win.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <base href="${window.location.origin}/">
  <title>${escapeHtml(options.title)}</title>
  <style>${options.css ?? ''}</style>
</head>
<body>${content}</body>
</html>`)
  win.document.close()
  // Wait for images such as the company logo before printing.
  const images = Array.from(win.document.images).filter((img) => !img.complete)
  Promise.all(
    images.map(
      (img) =>
        new Promise((resolve) => {
          img.addEventListener('load', resolve)
          img.addEventListener('error', resolve)
        }),
    ),
  ).then(() => {
    win.focus()
    win.print()
  })
}
