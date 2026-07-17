const form     = document.getElementById('login-form');
const banner   = document.getElementById('error-banner');
const errText  = document.getElementById('error-text');
const btn      = document.getElementById('sign-in-btn');

function csrf() {
  const m = document.cookie.match(/X-Frappe-CSRF-Token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : 'fetch';
}

function showError(msg) {
  errText.textContent = msg;
  banner.classList.add('visible');
}

function hideError() {
  banner.classList.remove('visible');
}

function setLoading(on) {
  btn.disabled = on;
  btn.classList.toggle('loading', on);
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  hideError();
  setLoading(true);

  const usr = document.getElementById('usr').value.trim();
  const pwd = document.getElementById('pwd').value;

  try {
    const res = await fetch('/api/method/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Frappe-CSRF-Token': csrf()
      },
      body: `usr=${encodeURIComponent(usr)}&pwd=${encodeURIComponent(pwd)}`
    });
    const data = await res.json();

    if (!res.ok) {
      showError(data.message || data.exc_type || 'Invalid email or password. Please try again.');
      return;
    }

    // Verify Sales Rep role before redirecting
    const roleRes = await fetch('/api/method/dms.api.sales.get_dashboard_stats', {
      headers: { 'X-Frappe-CSRF-Token': csrf() }
    });

    if (roleRes.status === 403) {
      await fetch('/api/method/logout', {
        method: 'POST',
        headers: { 'X-Frappe-CSRF-Token': csrf() }
      });
      showError("Your account doesn't have Sales Rep access. Contact your administrator.");
      return;
    }

    window.location.href = '/sales-home';
  } catch {
    showError('Network error. Please check your connection and try again.');
  } finally {
    setLoading(false);
  }
});
