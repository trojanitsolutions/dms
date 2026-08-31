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

function fmt(n){return Number(n||0).toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2})}
function fmtCurrency(n){return 'QAR '+Number(n||0).toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2})}

function esc(s){const el=document.createElement('div');el.textContent=s;return el.innerHTML}

function fmtDate(dateStr){
	if(!dateStr)return '';
	const d=new Date(dateStr.replace(' ','T'));
	return d.toLocaleDateString('en',{month:'short',day:'numeric',year:'numeric'});
}

let searchTerm='';
let validTill='';
let status='';
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
		result=await get('dms.api.quotation.get_quotation_history',{search:searchTerm,valid_till:validTill,status:status,limit_start:offset,limit_page_length:PAGE_SIZE});
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
		showEmptyState(searchTerm?`No quotations match "${esc(searchTerm)}".`:'You have no quotations yet.');
	}
	updateQuotationCount();
}

function updateQuotationCount(){
	document.getElementById('quotation-count').textContent=loadedNames.size;
}

function getStatusBadgeClass(status){
	if(!status)return'quotation-status-draft';
	const lower=status.toLowerCase();
	if(lower==='draft')return'quotation-status-draft';
	if(lower==='submitted')return'quotation-status-submitted';
	if(lower==='open')return'quotation-status-open';
	if(lower==='replied')return'quotation-status-replied';
	if(lower==='ordered')return'quotation-status-ordered';
	if(lower==='lost')return'quotation-status-lost';
	if(lower==='cancelled')return'quotation-status-cancelled';
	if(lower==='expired')return'quotation-status-expired';
	return'quotation-status-draft';
}

function canConvert(status){
	if(!status)return true;
	const lower=status.toLowerCase();
	return!['draft','ordered','lost','cancelled','expired'].includes(lower);
}

function itemRow(it){
	return `<div class="quotation-item">
		<div class="quotation-item-code">${esc(it.item_code)}</div>
		<div class="quotation-item-name">${esc(it.item_name)}</div>
		<div class="quotation-item-details">
			<div class="quotation-item-detail"><span class="quotation-item-detail-label">Qty:</span><span class="quotation-item-detail-value">${it.qty}</span></div>
			<div class="quotation-item-detail"><span class="quotation-item-detail-label">Rate:</span><span class="quotation-item-detail-value">${fmtCurrency(it.rate)}</span></div>
			<div class="quotation-item-detail"><span class="quotation-item-detail-label">Amount:</span><span class="quotation-item-detail-value">${fmtCurrency(it.amount)}</span></div>
		</div>
	</div>`;
}

function quotationCard(q){
	const itemsHtml=(q.items||[]).map(itemRow).join('');
	const statusClass=getStatusBadgeClass(q.status);
	const statusText=(q.status||'Draft').replace('_',' ');
	return `<div class="quotation-card" data-name="${esc(q.name)}" data-customer="${esc(q.customer)}">
		<div class="quotation-card-header">
			<div class="quotation-number">${esc(q.name)}</div>
			<div class="quotation-header-top">
				<span class="quotation-customer">${esc(q.customer_name)}</span>
				<span class="quotation-date">${fmtDate(q.transaction_date)}</span>
			</div>
			<span class="quotation-status-badge ${statusClass}">${esc(statusText)}</span>
		</div>
		<div class="quotation-items-wrap">
			${itemsHtml}
		</div>
		<div class="quotation-card-footer">
			<span class="quotation-footer-label">Grand Total</span>
			<span class="quotation-total">${fmtCurrency(q.grand_total)}</span>
		</div>
	</div>`;
}

function appendCards(quotations){
	document.getElementById('quotation-list').insertAdjacentHTML('beforeend',quotations.map(quotationCard).join(''));
	updateQuotationCount();
}

function resetAndReload(){
	offset=0;
	hasMore=true;
	loadedNames.clear();
	document.getElementById('quotation-list').innerHTML='';
	hideEmptyState();
	hideErrorState();
	loadNextPage();
}

const searchInputEl = document.getElementById('search-input');
if (searchInputEl) {
	searchInputEl.addEventListener('input',e=>{
		clearTimeout(window.searchDebounceTimer);
		window.searchDebounceTimer=setTimeout(()=>{
			searchTerm=e.target.value.trim();
			resetAndReload();
		},350);
	});
}

const validTillEl = document.getElementById('valid-till-filter');
if (validTillEl) {
	validTillEl.addEventListener('change',e=>{
		validTill=e.target.value;
		resetAndReload();
	});
}

const statusEl = document.getElementById('status-filter');
if (statusEl) {
	statusEl.addEventListener('change',e=>{
		status=e.target.value;
		resetAndReload();
	});
}

const retryBtn = document.getElementById('retry-btn');
if (retryBtn) {
	retryBtn.addEventListener('click',loadNextPage);
}

const sentinel = document.getElementById('sentinel');
if (sentinel) {
	const observer=new IntersectionObserver(entries=>{
		if(entries[0].isIntersecting)loadNextPage();
	},{root:null,rootMargin:'400px',threshold:0});
	observer.observe(sentinel);
}

let currentQuotation=null;

function showListView(){
	document.getElementById('quotation-list-view').hidden=false;
	document.getElementById('quotation-detail-view').hidden=true;
}

function showDetailView(){
	document.getElementById('quotation-list-view').hidden=true;
	document.getElementById('quotation-detail-view').hidden=false;
}

function formatInWords(words){
	if(!words)return '';
	const lines=words.split('\n');
	return lines.map(l=>l.trim()).filter(l=>l).join(' ');
}

async function loadQuotationDetail(name){
	try{
		const q=await get('dms.api.quotation.get_quotation_detail',{name:name});
		if(!q){showErrorState();return}

		currentQuotation=q;

		document.getElementById('quotation-detail-title').textContent=esc(q.name);
		const statusClass=getStatusBadgeClass(q.status);
		const statusText=(q.status||'Draft').replace('_',' ');
		const badge=document.getElementById('quotation-detail-badge');
		badge.className='quotation-status-badge '+statusClass;
		badge.textContent=esc(statusText);

		document.getElementById('quotation-detail-customer').textContent=esc(q.customer_name||q.customer||'');
		document.getElementById('quotation-detail-date').textContent=fmtDate(q.transaction_date);
		document.getElementById('quotation-detail-valid-till').textContent=fmtDate(q.valid_till);

		const tbody=document.getElementById('quotation-detail-items');
		tbody.innerHTML='';
		(q.items||[]).forEach(it=>{
			const tr=document.createElement('tr');
			tr.innerHTML=`<td>${esc(it.item_name||it.item_code)}</td><td>${esc(it.item_code)}</td><td class="quotation-table-number">${it.qty}</td><td class="quotation-table-number">${fmtCurrency(it.rate)}</td><td class="quotation-table-number">${fmtCurrency(it.amount)}</td>`;
			tbody.appendChild(tr);
		});

		const wordsWrap=document.getElementById('quotation-detail-words-wrap');
		if(q.in_words){
			wordsWrap.hidden=false;
			document.getElementById('quotation-detail-words').textContent=formatInWords(q.in_words);
		}else{
			wordsWrap.hidden=true;
		}

		const taxesRow=document.getElementById('quotation-detail-taxes-row');
		if(q.total_taxes_and_charges&&q.total_taxes_and_charges!==0){
			taxesRow.hidden=false;
			document.getElementById('quotation-detail-taxes').textContent=fmtCurrency(q.total_taxes_and_charges);
		}else{
			taxesRow.hidden=true;
		}

		const discountRow=document.getElementById('quotation-detail-discount-row');
		const totalDiscount=(q.discount_amount||0)+(q.additional_discount_percentage?q.net_total*q.additional_discount_percentage/100:0);
		if(totalDiscount&&totalDiscount!==0){
			discountRow.hidden=false;
			document.getElementById('quotation-detail-discount').textContent='-'+fmtCurrency(totalDiscount);
		}else{
			discountRow.hidden=true;
		}

		document.getElementById('quotation-detail-net-total').textContent=fmtCurrency(q.net_total||q.total);
		document.getElementById('quotation-detail-grand-total').textContent=fmtCurrency(q.grand_total);

		const termsWrap=document.getElementById('quotation-detail-terms-wrap');
		if(q.terms){
			termsWrap.hidden=false;
			document.getElementById('quotation-detail-terms').textContent=q.terms;
		}else{
			termsWrap.hidden=true;
		}

		const linkedWrap=document.getElementById('quotation-detail-linked-orders-wrap');
		const linkedOrders=await get('dms.api.quotation.get_linked_sales_orders',{quotation:name});
		if(linkedOrders&&linkedOrders.length>0){
			linkedWrap.hidden=false;
			const container=document.getElementById('quotation-detail-linked-orders');
			container.innerHTML='';
			linkedOrders.forEach(so=>{
				const statusClass=so.docstatus===1?'submitted':'draft';
				const item=document.createElement('div');
				item.className='linked-order-item';
				item.innerHTML=`<a href="/app/sales-order/${esc(so.name)}" target="_blank" class="linked-order-name">${esc(so.name)}</a><span class="linked-order-status ${statusClass}">${so.docstatus===1?'Submitted':'Draft'}</span>`;
				container.appendChild(item);
			});
		}else{
			linkedWrap.hidden=true;
		}

		const createSoBtn=document.getElementById('quotation-detail-create-so');
		if(canConvert(q.status)){
			createSoBtn.style.display='inline-block';
		}else{
			createSoBtn.style.display='none';
		}

		showDetailView();
	}catch(e){
		console.error(e);
		showErrorState();
	}
}

document.getElementById('quotation-list').addEventListener('click',e=>{
	const card=e.target.closest('.quotation-card');
	if(card){
		loadQuotationDetail(card.dataset.name);
	}
});

document.getElementById('quotation-detail-back').addEventListener('click',e=>{
	e.preventDefault();
	showListView();
});

document.getElementById('quotation-detail-create-so').addEventListener('click',async()=>{
	if(!currentQuotation)return;
	try{
		const soData=await get('dms.api.quotation.get_quotation_for_sales_order',{name:currentQuotation.name});
		if(soData){
			const params=new URLSearchParams({
				quotation:currentQuotation.name,
				customer:soData.customer,
				warehouse:soData.warehouse,
				delivery_date:soData.delivery_date
			});
			window.location.href='/sales-order?'+params.toString();
		}
	}catch(e){
		alert('Error starting sales order creation. Please try again.');
		console.error(e);
	}
});

const urlParams=new URLSearchParams(location.search);
const quotationName=urlParams.get('quotation');
if(quotationName){
	loadQuotationDetail(quotationName);
}else{
	loadNextPage();
}
