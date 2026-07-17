function csrf(){const m=document.cookie.match(/X-Frappe-CSRF-Token=([^;]+)/);return m?decodeURIComponent(m[1]):'fetch'}
async function get(method,args={}){
	const p=new URLSearchParams(args);
	const r=await fetch(`/api/method/${method}?${p}`,{headers:{'X-Frappe-CSRF-Token':csrf(),'Accept':'application/json'}});
	if(!r.ok)return null;
	try{return(await r.json()).message}catch(e){return null}
}

function fmt(n){return 'QAR '+Number(n||0).toLocaleString('en',{minimumFractionDigits:0,maximumFractionDigits:0})}

function esc(s){const el=document.createElement('div');el.textContent=s;return el.innerHTML}

function fmtDate(dateStr){
	if(!dateStr)return '';
	const d=new Date(dateStr.replace(' ','T'));
	return d.toLocaleDateString('en',{month:'short',day:'numeric',year:'numeric'});
}

let searchTerm='';
let offset=0;
let loading=false;
let hasMore=true;
let loadedNames=new Set();
const PAGE_SIZE=20;

function showLoadingIndicator(show){document.getElementById('loading-indicator').hidden=!show}
function hideEmptyState(){document.getElementById('empty-state').hidden=true}
function showEmptyState(msg){const el=document.getElementById('empty-state');el.textContent=msg;el.hidden=false}
function hideErrorState(){document.getElementById('error-state').hidden=true}
function showErrorState(){document.getElementById('error-state').hidden=false}

async function loadNextPage(){
	if(loading||!hasMore)return;
	loading=true;
	showLoadingIndicator(true);
	hideErrorState();

	let result;
	try{
		result=await get('dms.api.order_history.get_order_history',{search:searchTerm,limit_start:offset,limit_page_length:PAGE_SIZE});
	}catch(e){
		result=null;
	}

	loading=false;
	showLoadingIndicator(false);

	if(result===null){showErrorState();return}

	offset+=PAGE_SIZE;
	hasMore=!!result.has_more;

	const fresh=result.orders.filter(o=>!loadedNames.has(o.name));
	fresh.forEach(o=>loadedNames.add(o.name));
	appendCards(fresh);

	updateEmptyState();
}

function updateEmptyState(){
	const isFirstPage=offset===PAGE_SIZE;
	if(isFirstPage&&loadedNames.size===0){
		showEmptyState(searchTerm?`No orders match "${esc(searchTerm)}".`:'You have no orders yet.');
	}
}

function getStatusBadgeClass(status){
	if(!status)return'order-status-draft';
	const lower=status.toLowerCase();
	if(lower==='pending')return'order-status-pending';
	if(lower==='draft')return'order-status-draft';
	if(lower==='delivered')return'order-status-delivered';
	if(lower==='completed')return'order-status-completed';
	if(lower==='cancelled')return'order-status-cancelled';
	if(lower==='to deliver and bill')return'order-status-to-deliver-and-bill';
	if(lower==='to bill')return'order-status-to-bill';
	if(lower==='to deliver')return'order-status-to-deliver';
	if(lower==='on hold')return'order-status-on-hold';
	if(lower==='closed')return'order-status-closed';
	return'order-status-draft';
}

function itemRow(it){
	return `<tr><td>${esc(it.item_code)}</td><td>${esc(it.item_name)}</td><td>${it.qty}</td><td>${fmt(it.rate)}</td><td>${fmt(it.amount)}</td></tr>`;
}

function orderCard(o){
	const itemsHtml=(o.items||[]).map(itemRow).join('');
	const statusClass=getStatusBadgeClass(o.status);
	const statusText=(o.status||'Draft').replace('_',' ');
	return `<div class="order-card">
		<div class="order-card-header">
			<span class="order-number">${esc(o.name)}</span>
			<span class="order-customer">${esc(o.customer_name)}</span>
			<span class="order-status-badge ${statusClass}">${esc(statusText)}</span>
			<span class="order-date">${fmtDate(o.transaction_date)}</span>
		</div>
		<div class="order-items-wrap">
			<table class="order-items">
				<thead><tr><th>Item Code</th><th>Item Name</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
				<tbody>${itemsHtml}</tbody>
			</table>
		</div>
		<div class="order-card-footer">
			<span class="order-footer-label">Grand Total</span>
			<span class="order-total">${fmt(o.grand_total)}</span>
		</div>
	</div>`;
}

function appendCards(orders){
	document.getElementById('order-list').insertAdjacentHTML('beforeend',orders.map(orderCard).join(''));
}

function resetAndReload(){
	offset=0;
	hasMore=true;
	loadedNames.clear();
	document.getElementById('order-list').innerHTML='';
	hideEmptyState();
	hideErrorState();
	loadNextPage();
}

document.getElementById('search-input').addEventListener('input',e=>{
	clearTimeout(window.searchDebounceTimer);
	window.searchDebounceTimer=setTimeout(()=>{
		searchTerm=e.target.value.trim();
		resetAndReload();
	},350);
});

document.getElementById('retry-btn').addEventListener('click',loadNextPage);

const observer=new IntersectionObserver(entries=>{
	if(entries[0].isIntersecting)loadNextPage();
},{root:null,rootMargin:'400px',threshold:0});
observer.observe(document.getElementById('sentinel'));

loadNextPage();
