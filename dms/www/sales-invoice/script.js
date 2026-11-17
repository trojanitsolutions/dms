/* Sales Invoices. Which invoices appear (draft or submitted, all or only the
 * user's own) is decided server side by Sales Management Settings.
 * Submitted invoices can be returned (shared popup in sales_return.js). */
function csrf(){const m=document.cookie.match(/X-Frappe-CSRF-Token=([^;]+)/);return m?decodeURIComponent(m[1]):'fetch'}
async function get(method,args={}){
	const p=new URLSearchParams(args);
	const r=await fetch(`/api/method/${method}?${p}`,{headers:{'X-Frappe-CSRF-Token':csrf(),'Accept':'application/json'}});
	if(!r.ok)return null;
	try{return(await r.json()).message}catch(e){return null}
}

function fmt(n){return 'QAR '+Number(n||0).toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2})}
// Rounded total unless rounding is disabled on the document (Global Defaults "Disable Rounded Total").
function docTotal(d){return d.disable_rounded_total||!d.rounded_total?d.grand_total:d.rounded_total}
function esc(s){const el=document.createElement('div');el.textContent=s==null?'':String(s);return el.innerHTML}
function fmtDate(dateStr){
	if(!dateStr)return '';
	const d=new Date(String(dateStr).replace(' ','T'));
	return d.toLocaleDateString('en',{month:'short',day:'numeric',year:'numeric'});
}

const PAGE_SIZE=20;
const state={kind:location.hash==='#returns'?'returns':'invoices',invoiceId:'',customer:'',salesOrder:'',postingDate:'',fromDate:'',toDate:'',status:'',offset:0,loading:false,hasMore:true,names:new Set(),seq:0,canReturn:false};
const listEl=document.getElementById('order-list');

async function loadNextPage(){
	if(state.loading||!state.hasMore)return;
	const seq=state.seq;
	state.loading=true;
	toggle('loading-indicator',true);
	toggle('error-state',false);

	const result=await get('dms.api.sales_invoice.get_sales_invoices',{
		kind:state.kind,invoice_id:state.invoiceId,customer:state.customer,sales_order:state.salesOrder,posting_date:state.postingDate,
		from_date:state.fromDate,to_date:state.toDate,status:state.status,
		limit_start:state.offset,limit_page_length:PAGE_SIZE,
	}).catch(()=>null);

	if(seq!==state.seq)return; // tab, search or filter changed meanwhile
	state.loading=false;
	toggle('loading-indicator',false);
	if(!result){toggle('error-state',true);return}

	applyMode(result.based_on);
	setCanReturn(!!result.can_return);
	state.offset+=PAGE_SIZE;
	state.hasMore=!!result.has_more;
	const fresh=result.invoices.filter(i=>!state.names.has(i.name));
	fresh.forEach(i=>state.names.add(i.name));
	listEl.insertAdjacentHTML('beforeend',fresh.map(invoiceCard).join(''));
	updateCountAndEmpty();
}

const MODE_SUBTITLE={Draft:'Draft sales invoices.',Submitted:'Submitted sales invoices.',All:'Draft and submitted sales invoices.'};
// Invoices tab follows Sales Management Settings:
//   Draft mode: every invoice is a draft, so the status filter has nothing to choose.
//   Submitted mode: no drafts are listed, so the "Draft" status option is hidden.
// Returns tab always lists draft and submitted credit notes.
function applyMode(basedOn){
	const returns=state.kind==='returns';
	document.getElementById('invoice-sub').textContent=returns
		?'Sales returns (credit notes).'
		:MODE_SUBTITLE[basedOn]||MODE_SUBTITLE.All;
	document.getElementById('count-label').textContent=returns?'Returns':'Invoices';
	const select=document.getElementById('status-filter');
	if(!select)return;
	select.closest('.filter-group').hidden=!returns&&basedOn==='Draft';
	select.querySelectorAll('option[data-for]').forEach(opt=>{
		const forKind=opt.dataset.for.split(' ').includes(state.kind);
		opt.hidden=!forKind||(!returns&&opt.value==='Draft'&&basedOn==='Submitted');
	});
}

function updateCountAndEmpty(){
	document.getElementById('order-count').textContent=state.names.size;
	const empty=document.getElementById('empty-state');
	const none=state.names.size===0;
	const noun=state.kind==='returns'?'returns':'invoices';
	const searching=state.invoiceId||state.customer||state.salesOrder;
	empty.textContent=searching?`No ${noun} match your search.`:`No ${noun} found.`;
	empty.hidden=!none;
}

// Start the list again from the first page (tab, search or filter changed, or a return was made).
function resetAndReload(){
	state.seq++;
	Object.assign(state,{offset:0,loading:false,hasMore:true,names:new Set()});
	listEl.innerHTML='';
	updateCountAndEmpty();
	document.getElementById('empty-state').hidden=true;
	loadNextPage();
}

function toggle(id,show){const el=document.getElementById(id);if(el)el.hidden=!show}

function statusClass(status){
	return 'order-status-'+String(status||'draft').toLowerCase().replace(/\s+/g,'-');
}

function itemRow(it){
	return `<div class="order-item">
		<div class="order-item-code">${esc(it.item_code)}</div>
		<div class="order-item-name">${esc(it.item_name)}</div>
		<div class="order-item-details">
			<div class="order-item-detail"><span class="order-item-detail-label">Qty:</span><span class="order-item-detail-value">${esc(it.qty)}</span></div>
			<div class="order-item-detail"><span class="order-item-detail-label">Rate:</span><span class="order-item-detail-value">${fmt(it.rate)}</span></div>
			<div class="order-item-detail"><span class="order-item-detail-label">Amount:</span><span class="order-item-detail-value">${fmt(it.amount)}</span></div>
		</div>
	</div>`;
}

function invoiceCard(inv){
	const status=inv.status||'Draft';
	const due=inv.is_return
		?(inv.return_against?`<span class="invoice-against">Against <strong>${esc(inv.return_against)}</strong></span>`:'')
		:(inv.due_date?`<span>Due ${fmtDate(inv.due_date)}</span>`:'');
	const outstanding=inv.docstatus===1&&!inv.is_return
		?`<span class="invoice-outstanding">Outstanding <strong>${fmt(inv.outstanding_amount)}</strong></span>`:'';
	return `<div class="order-card">
		<div class="order-card-header">
			<div class="order-number">${esc(inv.name)}</div>
			<div class="order-header-top">
				<span class="order-customer">${esc(inv.customer_name||inv.customer)}${customerId(inv)}</span>
				<span class="order-date">${fmtDate(inv.posting_date)}</span>
			</div>
			<div class="invoice-dates">${due}</div>
			${ordersLine(inv)}
			<span class="order-status-badge ${statusClass(status)}">${esc(status)}</span>
		</div>
		<div class="order-items-wrap">${(inv.items||[]).map(itemRow).join('')}</div>
		<div class="order-card-footer">
			${returnAction(inv)}
			<span class="order-footer-label">${inv.is_return?'Return Total':'Grand Total'}</span>
			${outstanding}
			<span class="order-total">${fmt(docTotal(inv))}</span>
		</div>
	</div>`;
}

// Customer ID under the name, when it differs from the name.
function customerId(inv){
	return inv.customer&&inv.customer!==inv.customer_name?`<span class="order-customer-id">${esc(inv.customer)}</span>`:'';
}

// Sales Orders billed on this invoice (search also matches these).
function ordersLine(inv){
	const orders=[...new Set((inv.items||[]).map(it=>it.sales_order).filter(Boolean))];
	return orders.length?`<div class="invoice-orders">Order <strong>${orders.map(esc).join(', ')}</strong></div>`:'';
}

// Return actions need Sales Invoice create permission (sent by the API as can_return).
function setCanReturn(on){
	state.canReturn=on;
	const newBtn=document.getElementById('new-return-btn');
	if(newBtn)newBtn.hidden=!on||state.kind!=='returns';
}

function returnAction(inv){
	if(!state.canReturn||inv.docstatus!==1||inv.is_return)return '';
	const tag=inv.has_returns?'<span class="invoice-return-tag">Has returns</span>':'';
	return `${tag}<button type="button" class="invoice-return-btn" data-return="${esc(inv.name)}">Return</button>`;
}

// Return popup lives in /assets/dms/js/sales_return.js (shared with the dashboard).
listEl.addEventListener('click',e=>{
	const btn=e.target.closest('[data-return]');
	if(btn&&window.SalesReturn)SalesReturn.open(btn.dataset.return,{onDone:resetAndReload});
});

/* ── Invoices / Returns tabs ──────────────────────────── */
function setKind(kind){
	state.kind=kind;
	document.querySelectorAll('.inv-tab').forEach(tab=>{
		const on=tab.dataset.kind===kind;
		tab.classList.toggle('active',on);
		tab.setAttribute('aria-selected',on?'true':'false');
	});
	const newBtn=document.getElementById('new-return-btn');
	if(newBtn)newBtn.hidden=!state.canReturn||kind!=='returns';
	history.replaceState(null,'',kind==='returns'?'#returns':location.pathname+location.search);
	// Drop a status that the new tab does not offer.
	const select=document.getElementById('status-filter');
	const opt=select?.querySelector(`option[value="${CSS.escape(state.status)}"][data-for]`);
	if(opt&&!opt.dataset.for.split(' ').includes(kind)){select.value='';state.status=''}
}
document.querySelector('.inv-tabs')?.addEventListener('click',e=>{
	const tab=e.target.closest('.inv-tab');
	if(!tab||tab.dataset.kind===state.kind)return;
	setKind(tab.dataset.kind);
	resetAndReload();
});
setKind(state.kind);
// Returns tab: start a return by searching the invoice first.
document.getElementById('new-return-btn')?.addEventListener('click',()=>{
	if(window.SalesReturn)SalesReturn.pick({onDone:resetAndReload});
});

let searchTimer;
// Three separate search fields; every filled one must match.
const searchInput=id=>document.getElementById(id)?.value.trim()||'';
function applySearch(){
	clearTimeout(searchTimer);
	state.invoiceId=searchInput('search-invoice');
	state.customer=searchInput('search-customer');
	state.salesOrder=searchInput('search-order');
	resetAndReload();
}
document.querySelectorAll('[data-search-field]').forEach(input=>input.addEventListener('input',()=>{
	clearTimeout(searchTimer);
	searchTimer=setTimeout(applySearch,350);
}));

/* ── Customer suggestions (name + ID) ─────────────────── */
const custInput=document.getElementById('search-customer');
const custList=document.getElementById('customer-suggest');
let custTimer,custSeq=0,custActive=-1;
function showSuggest(open){
	custList.hidden=!open;
	custInput.setAttribute('aria-expanded',open?'true':'false');
	if(!open)custActive=-1;
}
async function loadSuggest(){
	const seq=++custSeq;
	const rows=await get('dms.api.sales_invoice.search_invoice_customers',{txt:custInput.value.trim(),kind:state.kind})||[];
	if(seq!==custSeq||document.activeElement!==custInput)return;
	custActive=-1;
	custList.innerHTML=rows.length?rows.map((c,i)=>`<button type="button" class="suggest-row" role="option" id="cust-opt-${i}" data-customer="${esc(c.customer)}">
		<span class="suggest-name">${esc(c.customer_name||c.customer)}</span>
		<span class="suggest-id">${esc(c.customer)}</span>
	</button>`).join(''):'<div class="suggest-empty">No matching customers</div>';
	showSuggest(true);
}
function pickCustomer(id){
	custInput.value=id;
	showSuggest(false);
	applySearch();
}
function moveActive(step){
	const rows=[...custList.querySelectorAll('.suggest-row')];
	if(!rows.length)return;
	custActive=(custActive+step+rows.length)%rows.length;
	rows.forEach((r,i)=>r.classList.toggle('active',i===custActive));
	rows[custActive].scrollIntoView({block:'nearest'});
	custInput.setAttribute('aria-activedescendant',rows[custActive].id);
}
if(custInput&&custList){
	custInput.addEventListener('input',()=>{clearTimeout(custTimer);custTimer=setTimeout(loadSuggest,200)});
	custInput.addEventListener('focus',loadSuggest);
	custInput.addEventListener('blur',()=>setTimeout(()=>showSuggest(false),150));
	custInput.addEventListener('keydown',e=>{
		if(custList.hidden)return;
		if(e.key==='ArrowDown'){e.preventDefault();moveActive(1)}
		else if(e.key==='ArrowUp'){e.preventDefault();moveActive(-1)}
		else if(e.key==='Enter'&&custActive>=0){e.preventDefault();pickCustomer(custList.querySelectorAll('.suggest-row')[custActive].dataset.customer)}
		else if(e.key==='Escape')showSuggest(false);
	});
	// mousedown keeps focus on the input until the pick is made
	custList.addEventListener('mousedown',e=>{
		const row=e.target.closest('.suggest-row');
		if(row){e.preventDefault();pickCustomer(row.dataset.customer)}
	});
}
document.getElementById('posting-date-filter')?.addEventListener('change',e=>{state.postingDate=e.target.value;resetAndReload()});
// From/To range wins over Posting Date; dim Posting Date while a range is set.
function onRangeChange(){
	state.fromDate=document.getElementById('from-date-filter').value;
	state.toDate=document.getElementById('to-date-filter').value;
	const group=document.getElementById('posting-date-filter')?.closest('.filter-group');
	const ranged=!!(state.fromDate||state.toDate);
	if(group){group.classList.toggle('is-ignored',ranged);group.title=ranged?'From/To date is used':''}
	resetAndReload();
}
document.getElementById('from-date-filter')?.addEventListener('change',onRangeChange);
document.getElementById('to-date-filter')?.addEventListener('change',onRangeChange);
document.getElementById('status-filter')?.addEventListener('change',e=>{state.status=e.target.value;resetAndReload()});

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
addWorkflowStatusOptions('Sales Invoice');

// Deep link from the notification bell: /sales-invoice?invoice=<name> fills the Invoice ID search.
(function(){
	const invoice=(new URLSearchParams(location.search).get('invoice')||'').trim();
	if(!invoice)return;
	state.invoiceId=invoice;
	const input=document.getElementById('search-invoice');
	if(input)input.value=invoice;
})();
document.getElementById('retry-btn')?.addEventListener('click',loadNextPage);

new IntersectionObserver(entries=>{
	if(entries[0].isIntersecting)loadNextPage();
},{rootMargin:'400px'}).observe(document.getElementById('sentinel'));

loadNextPage();
