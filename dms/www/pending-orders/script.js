function csrf(){const m=document.cookie.match(/X-Frappe-CSRF-Token=([^;]+)/);return m?decodeURIComponent(m[1]):'fetch'}
async function get(method,args={}){
	const p=new URLSearchParams(args);
	const r=await fetch(`/api/method/${method}?${p}`,{headers:{'X-Frappe-CSRF-Token':csrf(),'Accept':'application/json'}});
	if(!r.ok)return null;
	try{return(await r.json()).message}catch(e){return null}
}
async function post(method,args={}){
	const r=await fetch(`/api/method/${method}`,{method:'POST',headers:{'X-Frappe-CSRF-Token':csrf(),'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(args)});
	if(!r.ok){const d=await r.json();throw new Error(d.message||d.exc_type||'Error')}
	try{return(await r.json()).message}catch(e){throw new Error('Invalid response')}
}

function fmt(n){return 'QAR '+Number(n||0).toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2})}
function esc(s){const el=document.createElement('div');el.textContent=s;return el.innerHTML}
function fmtDate(dateStr){
	if(!dateStr)return '';
	const d=new Date(dateStr.replace(' ','T'));
	return d.toLocaleDateString('en',{month:'short',day:'numeric',year:'numeric'});
}

function confirmAction(title,msg,confirmLabel){
	return new Promise(resolve=>{
		const overlay=document.getElementById('confirm-overlay');
		document.getElementById('confirm-title').textContent=title;
		document.getElementById('confirm-msg').textContent=msg;
		const okBtn=document.getElementById('confirm-ok-btn');
		const cancelBtn=document.getElementById('confirm-cancel-btn');
		okBtn.textContent=confirmLabel;
		overlay.classList.add('open');
		function done(result){
			overlay.classList.remove('open');
			okBtn.removeEventListener('click',onOk);
			cancelBtn.removeEventListener('click',onCancel);
			overlay.removeEventListener('click',onBg);
			document.removeEventListener('keydown',onKey);
			resolve(result);
		}
		function onOk(){done(true)}
		function onCancel(){done(false)}
		function onBg(e){if(e.target===overlay)done(false)}
		function onKey(e){if(e.key==='Escape')done(false)}
		okBtn.addEventListener('click',onOk);
		cancelBtn.addEventListener('click',onCancel);
		overlay.addEventListener('click',onBg);
		document.addEventListener('keydown',onKey);
	});
}

let orders=[],filtered=[],pageSize=20,shown=20;
function showEmptyState(){document.getElementById('empty-state').hidden=false}
function showErrorState(){document.getElementById('error-state').hidden=false}
function hideEmptyState(){document.getElementById('empty-state').hidden=true}
function hideErrorState(){document.getElementById('error-state').hidden=true}

function fmtTime(dateStr){
	if(!dateStr)return'';
	const d=new Date(dateStr.replace(' ','T'));
	return d.toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit',meridiem:'short'});
}

function render(){
	const searchTerm=document.getElementById('search-input').value.toLowerCase();
	filtered=orders.filter(o=>o.name.toLowerCase().includes(searchTerm)||o.customer_name.toLowerCase().includes(searchTerm));
	const toShow=filtered.slice(0,shown);
	const rows=toShow.map(o=>`<tr><td class="order-number-cell">${esc(o.name)}</td><td>${esc(o.customer_name)}</td><td><div class="order-date-cell"><div class="order-date-main">${fmtDate(o.transaction_date)}</div><div class="order-date-time">${fmtTime(o.transaction_date)}</div></div></td><td>${o.item_count||0}</td><td>${fmt(o.grand_total)}</td><td><select class="action-select" data-name="${esc(o.name)}"><option value="">Select Action</option><option value="reopen">Reopen</option><option value="submit">Submit</option><option value="discard">Discard</option></select></td></tr>`).join('');
	document.getElementById('order-list').innerHTML=rows;
	const total=filtered.length;
	const displaying=Math.min(shown,total);
	document.getElementById('showing-text').textContent=`Showing 1 to ${displaying} of ${total} orders`;
	const loadMoreBtn=document.getElementById('load-more-btn');
	loadMoreBtn.hidden=shown>=total;
	if(total===0)showEmptyState();
	else hideEmptyState();
}

async function loadPendingOrders(){
	hideEmptyState();
	hideErrorState();
	shown=pageSize;
	const result=await get('dms.api.sales.get_pending_orders');
	if(!result){
		showErrorState();
		return;
	}
	orders=result;
	render();
}

document.getElementById('order-list').addEventListener('change',async e=>{
	if(e.target.classList.contains('action-select')){
		const action=e.target.value;
		const name=e.target.dataset.name;
		if(!action)return;
		if(action==='reopen'){
			window.location.href='/sales-order?order='+encodeURIComponent(name);
			return;
		}
		if(action==='submit'){
			const ok=await confirmAction('Submit Order','This will commit stock and cannot be undone. Submit this order now?','Submit');
			if(!ok){e.target.value='';return}
			try{
				await post('dms.api.sales.submit_pending_order',{name});
				orders=orders.filter(o=>o.name!==name);
				render();
			}catch(err){
				alert('Error: '+err.message);
				e.target.value='';
			}
		}
		if(action==='discard'){
			const ok=await confirmAction('Discard Order','Discard this pending order? This cannot be undone.','Discard');
			if(!ok){e.target.value='';return}
			try{
				await post('dms.api.sales.discard_pending_order',{name});
				orders=orders.filter(o=>o.name!==name);
				render();
			}catch(err){
				alert('Error: '+err.message);
				e.target.value='';
			}
		}
	}
});

document.getElementById('search-input').addEventListener('input',e=>{shown=pageSize;render()});
document.querySelectorAll('.page-size-btn').forEach(btn=>{
	btn.addEventListener('click',e=>{
		document.querySelectorAll('.page-size-btn').forEach(b=>b.classList.remove('active'));
		e.target.classList.add('active');
		pageSize=parseInt(e.target.dataset.size);
		shown=pageSize;
		render();
	});
});
document.getElementById('load-more-btn').addEventListener('click',e=>{
	shown=Math.min(shown+pageSize,filtered.length);
	render();
});
const retryBtn=document.getElementById('retry-btn');
if(retryBtn)retryBtn.addEventListener('click',loadPendingOrders);

(function(){
	var overlay=document.getElementById('logout-confirm-overlay');
	function openLogoutConfirm(e){e.preventDefault();overlay.classList.add('open')}
	function closeLogoutConfirm(){overlay.classList.remove('open')}
	document.querySelectorAll('a[href="/sales-logout"]').forEach(function(a){
		a.addEventListener('click',openLogoutConfirm);
	});
	document.getElementById('logout-cancel-btn').addEventListener('click',closeLogoutConfirm);
	document.getElementById('logout-confirm-btn').addEventListener('click',function(){
		window.location.href='/sales-logout';
	});
	overlay.addEventListener('click',function(e){if(e.target===overlay)closeLogoutConfirm()});
	document.addEventListener('keydown',function(e){if(e.key==='Escape')closeLogoutConfirm()});
})();

(function(){
	var btn=document.getElementById('sidebar-toggle');
	if(!btn)return;
	btn.addEventListener('click',function(){document.body.classList.toggle('sidebar-expanded');});
	document.querySelectorAll('.nav-link').forEach(function(a){
		a.addEventListener('click',function(){if(window.innerWidth<1200)document.body.classList.remove('sidebar-expanded');});
	});
})();

loadPendingOrders();
