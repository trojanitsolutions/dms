function csrf(){const m=document.cookie.match(/X-Frappe-CSRF-Token=([^;]+)/);return m?decodeURIComponent(m[1]):'fetch'}
async function get(method,args={}){
	const p=new URLSearchParams(args);
	const r=await fetch(`/api/method/${method}?${p}`,{headers:{'X-Frappe-CSRF-Token':csrf(),'Accept':'application/json'}});
	if(!r.ok)return null;
	try{return(await r.json()).message}catch(e){return null}
}
async function post(method,args={}){
	const r=await fetch(`/api/method/${method}`,{method:'POST',headers:{'X-Frappe-CSRF-Token':csrf(),'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(args)});
	if(!r.ok){const d=await r.json();throw new Error((d._server_messages&&JSON.parse(JSON.parse(d._server_messages)[0]).message.replace(/<[^>]+>/g,""))||d.message||d.exc_type||'Error')}
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
// Rounded total unless rounding is disabled on the document (Global Defaults "Disable Rounded Total").
function docTotal(d){return d.disable_rounded_total||!d.rounded_total?d.grand_total:d.rounded_total}
function fmtCurrency(n){return 'QAR '+Number(n||0).toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2})}

function esc(s){const el=document.createElement('div');el.textContent=s;return el.innerHTML}

function fmtDate(dateStr){
	if(!dateStr)return '';
	const d=new Date(dateStr.replace(' ','T'));
	return d.toLocaleDateString('en',{month:'short',day:'numeric',year:'numeric'});
}

function getSalesOrderStatusBadgeClass(status){
	if(!status)return'so-status-draft';
	const lower=status.toLowerCase();
	if(lower==='pending')return'so-status-pending';
	if(lower==='draft')return'so-status-draft';
	if(lower==='delivered')return'so-status-delivered';
	if(lower==='completed')return'so-status-completed';
	if(lower==='cancelled')return'so-status-cancelled';
	if(lower==='to deliver and bill')return'so-status-to-deliver-and-bill';
	if(lower==='to bill')return'so-status-to-bill';
	if(lower==='to deliver')return'so-status-to-deliver';
	if(lower==='on hold')return'so-status-on-hold';
	if(lower==='closed')return'so-status-closed';
	return'so-status-draft';
}

function soItemRow(it){
	return `<div class="so-item">
		<div class="so-item-code">${esc(it.item_code)}</div>
		<div class="so-item-name">${esc(it.item_name)}</div>
		<div class="so-item-details">
			<div class="so-item-detail"><span class="so-item-detail-label">Qty:</span><span class="so-item-detail-value">${it.qty}</span></div>
			<div class="so-item-detail"><span class="so-item-detail-label">Rate:</span><span class="so-item-detail-value">${fmtCurrency(it.rate)}</span></div>
			<div class="so-item-detail"><span class="so-item-detail-label">Amount:</span><span class="so-item-detail-value">${fmtCurrency(it.amount)}</span></div>
		</div>
	</div>`;
}

function linkedOrderCard(so){
	const itemsHtml=(so.items||[]).map(soItemRow).join('');
	const statusClass=getSalesOrderStatusBadgeClass(so.status);
	const statusText=(so.status||'Draft').replace('_',' ');
	return `<div class="so-card-link">
		<div class="so-card">
			<div class="so-card-header">
				<div class="so-number">${esc(so.name)}</div>
				<div class="so-header-top">
					<span class="so-customer">${esc(so.customer_name)}</span>
					<span class="so-date">${fmtDate(so.transaction_date)}</span>
				</div>
				<span class="so-status-badge ${statusClass}">${esc(statusText)}</span>
			</div>
			<div class="so-items-wrap">${itemsHtml}</div>
			<div class="so-card-footer">
				<span class="so-footer-label">Grand Total</span>
				<span class="so-total">${fmtCurrency(docTotal(so))}</span>
			</div>
		</div>
	</div>`;
}

let searchTerm='';
let validTill='';
let status='';
let partyTypeFilter='';
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
		result=await get('dms.api.quotation.get_quotation_history',{search:searchTerm,valid_till:validTill,status:status,party_type:partyTypeFilter,limit_start:offset,limit_page_length:PAGE_SIZE});
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

function partyTag(partyType){
	return partyType&&partyType!=='Customer'?`<span class="quotation-party-tag">${esc(partyType)}</span>`:'';
}

function quotationCard(q){
	const itemsHtml=(q.items||[]).map(itemRow).join('');
	const statusClass=getStatusBadgeClass(q.status);
	const statusText=(q.status||'Draft').replace('_',' ');
	return `<div class="quotation-card" data-name="${esc(q.name)}" data-customer="${esc(q.customer)}">
		<div class="quotation-card-header">
			<div class="quotation-number">${esc(q.name)}</div>
			<div class="quotation-header-top">
				<span class="quotation-customer">${esc(q.customer_name||q.party_name)}${partyTag(q.party_type)}</span>
				<span class="quotation-date">${fmtDate(q.transaction_date)}</span>
			</div>
			<span class="quotation-status-badge ${statusClass}">${esc(statusText)}</span>
		</div>
		<div class="quotation-items-wrap">
			${itemsHtml}
		</div>
		<div class="quotation-card-footer">
			<span class="quotation-footer-label">Grand Total</span>
			<span class="quotation-total">${fmtCurrency(docTotal(q))}</span>
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

const partyTypeEl = document.getElementById('party-type-filter');
if (partyTypeEl) {
	partyTypeEl.addEventListener('change',e=>{
		partyTypeFilter=e.target.value;
		resetAndReload();
	});
}

// When the doctype has an active Workflow, offer its states in the status filter.
async function addWorkflowStatusOptions(doctype){
	const select=document.getElementById('status-filter');
	if(!select)return;
	const states=await get('dms.api.sales.get_workflow_states',{doctype});
	if(!states||!states.length)return;
	const group=document.createElement('optgroup');
	group.label='Workflow';
	states.forEach(s=>{const o=document.createElement('option');o.value=s;o.textContent=s;group.appendChild(o)});
	select.appendChild(group);
}
addWorkflowStatusOptions('Quotation');

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
	document.getElementById('detail-export-error').hidden=true;
}

// Fetch the file here (not in a new tab) so a server error shows on this page.
async function downloadExport(method,args,btn,errorBox,fallbackName){
	const label=btn.lastChild;
	const original=label.textContent;
	errorBox.hidden=true;
	btn.disabled=true;
	label.textContent=' Preparing…';
	try{
		const r=await fetch(`/api/method/${method}?${new URLSearchParams(args)}`,{headers:{'X-Frappe-CSRF-Token':csrf()}});
		const type=r.headers.get('Content-Type')||'';
		if(!r.ok||type.includes('application/json')){
			const json=await r.json().catch(()=>({}));
			let error='';
			try{error=JSON.parse(json._server_messages||'[]').map(m=>JSON.parse(m).message).join(' ')}catch(e){/* keep generic text */}
			const tmp=document.createElement('div');
			tmp.innerHTML=error;
			throw new Error(tmp.textContent.trim()||'Export failed. Please try again.');
		}
		const blob=await r.blob();
		const match=/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(r.headers.get('Content-Disposition')||'');
		const a=document.createElement('a');
		a.href=URL.createObjectURL(blob);
		a.download=match?decodeURIComponent(match[1]):fallbackName;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(()=>URL.revokeObjectURL(a.href),1000);
	}catch(e){
		errorBox.textContent=e.message||'Export failed. Please try again.';
		errorBox.hidden=false;
	}finally{
		label.textContent=original;
		btn.disabled=false;
	}
}

// Detail export: the quotation currently open.
['pdf','xlsx'].forEach(fileFormat=>{
	const detailBtn=document.getElementById(`detail-export-${fileFormat}-btn`);
	detailBtn.addEventListener('click',()=>{
		if(!currentQuotation)return;
		downloadExport(
			'dms.api.quotation.export_quotation',
			{name:currentQuotation.name,file_format:fileFormat},
			detailBtn,document.getElementById('detail-export-error'),`${currentQuotation.name}.${fileFormat}`
		);
	});
});

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

		document.getElementById('quotation-detail-party-label').textContent=q.party_type||'Customer';
		document.getElementById('quotation-detail-customer').textContent=q.customer_name||q.party_name||q.customer||'';
		const partyMeta=document.getElementById('quotation-detail-party-meta');
		const metaLines=[q.party_name&&q.party_name!==q.customer_name?q.party_name:'',[q.contact_mobile,q.contact_email].filter(Boolean).join(' · '),q.address_display].filter(Boolean);
		partyMeta.innerHTML=metaLines.map(l=>`<div>${esc(l)}</div>`).join('');
		partyMeta.hidden=!metaLines.length;
		document.getElementById('quotation-detail-date').textContent=fmtDate(q.transaction_date);
		document.getElementById('quotation-detail-valid-till').textContent=fmtDate(q.valid_till);

		const tbody=document.getElementById('quotation-detail-items');
		tbody.innerHTML='';
		(q.items||[]).forEach(it=>{
			const tr=document.createElement('tr');
			const discount=it.discount_percentage?`${it.discount_percentage}%`:(it.discount_amount?fmtCurrency(it.discount_amount):'–');
			tr.innerHTML=`<td>${esc(it.item_code)}</td><td>${esc(it.item_name)}</td><td class="quotation-table-desc">${esc(it.description||'')}</td><td class="quotation-table-number">${it.qty}</td><td>${esc(it.uom||'')}</td><td class="quotation-table-number">${fmtCurrency(it.rate)}</td><td class="quotation-table-number">${discount}</td><td class="quotation-table-number">${fmtCurrency(it.amount)}</td><td>${esc(it.warehouse||'')}</td><td>${fmtDate(q.valid_till)}</td>`;
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
		document.getElementById('quotation-detail-grand-total').textContent=fmtCurrency(docTotal(q));

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
			document.getElementById('quotation-detail-linked-orders').innerHTML=linkedOrders.map(linkedOrderCard).join('');
		}else{
			linkedWrap.hidden=true;
		}

		const createSoBtn=document.getElementById('quotation-detail-create-so');
		// Conversion depends on the document status, not the workflow state shown in the badge.
		if(canConvert(q.doc_status||q.status)){
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
	if(currentQuotation.party_type==='Lead'){
		const ok=await confirmAction(
			'Create Customer from Lead',
			`A customer will be created from Lead ${currentQuotation.party_name} (or the existing linked customer will be used), and the lead will be marked as Converted. Continue?`,
			'Continue'
		);
		if(!ok)return;
		try{
			await post('dms.api.quotation.ensure_customer_for_quotation',{name:currentQuotation.name});
		}catch(e){
			alert('Error: '+e.message);
			return;
		}
	}
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
