// Renders Desk report print formats (JS microtemplates) on portal pages, where Desk's code is not loaded.
// Plain-JS copy of frontend/src/printReport.ts.
(function () {
  // Port of `frappe.template.compile` (frappe/public/js/frappe/microtemplate.js).
  function compileTemplate(str) {
    var counter = 0;
    var nextVar = function () { return '_v' + counter++; };

    str = str.replace(/{{/g, '{%=').replace(/}}/g, '%}');
    str = str.replace(/{%\s?if\s?\s?not\s?([^(][^%{]+)\s?%}/g, '{% if (! $1) { %}');
    str = str.replace(/{%\s?if\s?([^(][^%{]+)\s?%}/g, '{% if ($1) { %}');
    str = str.replace(/{%\s?for\s([a-z._]+)\sin\s([a-z._]+)\s?%}/g, function (_m, item, list) {
      var i = nextVar();
      var len = nextVar();
      return '{% for (var ' + i + '=0, ' + len + '=' + list + '.length; ' + i + '<' + len + '; ' + i + '++) { var ' +
        item + ' = ' + list + '[' + i + ']; ' + item + '._index = ' + i + '; %}';
    });
    str = str.replace(/{%\s?endif\s?%}/g, '{% }; %}');
    str = str.replace(/{%\s?else\s?%}/g, '{% } else { %}');
    str = str.replace(/{%\s?endfor\s?%}/g, '{% }; %}');

    var body =
      'var _p=[],print=function(){_p.push.apply(_p,arguments)};' +
      "with(obj){\n_p.push('" +
      str
        .replace(/[\r\t\n]/g, ' ')
        .split('{%').join('\t')
        .replace(/((^|%})[^\t]*)'/g, '$1\r')
        .replace(/\t=(.*?)%}/g, "',$1,'")
        .split('\t').join("');\n")
        .split('%}').join("\n_p.push('")
        .split('\r').join("\\'") +
      "');}return _p.join('');";

    return new Function('obj', body);
  }

  function flt(value, precision) {
    var num = parseFloat(String(value == null ? 0 : value).replace(/,/g, ''));
    if (isNaN(num)) return 0;
    return precision == null ? num : Number(num.toFixed(precision));
  }

  function cint(value) { return Math.trunc(flt(value)); }

  function pad(n) { return String(n).padStart(2, '0'); }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // The part of moment() that report print formats use: moment(date).format(tokens).
  function moment(value) {
    var d;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      var p = value.split('-').map(Number);
      d = new Date(p[0], p[1] - 1, p[2]);
    } else {
      d = value ? new Date(value) : new Date();
    }
    return {
      format: function (tokens) {
        var parts = {
          YYYY: d.getFullYear(), MMM: MONTHS[d.getMonth()], MM: pad(d.getMonth() + 1),
          DD: pad(d.getDate()), D: d.getDate(),
        };
        return (tokens || 'YYYY-MM-DD').replace(/YYYY|MMM|MM|DD|D/g, function (t) { return parts[t]; });
      },
    };
  }

  function helpers(currency) {
    return {
      flt: flt,
      cint: cint,
      __: function (text) { return text; },
      format_number: function (value, _format, decimals) {
        decimals = decimals == null ? 2 : decimals;
        return flt(value).toLocaleString('en', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
      },
      get_currency_symbol: function (code) { return code || currency || ''; },
      moment: moment,
      frappe: {
        boot: { sysdefaults: { currency: currency } },
        datetime: { get_today: function () { return moment().format('YYYY-MM-DD'); } },
      },
    };
  }

  // Returns a full HTML document: the rendered print format with its CSS.
  function render(options) {
    var context = Object.assign(helpers(options.currency), options.context);
    var content = compileTemplate(options.html)(context);
    var title = String(options.title || '').replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + title + '</title>' +
      '<style>' + (options.css || '') + '</style></head><body>' + content + '</body></html>';
  }

  window.DmsReportPrint = { compileTemplate: compileTemplate, render: render };
})();
