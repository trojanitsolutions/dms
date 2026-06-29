function csrf() {
	const m = document.cookie.match(/X-Frappe-CSRF-Token=([^;]+)/);
	return m ? decodeURIComponent(m[1]) : 'fetch';
}

function showError(msg) {
	const banner = document.getElementById('err-banner');
	const text = document.getElementById('err-text');
	text.textContent = msg;
	banner.classList.add('visible');
}

const btn = document.getElementById('submit-btn');

btn.addEventListener('click', async function () {
	const usr = document.getElementById('inp-user').value.trim();
	const pwd = document.getElementById('inp-pass').value;
	if (!usr || !pwd) { showError('Please enter your username and password.'); return; }

	btn.disabled = true;
	btn.textContent = 'Signing in…';

	try {
		const r = await fetch('/api/method/login', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'X-Frappe-CSRF-Token': csrf(),
			},
			body: 'usr=' + encodeURIComponent(usr) + '&pwd=' + encodeURIComponent(pwd),
		});
		if (!r.ok) {
			const d = await r.json().catch(() => ({}));
			throw new Error(d.message || 'Invalid username or password.');
		}
	} catch (err) {
		showError(err.message || 'Invalid username or password.');
		btn.disabled = false;
		btn.textContent = 'Log In';
		return;
	}

	// Verify Delivery Partner role
	try {
		const check = await fetch('/api/method/dms.api.delivery.get_delivery_dashboard', {
			headers: { 'X-Frappe-CSRF-Token': csrf(), 'Accept': 'application/json' },
		});
		if (check.status === 403) throw new Error('access-denied');
	} catch (err) {
		await fetch('/api/method/logout', { method: 'POST', headers: { 'X-Frappe-CSRF-Token': csrf() } }).catch(() => {});
		showError("You don't have access to the Delivery Executive portal.");
		btn.disabled = false;
		btn.textContent = 'Log In';
		return;
	}

	location.replace('/delivery-dashboard');
});

// Allow Enter key to submit
document.getElementById('inp-pass').addEventListener('keydown', function (e) {
	if (e.key === 'Enter') btn.click();
});
document.getElementById('inp-user').addEventListener('keydown', function (e) {
	if (e.key === 'Enter') document.getElementById('inp-pass').focus();
});
