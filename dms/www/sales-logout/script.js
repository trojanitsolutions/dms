function csrf(){const m=document.cookie.match(/X-Frappe-CSRF-Token=([^;]+)/);return m?decodeURIComponent(m[1]):'fetch'}
fetch('/api/method/logout',{method:'POST',headers:{'X-Frappe-CSRF-Token':csrf()}})
  .finally(()=>window.location.href='/sales-login');
