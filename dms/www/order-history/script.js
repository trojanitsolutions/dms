function csrf(){const m=document.cookie.match(/X-Frappe-CSRF-Token=([^;]+)/);return m?decodeURIComponent(m[1]):'fetch'}
async function get(method,args={}){
	const p=new URLSearchParams(args);
	const r=await fetch(`/api/method/${method}?${p}`,{headers:{'X-Frappe-CSRF-Token':csrf(),'Accept':'application/json'}});
	if(!r.ok)return null;
	try{return(await r.json()).message}catch(e){return null}
}
async function post(method,args={}){
	const r=await fetch(`/api/method/${method}`,{method:'POST',headers:{'X-Frappe-CSRF-Token':csrf(),'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(args)});
	if(!r.ok){let d={};try{d=await r.json()}catch(e){}let m='';try{m=JSON.parse(JSON.parse(d._server_messages)[0]).message.replace(/<[^>]+>/g,'')}catch(e){}throw new Error(m||d.exc_type||'Could not save the comment.')}
	try{return(await r.json()).message}catch(e){throw new Error('Invalid response')}
}

function fmt(n){return 'QAR '+Number(n||0).toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2})}
// Rounded total unless rounding is disabled on the document (Global Defaults "Disable Rounded Total").
function docTotal(d){return d.disable_rounded_total||!d.rounded_total?d.grand_total:d.rounded_total}

function esc(s){const el=document.createElement('div');el.textContent=s;return el.innerHTML}

function fmtDate(dateStr){
	if(!dateStr)return '';
	const d=new Date(dateStr.replace(' ','T'));
	return d.toLocaleDateString('en',{month:'short',day:'numeric',year:'numeric'});
}

let searchTerm='';
let postingDate='';
let deliveryDate='';
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
		result=await get('dms.api.order_history.get_order_history',{search:searchTerm,posting_date:postingDate,delivery_date:deliveryDate,status:status,limit_start:offset,limit_page_length:PAGE_SIZE});
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
	updateOrderCount();
}

function updateOrderCount(){
	document.getElementById('order-count').textContent=loadedNames.size;
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
	return `<div class="order-item">
		<div class="order-item-code">${esc(it.item_code)}</div>
		<div class="order-item-name">${esc(it.item_name)}</div>
		<div class="order-item-details">
			<div class="order-item-detail"><span class="order-item-detail-label">Qty:</span><span class="order-item-detail-value">${it.qty}</span></div>
			<div class="order-item-detail"><span class="order-item-detail-label">Rate:</span><span class="order-item-detail-value">${fmt(it.rate)}</span></div>
			<div class="order-item-detail"><span class="order-item-detail-label">Amount:</span><span class="order-item-detail-value">${fmt(it.amount)}</span></div>
		</div>
	</div>`;
}

function orderCard(o){
	const itemsHtml=(o.items||[]).map(itemRow).join('');
	const statusClass=getStatusBadgeClass(o.status);
	const statusText=(o.status||'Draft').replace('_',' ');
	const editLink=o.can_edit?`<a href="/sales-order?order=${encodeURIComponent(o.name)}" class="order-edit-link">Edit</a>`:'';
	return `<div class="order-card">
		<div class="order-card-header">
			<div class="order-number">${esc(o.name)}</div>
			<div class="order-header-top">
				<span class="order-customer">${esc(o.customer_name)}</span>
				<span class="order-date">${fmtDate(o.transaction_date)}</span>
			</div>
			<span class="order-status-badge ${statusClass}">${esc(statusText)}</span>
		</div>
		<div class="order-items-wrap">
			${itemsHtml}
		</div>
		<div class="order-card-footer">
			<span class="order-footer-label">Grand Total</span>
			<span class="order-total">${fmt(docTotal(o))}</span>
			${editLink}
		</div>
		${commentsSection(o.name)}
		${activitySection(o.name)}
	</div>`;
}

function appendCards(orders){
	document.getElementById('order-list').insertAdjacentHTML('beforeend',orders.map(orderCard).join(''));
	updateOrderCount();
	loadCommentCounts(orders.map(o=>o.name));
	openLinkedComments();
}

/* Opened from a notification: /order-history?order=<name>[&comments=1] */
let linkedOrder='';
let linkedOpenComments=false;
function openLinkedComments(){
	if(!linkedOrder)return;
	const box=[...document.querySelectorAll('.order-comments')].find(el=>el.dataset.order===linkedOrder);
	if(!box)return;
	if(linkedOpenComments){
		const t=box.querySelector('.oc-toggle');
		if(t&&t.getAttribute('aria-expanded')!=='true')t.click();
	}
	box.closest('.order-card')?.scrollIntoView({block:'center'});
	linkedOrder='';
}

/* ── Comments ───────────────────────────────────────────── */
const ICON_COMMENT='<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.84 8.84 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zm-6 0h2v2H9V9z" clip-rule="evenodd"/></svg>';
const ICON_CHEVRON='<svg class="oc-chevron" width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>';

function commentsSection(name){
	const id='oc-'+name.replace(/[^A-Za-z0-9_-]/g,'_');
	return `<div class="order-comments" data-order="${esc(name)}">
		<button type="button" class="oc-toggle" aria-expanded="false" aria-controls="${id}">
			${ICON_COMMENT}<span>Comments</span><span class="oc-count" hidden></span>${ICON_CHEVRON}
		</button>
		<div class="oc-body" id="${id}" hidden>
			<form class="oc-form">
				<textarea class="oc-input" rows="2" maxlength="2000" placeholder="Add a comment…" aria-label="Add a comment to ${esc(name)}"></textarea>
				<div class="oc-form-row">
					<span class="oc-error" role="alert"></span>
					<button type="submit" class="oc-submit" disabled>Comment</button>
				</div>
			</form>
			<div class="oc-list" aria-live="polite"></div>
		</div>
	</div>`;
}

/* ── Activity (timeline drawn by /assets/dms/js/order_activity.js) ── */
const ICON_ACTIVITY='<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/></svg>';

function activitySection(name){
	const id='oa-'+name.replace(/[^A-Za-z0-9_-]/g,'_');
	return `<div class="order-activity" data-order="${esc(name)}">
		<button type="button" class="oa-toggle" aria-expanded="false" aria-controls="${id}">
			${ICON_ACTIVITY}<span>Activity</span>${ICON_CHEVRON}
		</button>
		<div class="oa-section-body" id="${id}" hidden></div>
	</div>`;
}

function commentText(html){
	const withBreaks=String(html||'').replace(/<br\s*\/?>/gi,'\n').replace(/<\/(p|div|li)>/gi,'\n');
	const doc=new DOMParser().parseFromString(withBreaks,'text/html');
	return (doc.body.textContent||'').replace(/\n{3,}/g,'\n\n').trim();
}

function timeAgo(dateStr){
	if(!dateStr)return '';
	const d=new Date(dateStr.replace(' ','T'));
	const s=Math.round((Date.now()-d.getTime())/1000);
	if(s<60)return 'just now';
	if(s<3600)return Math.floor(s/60)+' min ago';
	if(s<86400)return Math.floor(s/3600)+' h ago';
	if(s<604800)return Math.floor(s/86400)+' d ago';
	return d.toLocaleDateString('en',{month:'short',day:'numeric',year:'numeric'});
}

function initials(name){
	return String(name||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()||'?';
}

function commentItem(c){
	const by=c.comment_by||c.comment_email||c.owner||'';
	const d=c.creation?new Date(String(c.creation).replace(' ','T')):null;
	const full=d?d.toLocaleString('en',{dateStyle:'medium',timeStyle:'short'}):'';
	return `<div class="oc-item">
		<div class="oc-avatar" aria-hidden="true">${esc(initials(by))}</div>
		<div class="oc-main">
			<div class="oc-meta"><span class="oc-author">${esc(by)}</span><time class="oc-time" datetime="${esc(String(c.creation||''))}" title="${esc(full)}">${esc(timeAgo(String(c.creation||'')))}</time></div>
			<div class="oc-text">${esc(commentText(c.content))}</div>
		</div>
	</div>`;
}

function setCount(box,n){
	const el=box.querySelector('.oc-count');
	box.dataset.count=n;
	el.textContent=n;
	el.hidden=!n;
}

async function loadCommentCounts(names){
	if(!names.length)return;
	const counts=await get('dms.api.order_comments.get_comment_counts',{orders:JSON.stringify(names)}).catch(()=>null);
	if(!counts)return;
	document.querySelectorAll('.order-comments').forEach(box=>{
		const n=counts[box.dataset.order];
		if(n)setCount(box,n);
	});
}

async function loadComments(box){
	const list=box.querySelector('.oc-list');
	list.innerHTML='<div class="oc-empty">Loading comments…</div>';
	const rows=await get('dms.api.order_comments.get_order_comments',{order:box.dataset.order}).catch(()=>null);
	if(rows===null){list.innerHTML='<div class="oc-empty">Could not load comments.</div>';return}
	box.dataset.loaded='1';
	setCount(box,rows.length);
	list.innerHTML=rows.length?rows.map(commentItem).join(''):'<div class="oc-empty">No comments yet.</div>';
}

const orderListEl=document.getElementById('order-list');
if(orderListEl){
	orderListEl.addEventListener('click',async e=>{
		const btn=e.target.closest('.oa-toggle');
		if(!btn)return;
		const box=btn.closest('.order-activity');
		const body=box.querySelector('.oa-section-body');
		const open=btn.getAttribute('aria-expanded')!=='true';
		btn.setAttribute('aria-expanded',String(open));
		body.hidden=!open;
		box.classList.toggle('open',open);
		if(open&&!box.dataset.loaded&&window.DMSActivity){
			box.dataset.loaded='1';
			if(!await window.DMSActivity.render(body,box.dataset.order))delete box.dataset.loaded;
		}
	});
	orderListEl.addEventListener('click',e=>{
		const btn=e.target.closest('.oc-toggle');
		if(!btn)return;
		const box=btn.closest('.order-comments');
		const body=box.querySelector('.oc-body');
		const open=btn.getAttribute('aria-expanded')!=='true';
		btn.setAttribute('aria-expanded',String(open));
		body.hidden=!open;
		box.classList.toggle('open',open);
		if(open&&!box.dataset.loaded)loadComments(box);
	});
	orderListEl.addEventListener('input',e=>{
		if(!e.target.classList.contains('oc-input'))return;
		const form=e.target.closest('.oc-form');
		form.querySelector('.oc-submit').disabled=!e.target.value.trim();
		form.querySelector('.oc-error').textContent='';
	});
	orderListEl.addEventListener('keydown',e=>{
		if(e.target.classList.contains('oc-input')&&e.key==='Enter'&&(e.metaKey||e.ctrlKey)){
			e.preventDefault();
			e.target.closest('.oc-form').requestSubmit();
		}
	});
	orderListEl.addEventListener('submit',async e=>{
		if(!e.target.classList.contains('oc-form'))return;
		e.preventDefault();
		const form=e.target;
		const box=form.closest('.order-comments');
		const input=form.querySelector('.oc-input');
		const btn=form.querySelector('.oc-submit');
		const err=form.querySelector('.oc-error');
		const text=input.value.trim();
		if(!text||btn.dataset.busy)return;
		btn.dataset.busy='1';btn.disabled=true;btn.textContent='Saving…';err.textContent='';
		try{
			const c=await post('dms.api.order_comments.add_order_comment',{order:box.dataset.order,content:text});
			const list=box.querySelector('.oc-list');
			const empty=list.querySelector('.oc-empty');
			if(empty)empty.remove();
			list.insertAdjacentHTML('afterbegin',commentItem(c));
			setCount(box,(+box.dataset.count||0)+1);
			input.value='';
		}catch(ex){
			err.textContent=ex.message||'Could not save the comment.';
		}finally{
			delete btn.dataset.busy;btn.textContent='Comment';btn.disabled=!input.value.trim();
		}
	});
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

const postingDateEl = document.getElementById('posting-date-filter');
if (postingDateEl) {
	postingDateEl.addEventListener('change',e=>{
		postingDate=e.target.value;
		resetAndReload();
	});
}

const deliveryDateEl = document.getElementById('delivery-date-filter');
if (deliveryDateEl) {
	deliveryDateEl.addEventListener('change',e=>{
		deliveryDate=e.target.value;
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
addWorkflowStatusOptions('Sales Order');

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

(function(){
	const q=new URLSearchParams(location.search);
	const order=(q.get('order')||'').trim();
	if(!order)return;
	linkedOrder=order;
	linkedOpenComments=q.get('comments')==='1';
	searchTerm=order;
	if(searchInputEl)searchInputEl.value=order;
})();

loadNextPage();
