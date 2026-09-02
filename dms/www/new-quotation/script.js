const IS_DESKTOP = () => window.innerWidth >= 768;
const CUSTOMER_ID = window.pageData?.customer || '';
const CUSTOMER_NAME = window.pageData?.customer_name || '';
let customerAddresses = [];
let selectedBillingAddress = '';
let selectedShippingAddress = '';
let shippingSameAsBilling = true;

function csrf(){const m=document.cookie.match(/X-Frappe-CSRF-Token=([^;]+)/);return m?decodeURIComponent(m[1]):'fetch'}
async function get(method,args={}){
  const p=new URLSearchParams(args);
  const r=await fetch(`/api/method/${method}?${p}`,{headers:{'X-Frappe-CSRF-Token':csrf(),'Accept':'application/json'}});
  if(!r.ok)return null;return(await r.json()).message;
}
async function post(method,args={}){
  const r=await fetch(`/api/method/${method}`,{method:'POST',headers:{'X-Frappe-CSRF-Token':csrf(),'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(args)});
  const d=await r.json();if(!r.ok)throw new Error(d.message||d.exc_type||'Error');return d.message;
}

function fmt(n){return 'QAR '+Number(n||0).toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2})}
function fmtN(n){return 'QAR '+Number(n||0).toLocaleString('en',{minimumFractionDigits:0,maximumFractionDigits:0})}
function esc(s){const d=document.createElement('div');d.textContent=String(s||'');return d.innerHTML}
function escJS(s){return String(s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'")}
function fmtDate(d){const date=new Date(d);return date.toLocaleDateString('en',{year:'numeric',month:'short',day:'numeric'})}

let allItems=[],filteredItems=[],cart={},activeGroup='All',groups=[];
let currentGrandTotal=0;
let currentView=sessionStorage.getItem('itemView')||'grid';
let activeWhPopup=null;
const RENDER_BATCH=100;
let renderedCount=0;
let scrollSentinel=null,sentinelObserver=null;
let modalItemCode=null;
let orderDiscountType='',orderDiscountValue=0;
const STOCK_VALIDATION_DISABLED=true;
let pendingAdd=new Set();

/* ── Stock helpers ───────────────────────────────────────── */
function displayedAvailable(code){
  if(STOCK_VALIDATION_DISABLED)return Infinity;
  const item=allItems.find(i=>i.name===code);
  if(!item)return 0;
  const wh=getWarehouse();
  const availMap=item.warehouse_available||{};
  const stockMap=item.warehouse_stocks||{};
  let avail;
  if(wh){
    avail=availMap[wh]!==undefined?availMap[wh]:(stockMap[wh]||0);
  }else{
    avail=Object.values(availMap).reduce((s,v)=>s+v,0);
    if(!avail)avail=Object.values(stockMap).reduce((s,v)=>s+v,0);
  }
  return Math.max(0,avail-(cart[code]?.qty||0));
}
function isCardOos(code){
  if(STOCK_VALIDATION_DISABLED)return false;
  const item=allItems.find(i=>i.name===code);
  if(!item||!item.any_stock)return true;
  if(cart[code])return false;
  const wh=getWarehouse();
  if(!wh)return!item.any_stock;
  return displayedAvailable(code)<=0;
}

/* ── View toggle ────────────────────────────────────────── */
function setView(v){
  currentView=v;
  sessionStorage.setItem('itemView',v);
  document.getElementById('vt-grid').classList.toggle('active',v==='grid');
  document.getElementById('vt-list').classList.toggle('active',v==='list');
  renderedCount=0;
  renderItems(filteredItems);
}

/* ── Warehouse popup ─────────────────────────────────────── */
function showWhPopup(evt,code){
  evt.stopPropagation();
  closeWhPopup();
  const item=allItems.find(i=>i.name===code);
  if(!item)return;
  const stocks=Object.entries(item.warehouse_stocks||{});
  if(!stocks.length)return;
  const popup=document.createElement('div');
  popup.className='wh-popup';
  const uom=item.stock_uom||'ea';
  popup.innerHTML=`<div class="wp-title">Stock by warehouse</div>`
    +stocks.map(([w,q])=>`<div class="wp-row"><span class="wp-wh">${w}</span><span class="wp-qty">${q} ${uom}</span></div>`).join('');
  document.body.appendChild(popup);
  activeWhPopup=popup;
  const r=evt.currentTarget.getBoundingClientRect();
  const pw=240;
  let left=r.left+window.scrollX;
  if(left+pw>window.innerWidth-8)left=window.innerWidth-pw-8;
  popup.style.left=Math.max(8,left)+'px';
  popup.style.top=(r.bottom+6+window.scrollY)+'px';
  setTimeout(()=>document.addEventListener('click',closeWhPopup,{once:true}),10);
}
function closeWhPopup(){
  if(activeWhPopup){activeWhPopup.remove();activeWhPopup=null;}
}

/* ── Mobile tab switching ─────────────────────────────────── */
function setMobTab(tab){
  document.querySelectorAll('.mob-tab').forEach(el=>el.classList.toggle('active',el.dataset.tab===tab));
  const catalogEl=document.getElementById('catalog-panel');
  const mobWhRow=document.getElementById('mob-wh-cart-row');
  const cartEl=document.getElementById('cart-panel');
  if(IS_DESKTOP())return;
  if(tab==='catalog'){
    catalogEl.style.display='flex';
    cartEl.style.display='none';
  } else {
    catalogEl.style.display='none';
    cartEl.style.display='flex';
    mobWhRow.style.display='block';
  }
}
window.addEventListener('resize',()=>{
  if(IS_DESKTOP()){
    document.getElementById('catalog-panel').style.display='';
    document.getElementById('cart-panel').style.display='';
    document.getElementById('mob-wh-cart-row').style.display='none';
  } else {
    setMobTab(document.querySelector('.mob-tab.active')?.dataset.tab||'catalog');
  }
});

/* ── Warehouse helpers ───────────────────────────────────── */
function getWarehouse(){
  return IS_DESKTOP()
    ?document.getElementById('warehouse-select').value
    :(document.getElementById('mob-warehouse-select').value||document.getElementById('mob-warehouse-select-2').value);
}
function setWarehouseSelects(val){
  ['warehouse-select','mob-warehouse-select','mob-warehouse-select-2'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.value=val;
  });
}
async function onWarehouseChange(){
  const wh=document.getElementById('warehouse-select').value;
  setWarehouseSelects(wh);
  await reloadItems(wh);
  refreshTotals();
}
async function onMobWarehouseChange(){
  const wh=document.getElementById('mob-warehouse-select').value;
  setWarehouseSelects(wh);
  await reloadItems(wh);
  refreshTotals();
}
async function onMobWarehouseChange2(){
  const wh=document.getElementById('mob-warehouse-select-2').value;
  setWarehouseSelects(wh);
  await reloadItems(wh);
  refreshTotals();
}
async function reloadItems(wh){
  const data=await get('dms.api.sales.get_items',{warehouse:wh});
  if(data){
    allItems=data;
    renderedCount=0;
    applyFilters();
    groups.forEach(g=>{
      const cnt=allItems.filter(i=>i.item_group===g.name).length;
      const el=document.getElementById('cat-count-'+CSS.escape(g.name));
      if(el)el.textContent=cnt;
    });
    document.getElementById('cat-count-all').textContent=allItems.length;
  }
}

/* ── Item icons ─────────────────────────────────────────── */
function itemIcon(group){
  const g=(group||'').toLowerCase();
  if(g.includes('pen')||g.includes('fountain'))return`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125"/></svg>`;
  if(g.includes('note')||g.includes('journal'))return`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"/></svg>`;
  return`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"/></svg>`;
}

const EYE_ICON=`<svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/></svg>`;

/* ── Render dispatcher ────────────────────────────────────── */
function renderItems(items){
  if(renderedCount===0){
    const el=document.getElementById('items-grid');
    el.className=currentView==='list'?'items-list':'items-grid';
    el.innerHTML='';
    if(!items.length){
      el.innerHTML=currentView==='list'
        ?'<div style="text-align:center;padding:60px;color:#9CA3AF">No items found.</div>'
        :'<div style="grid-column:1/-1;text-align:center;padding:60px;color:#9CA3AF">No items found.</div>';
      document.getElementById('item-count').textContent='0 items';
      detachSentinel();return;
    }
  }
  document.getElementById('item-count').textContent=items.length+' items';
  const batch=items.slice(renderedCount,renderedCount+RENDER_BATCH);
  if(!batch.length){detachSentinel();return;}
  appendBatch(batch,currentView);
  renderedCount+=batch.length;
  if(renderedCount<items.length)attachSentinel();else detachSentinel();
}

function appendBatch(batch,view){
  const el=document.getElementById('items-grid');
  const frag=document.createDocumentFragment();
  batch.forEach(item=>{
    const wrapper=document.createElement(view==='list'?'div':'div');
    wrapper.innerHTML=view==='list'?makeListRow(item):makeGridCard(item);
    while(wrapper.firstChild)frag.appendChild(wrapper.firstChild);
  });
  el.appendChild(frag);
  batch.forEach(item=>refreshCard(item.name));
}

function attachSentinel(){
  detachSentinel();
  const el=document.getElementById('items-grid');
  scrollSentinel=document.createElement('div');
  scrollSentinel.style.cssText='height:1px;grid-column:1/-1';
  el.appendChild(scrollSentinel);
  sentinelObserver=new IntersectionObserver(entries=>{
    if(entries[0].isIntersecting)renderItems(filteredItems);
  },{rootMargin:'200px'});
  sentinelObserver.observe(scrollSentinel);
}
function detachSentinel(){
  if(sentinelObserver){sentinelObserver.disconnect();sentinelObserver=null;}
  if(scrollSentinel){scrollSentinel.remove();scrollSentinel=null;}
}

/* ── Render grid card ─────────────────────────────────────── */
function makeGridCard(item){
  const oos=isCardOos(item.name);
  const whCount=Object.keys(item.warehouse_stocks||{}).length;
  const peekBtn=whCount>0?`<button class="wh-peek-btn" data-item-code="${item.name}">${EYE_ICON}${whCount}</button>`:'';
  const imgContent=item.image?`<img src="${esc(item.image)}" alt="" onerror="this.style.display='none'">` :'';
  return`<div class="item-card${oos?' oos':''}" id="card-${CSS.escape(item.name)}" data-item-code="${item.name}">
    <div class="item-img">${imgContent}${oos?'<div class="oos-badge">OOS</div>':''}</div>
    <div class="item-body">
      <div class="item-group-label">${esc(item.item_group)}</div>
      <div class="item-name" title="${esc(item.item_name)}">${esc(item.item_name)}</div>
      <div class="item-code">${esc(item.name)}</div>
      <div class="item-footer">
        <div><div class="item-price">${fmt(item.standard_rate)} <span style="font-size:10px;font-weight:400;color:#9CA3AF">/${item.stock_uom||'ea'}</span></div><span id="stock-${CSS.escape(item.name)}"></span>${peekBtn}</div>
        <div id="action-${CSS.escape(item.name)}"></div>
      </div>
    </div>
  </div>`;
}

/* ── Render list row ─────────────────────────────────────── */
function makeListRow(item){
  const oos=isCardOos(item.name);
  const whCount=Object.keys(item.warehouse_stocks||{}).length;
  const peekBtn=whCount>0?`<button class="wh-peek-btn" data-item-code="${item.name}">${EYE_ICON}${whCount} wh</button>`:'';
  const thumb=item.image
    ?`<div class="item-row-thumb"><img src="${esc(item.image)}" alt="" onerror="this.style.display='none'"></div>`
    :`<div class="item-row-thumb"></div>`;
  return`<div class="item-row-wrap" id="card-${CSS.escape(item.name)}" data-item-code="${item.name}">
    <div class="item-row${oos?' oos':''}">
      ${thumb}
      <div class="item-row-info">
        <div class="item-row-name">${esc(item.item_name)}</div>
        <div class="item-row-meta">${esc(item.name)}${item.item_group?' · '+esc(item.item_group):''}</div>
      </div>
      <div class="item-row-mid">
        <div class="item-row-price">${fmt(item.standard_rate)} <span style="font-size:10px;font-weight:400;color:#9CA3AF">/${item.stock_uom||'ea'}</span></div>
        <span id="stock-${CSS.escape(item.name)}"></span>
        ${peekBtn}
      </div>
      <div class="item-row-action" id="action-${CSS.escape(item.name)}"></div>
    </div>
  </div>`;
}

/* ── Filters ─────────────────────────────────────────────── */
function applyFilters(){
  const instockOnly=document.getElementById('instock-filter').checked;
  sessionStorage.setItem('instockFilter',instockOnly?'1':'0');
  const q=document.getElementById('item-search').value.toLowerCase().trim();
  const wh=getWarehouse();
  filteredItems=allItems.filter(i=>{
    if(activeGroup!=='All'&&i.item_group!==activeGroup)return false;
    if(instockOnly){
      if(wh){if(((i.warehouse_available||{})[wh]||0)<=0)return false;}
      else{if(!i.any_stock)return false;}
    }
    if(q){
      const hay=[i.item_name,i.name,i.item_group].map(s=>(s||'').toLowerCase()).join(' ');
      if(!hay.includes(q))return false;
    }
    return true;
  });
  renderedCount=0;
  renderItems(filteredItems);
}

function filterGroup(group){
  activeGroup=group;
  const mobSel=document.getElementById('mob-cat-select');
  if(mobSel)mobSel.value=group;
  document.querySelectorAll('#desk-cat-list .cat-item').forEach(el=>el.classList.toggle('active',el.dataset.group===group));
  document.querySelectorAll('#mob-cat-strip .cat-chip').forEach(el=>el.classList.toggle('active',el.dataset.group===group));
  applyFilters();
}

function filterChip(el,group){filterGroup(group)}

let searchTimer;
function onSearchInput(){clearTimeout(searchTimer);searchTimer=setTimeout(applyFilters,250)}

/* ── Cart ─────────────────────────────────────────────────── */
function addToCart(code,qty){
  const item=allItems.find(i=>i.name===code);
  if(!item)return false;
  if(!STOCK_VALIDATION_DISABLED&&!item.any_stock)return false;
  const avail=displayedAvailable(code);
  if(avail<=0)return false;
  qty=Math.min(Math.max(1,parseInt(qty,10)||1),avail);
  cart[code]={item,qty,discountType:'',discountValue:0};
  updateCartUI();refreshCard(code);
  return true;
}
function setQty(code,rawValue){
  if(!cart[code])return;
  let n=parseInt(rawValue,10);
  if(isNaN(n)||n<0)n=0;
  const maxAvail=displayedAvailable(code)+cart[code].qty;
  n=Math.min(n,maxAvail);
  cart[code].qty=n;
  if(n===0)delete cart[code];
  updateCartUI();refreshCard(code);
}
function changeQty(code,delta){
  if(!cart[code])return;
  if(delta>0&&displayedAvailable(code)<=0)return;
  setQty(code,cart[code].qty+delta);
}
function removeFromCart(code){delete cart[code];updateCartUI();refreshCard(code)}

let totalsTimer;
async function refreshTotals(){
	clearTimeout(totalsTimer);
	const items=Object.values(cart);
	if(!items.length){
		document.getElementById('sum-subtotal').textContent='QAR 0.00';
		document.getElementById('sum-grand').textContent='QAR 0.00';
		document.getElementById('cart-taxes-rows').innerHTML='';
		document.getElementById('discount-row').style.display='none';
		currentGrandTotal=0;
		return;
	}
	totalsTimer=setTimeout(async()=>{
		try{
			const wh=getWarehouse();
			const itemsData=items.map(({item,qty,discountType,discountValue,rate})=>{
				const row={item_code:item.name,qty,rate:rate!==undefined?rate:item.standard_rate};
				if(discountType)row.discount_type=discountType,row.discount_value=discountValue;
				return row;
			});
			const result=await post('dms.api.quotation_create.get_quotation_totals',{
				customer:CUSTOMER_ID,
				warehouse:wh,
				items_json:JSON.stringify(itemsData),
				valid_till:document.getElementById('valid-till').value||'',
				customer_address:document.getElementById('billing-address-select')?.value||'',
				shipping_address:(shippingSameAsBilling?selectedBillingAddress:selectedShippingAddress)||'',
				additional_discount_type:orderDiscountType,
				additional_discount_value:orderDiscountValue
			});
			if(!result)return;
			result.items.forEach(resItem=>{
				const el=document.querySelector(`.cart-item-total[data-item-code="${CSS.escape(resItem.item_code)}"]`);
				if(el)el.textContent=fmt(resItem.amount);
				const rateEl=document.querySelector(`.cart-item-rate[data-item-code="${CSS.escape(resItem.item_code)}"]`);
				if(rateEl)rateEl.textContent=fmt(resItem.rate);
			});
			document.getElementById('sum-subtotal').textContent=fmt(result.total);
			const taxEl=document.getElementById('cart-taxes-rows');
			taxEl.innerHTML='';
			if(result.taxes&&result.taxes.length){
				result.taxes.forEach(t=>{
					const div=document.createElement('div');
					div.className='tax-row';
					div.innerHTML=`<span class="tax-key">${esc(t.description)}</span><span>${fmt(t.tax_amount)}</span>`;
					taxEl.appendChild(div);
				});
			}
			if(result.rounding_adjustment&&result.rounding_adjustment!==0){
				const div=document.createElement('div');
				div.className='tax-row';
				div.innerHTML=`<span class="tax-key">Rounding</span><span>${fmt(result.rounding_adjustment)}</span>`;
				taxEl.appendChild(div);
			}
			const discRow=document.getElementById('discount-row');
			if(result.discount_amount&&result.discount_amount>0){
				document.getElementById('sum-discount').textContent=fmt(result.discount_amount);
				discRow.style.display='flex';
			}else{
				discRow.style.display='none';
			}
			const displayTotal=result.disable_rounded_total?result.grand_total:result.rounded_total;
			document.getElementById('sum-grand').textContent=fmt(displayTotal);
			currentGrandTotal=displayTotal;
		}catch(e){console.warn('Failed to refresh totals:',e.message)}
	},300);
}

function actionMarkup(code,forModal){
  const inCart=cart[code];
  const cardOos=isCardOos(code);
  const canMore=displayedAvailable(code)>0;
  const listStyle=currentView==='list'?' style="font-size:11px;padding:5px 8px"':'';
  const avail=displayedAvailable(code);

  if(cardOos){
    return`<button class="add-btn"${listStyle} disabled>OOS</button>`;
  }else if(inCart){
    const plusDis=!canMore?' disabled style="opacity:.45;cursor:not-allowed"':'';
    return`<div class="qty-ctrl"><button class="qty-btn" data-item-code="${code}" data-delta="-1">−</button><input type="text" inputmode="numeric" pattern="[0-9]*" class="qty-num" data-item-code="${code}" value="${inCart.qty}" aria-label="Quantity"><button class="qty-btn" data-item-code="${code}" data-delta="1"${plusDis}>+</button></div>`;
  }else if(forModal||pendingAdd.has(code)){
    const minusDis=' disabled style="opacity:.45;cursor:not-allowed"';
    const plusDis=avail<=1?' disabled style="opacity:.45;cursor:not-allowed"':'';
    return`<div class="qty-ctrl"><button class="qty-btn" data-item-code="${code}" data-delta="-1"${minusDis}>−</button><input type="text" inputmode="numeric" pattern="[0-9]*" class="qty-num" data-item-code="${code}" value="1" aria-label="Quantity"><button class="qty-btn" data-item-code="${code}" data-delta="1"${plusDis}>+</button><button class="add-btn" data-item-code="${code}" data-action="save">Save</button></div>`;
  }else{
    return`<button class="add-btn" data-item-code="${code}" data-action="add">Add</button>`;
  }
}

function refreshCard(code){
  const actionEl=document.getElementById('action-'+CSS.escape(code));
  const stockEl=document.getElementById('stock-'+CSS.escape(code));
  if(!actionEl)return;
  const item=allItems.find(i=>i.name===code);if(!item)return;
  const inCart=cart[code];
  const cardOos=isCardOos(code);
  const canMore=displayedAvailable(code)>0;

  actionEl.innerHTML=actionMarkup(code);

  if(stockEl){
    const wh=getWarehouse();
    const uom=item.stock_uom||'ea';
    if(STOCK_VALIDATION_DISABLED){
      if(wh){
        const availMap=item.warehouse_available||{};
        const stockMap=item.warehouse_stocks||{};
        const qty=availMap[wh]!==undefined?availMap[wh]:(stockMap[wh]!==undefined?stockMap[wh]:0);
        stockEl.innerHTML=`<span class="item-stock">${qty} ${uom}</span>`;
      }else{
        stockEl.innerHTML=`<span class="item-stock" style="color:#9CA3AF;font-size:10px">Select wh</span>`;
      }
    }else{
      const avail=displayedAvailable(code);
      if(!item.any_stock){
        stockEl.innerHTML='';
      }else if(wh){
        if(avail>0)stockEl.innerHTML=`<span class="item-stock${avail<5?' low':''}">${avail} ${uom}</span>`;
        else if(inCart)stockEl.innerHTML=`<span class="item-stock" style="color:#F59E0B;font-size:10.5px">Max in cart</span>`;
        else stockEl.innerHTML=`<span class="item-stock" style="color:#9CA3AF;font-size:10px">All reserved</span>`;
      }else{
        stockEl.innerHTML=`<span class="item-stock" style="color:#9CA3AF;font-size:10px">Select wh</span>`;
      }
    }
  }

  const cardEl=document.getElementById('card-'+CSS.escape(code));
  if(cardEl){
    cardEl.classList.toggle('oos',cardOos);
    const imgEl=cardEl.querySelector('.item-img')||cardEl.querySelector('.item-row');
    if(imgEl&&currentView==='grid'){
      let badge=imgEl.querySelector('.oos-badge');
      if(cardOos&&!badge){badge=document.createElement('div');badge.className='oos-badge';badge.textContent='OOS';imgEl.appendChild(badge);}
      else if(!cardOos&&badge)badge.remove();
    }
  }

  if(modalItemCode===code){
    const modalAction=document.getElementById('item-modal-action');
    if(modalAction)modalAction.innerHTML=actionMarkup(code,true);
  }
}

function updateCartUI(){
  const items=Object.values(cart);
  const cartEl=document.getElementById('cart-items');
  const tabBtn=document.getElementById('cart-tab-btn');

  if(tabBtn)tabBtn.textContent=`Cart (${items.length})`;

  if(!items.length){
    cartEl.innerHTML=`<div class="no-items"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>No items yet.<br>Add products from the catalog.</div>`;
    refreshTotals();
    return;
  }

  cartEl.innerHTML=items.map(({item,qty,discountType,discountValue,rate})=>{
    const code=item.name;
    const minusDis=qty<=1?' disabled style="opacity:.45;cursor:not-allowed"':'';
    const plusDis=displayedAvailable(code)<=0?' disabled style="opacity:.45;cursor:not-allowed"':'';
    const discInputDis=!discountType?' disabled':'';
    const discInputMax=discountType==='Percentage'?' max="100"':'';
    return`<div class="cart-item">
      <div class="cart-item-info"><div class="cart-item-name">${item.item_name}</div><div class="cart-item-price"><input type="number" class="cart-item-rate-input" data-item-code="${code}" min="0" step="0.01" value="${rate!==undefined?rate:item.standard_rate}" aria-label="Rate"> / ${item.stock_uom||'ea'}</div><div class="qty-ctrl cart-qty-ctrl"><button class="qty-btn cart-qty-btn" data-item-code="${code}" data-delta="-1"${minusDis}>−</button><input type="text" inputmode="numeric" pattern="[0-9]*" class="qty-num cart-qty-num" data-item-code="${code}" value="${qty}" aria-label="Quantity"><button class="qty-btn cart-qty-btn" data-item-code="${code}" data-delta="1"${plusDis}>+</button></div></div>
      <div class="item-discount-ctrl"><select class="item-disc-type" data-item-code="${code}"><option value="">No disc.</option><option value="Percentage"${discountType==='Percentage'?' selected':''}>Percentage</option><option value="Amount"${discountType==='Amount'?' selected':''}>Amount</option></select><input type="number" class="item-disc-value" data-item-code="${code}" min="0" value="${discountValue}"${discInputDis}${discInputMax}></div>
      <div class="cart-item-total" data-item-code="${code}">QAR 0.00</div>
      <button class="cart-remove" data-item-code="${item.name}" title="Remove">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
      </button>
    </div>`;
  }).join('');
  refreshTotals();
}

/* ── Confirmation modal ──────────────────────────────────── */
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
function cartHasItems(){return Object.keys(cart).length>0}

function _fmtAddressLabel(a){
  return [a.address_title, a.address_line1, a.address_line2, a.city, a.state, a.country, a.pincode].filter(Boolean).join(', ');
}

function _renderAddressCard(a, targetElId){
  const el=document.getElementById(targetElId);
  if(!el)return;
  if(!a){el.style.display='none';el.innerHTML='';return}
  const lines=[a.address_line1, a.address_line2, [a.city,a.state].filter(Boolean).join(', '), [a.country,a.pincode].filter(Boolean).join(' ')].filter(Boolean);
  el.innerHTML=`<div class="addr-card-title">${esc(a.address_title||'')}</div>`+lines.map(l=>`<div class="addr-card-line">${esc(l)}</div>`).join('');
  el.style.display='block';
}

function _populateAddressSelect(sel, addresses){
  sel.innerHTML='<option value="">Select address…</option>';
  addresses.forEach(a=>{
    const o=document.createElement('option');
    o.value=a.name;o.textContent=_fmtAddressLabel(a);
    sel.appendChild(o);
  });
}

async function loadCustomerAddresses(){
  if(!CUSTOMER_ID)return;
  const billLoad=document.getElementById('billing-address-loading');
  const billNone=document.getElementById('billing-address-none-msg');
  const billSel=document.getElementById('billing-address-select');
  const shipLoad=document.getElementById('shipping-address-loading');
  const shipNone=document.getElementById('shipping-address-none-msg');
  const shipSel=document.getElementById('shipping-address-select');

  let addresses=null;
  try{ addresses=await get('dms.api.sales.get_customer_addresses',{customer:CUSTOMER_ID}); }
  catch(e){ addresses=null; }

  customerAddresses=addresses||[];
  if(billLoad)billLoad.style.display='none';
  if(shipLoad)shipLoad.style.display='none';

  if(!customerAddresses.length){
    if(billNone)billNone.style.display='block';
    if(shipNone)shipNone.style.display='block';
    return;
  }

  if(billSel){_populateAddressSelect(billSel,customerAddresses);billSel.style.display='block'}
  if(shipSel){_populateAddressSelect(shipSel,customerAddresses);shipSel.style.display='block'}

  if(customerAddresses.length===1){
    selectedBillingAddress=customerAddresses[0].name;
    if(billSel)billSel.value=selectedBillingAddress;
  }
  _renderAddressCard(customerAddresses.find(a=>a.name===selectedBillingAddress)||null,'billing-address-card');

  shippingSameAsBilling=true;
  applyShippingMirror();
}

function applyShippingMirror(){
  const cb=document.getElementById('shipping-same-checkbox');
  const shipSel=document.getElementById('shipping-address-select');
  if(cb)cb.checked=shippingSameAsBilling;
  if(shipSel)shipSel.disabled=shippingSameAsBilling;
  if(shippingSameAsBilling){
    selectedShippingAddress=selectedBillingAddress;
    if(shipSel)shipSel.value=selectedBillingAddress;
  }
  _renderAddressCard(customerAddresses.find(a=>a.name===selectedShippingAddress)||null,'shipping-address-card');
}

/* ── Item detail modal ────────────────────────────────────── */
function openItemModal(code){
  modalItemCode=code;
  renderItemModal();
  const overlay=document.getElementById('item-modal-overlay');
  if(overlay)setTimeout(()=>overlay.classList.add('open'),10);
}

function closeItemModal(){
  const overlay=document.getElementById('item-modal-overlay');
  if(overlay)overlay.classList.remove('open');
  modalItemCode=null;
}

function renderItemModal(){
  if(!modalItemCode)return;
  const item=allItems.find(i=>i.name===modalItemCode);
  if(!item)return;

  const imgEl=document.getElementById('item-modal-img');
  if(imgEl){
    if(item.image){
      imgEl.innerHTML=`<img src="${esc(item.image)}" alt="" onerror="this.style.display='none'">`;
    }else{
      imgEl.innerHTML=itemIcon(item.item_group);
    }
  }

  const nameEl=document.getElementById('item-modal-name');
  if(nameEl)nameEl.textContent=item.item_name;

  const priceEl=document.getElementById('item-modal-price');
  if(priceEl)priceEl.textContent=fmt(item.standard_rate);

  const descEl=document.getElementById('item-modal-desc');
  if(descEl){
    if(item.description){
      const plain=item.description.replace(/<[^>]*>/g,'').trim();
      if(plain){
        descEl.textContent=plain;
        descEl.classList.add('show');
      }else{
        descEl.classList.remove('show');
      }
    }else{
      descEl.classList.remove('show');
    }
  }

  const actionEl=document.getElementById('item-modal-action');
  if(actionEl)actionEl.innerHTML=actionMarkup(modalItemCode,true);
}

function validateQuotationInputs(){
	const items=Object.values(cart);
	if(!items.length){alert('Add at least one item.');return false}
	if(!CUSTOMER_ID){alert('No customer selected.');return false}
	const wh=getWarehouse();
	if(!wh){alert('Select a warehouse first.');return false}
	const qDate=document.getElementById('quotation-date').value;
	if(qDate&&qDate<new Date().toISOString().slice(0,10)){alert('Quotation date cannot be a past date.');return false}
	const validTill=document.getElementById('valid-till').value;
	if(validTill&&validTill<new Date().toISOString().slice(0,10)){alert('Valid until cannot be a past date.');return false}
	return true;
}
function buildQuotationPayload(){
	const items=Object.values(cart);
	const itemsData=items.map(({item,qty,discountType,discountValue,rate})=>{
		const row={item_code:item.name,qty,rate:rate!==undefined?rate:item.standard_rate};
		if(discountType)row.discount_type=discountType,row.discount_value=discountValue;
		return row;
	});
	return {
		customer:CUSTOMER_ID,
		warehouse:getWarehouse(),
		items_json:JSON.stringify(itemsData),
		transaction_date:document.getElementById('quotation-date').value||'',
		valid_till:document.getElementById('valid-till').value||'',
		customer_address:selectedBillingAddress||'',
		shipping_address:(shippingSameAsBilling ? selectedBillingAddress : selectedShippingAddress)||'',
		additional_discount_type:orderDiscountType,
		additional_discount_value:orderDiscountValue,
		terms:document.getElementById('quotation-terms').value||''
	};
}

async function createQuotation(){
	if(!validateQuotationInputs())return;
	const btn=document.getElementById('create-btn');
	btn.disabled=true;btn.textContent='Creating…';
	try{
		const result=await post('dms.api.quotation_create.create_quotation',buildQuotationPayload());
		const total=result.disable_rounded_total?result.grand_total:result.rounded_total;
		alert(`Quotation ${result.name} created as draft! Total: ${fmt(total)}`);
		cart={};updateCartUI();
		window.location.href=`/sales-customer?customer=${CUSTOMER_ID}`;
	}catch(e){alert('Error: '+e.message)}
	finally{btn.disabled=false;btn.textContent='Create Quotation'}
}

(async function(){
	const createBtn=document.getElementById('create-btn');
	if(!CUSTOMER_ID&&createBtn){
		createBtn.disabled=true;
	}
	const _todayStr=(()=>{const d=new Date();const y=d.getFullYear();const m=String(d.getMonth()+1).padStart(2,'0');const day=String(d.getDate()).padStart(2,'0');return`${y}-${m}-${day}`})();
	const dateEl=document.getElementById('quotation-date');
	if(dateEl){dateEl.min=_todayStr;dateEl.value=_todayStr;}
	const validTillEl=document.getElementById('valid-till');
	if(validTillEl)validTillEl.min=_todayStr;
	document.getElementById('warehouse-select')?.addEventListener('change',onWarehouseChange);
	document.getElementById('mob-warehouse-select')?.addEventListener('change',onMobWarehouseChange);
	document.getElementById('mob-warehouse-select-2')?.addEventListener('change',onMobWarehouseChange2);
	document.getElementById('item-search')?.addEventListener('input',onSearchInput);
	document.getElementById('instock-filter')?.addEventListener('change',applyFilters);
	document.getElementById('vt-grid')?.addEventListener('click',()=>setView('grid'));
	document.getElementById('vt-list')?.addEventListener('click',()=>setView('list'));
	document.querySelectorAll('.mob-tab').forEach(el=>el.addEventListener('click',e=>setMobTab(e.currentTarget.dataset.tab)));
	document.querySelectorAll('#desk-cat-list .cat-item').forEach(el=>el.addEventListener('click',()=>filterGroup(el.dataset.group)));
	document.querySelectorAll('#mob-cat-strip .cat-chip').forEach(el=>el.addEventListener('click',()=>filterGroup(el.dataset.group)));
	document.getElementById('mob-cat-select')?.addEventListener('change',e=>filterGroup(e.currentTarget.value));
	document.querySelectorAll('.wh-peek-btn').forEach(el=>el.addEventListener('click',e=>showWhPopup(e,el.dataset.itemCode)));
	document.addEventListener('click',e=>{
		if(e.target.classList.contains('add-btn')){
			const code=e.target.dataset.itemCode;
			const action=e.target.dataset.action;
			if(action==='add'){pendingAdd.add(code);refreshCard(code);}
			else if(action==='save'){addToCart(code,parseInt(e.target.parentElement.querySelector('.qty-num').value,10)||1);pendingAdd.delete(code);}
		}else if(e.target.classList.contains('qty-btn')){
			const code=e.target.dataset.itemCode;
			const delta=parseInt(e.target.dataset.delta,10);
			if(!cart[code]){
				const input=e.target.closest('.qty-ctrl').querySelector('.qty-num');
				if(!input)return;
				let n=parseInt(input.value,10)||1;
				n=Math.min(Math.max(1,n+delta),displayedAvailable(code));
				input.value=n;
				const minusBtn=e.target.closest('.qty-ctrl').querySelector('button[data-delta="-1"]');
				const plusBtn=e.target.closest('.qty-ctrl').querySelector('button[data-delta="1"]');
				if(minusBtn)minusBtn.style.opacity=n<=1?'.45':'1',minusBtn.disabled=n<=1;
				if(plusBtn)plusBtn.style.opacity=n>=displayedAvailable(code)?'.45':'1',plusBtn.disabled=n>=displayedAvailable(code);
				return;
			}
			changeQty(code,delta);
		}else if(e.target.classList.contains('qty-num')){
			const code=e.target.dataset.itemCode;
			e.target.addEventListener('blur',()=>setQty(code,e.target.value),{once:true});
		}else if(e.target.classList.contains('item-disc-type')){
			const code=e.target.dataset.itemCode;
			const discType=e.target.value;
			if(cart[code]){
				cart[code].discountType=discType;
				if(!discType)cart[code].discountValue=0;
				updateCartUI();
			}
		}else if(e.target.classList.contains('item-disc-value')){
			const code=e.target.dataset.itemCode;
			e.target.addEventListener('blur',()=>{
				if(cart[code])cart[code].discountValue=parseFloat(e.target.value)||0;
				refreshTotals();
			},{once:true});
		}else if(e.target.classList.contains('cart-qty-num')){
			const code=e.target.dataset.itemCode;
			e.target.addEventListener('blur',()=>setQty(code,e.target.value),{once:true});
		}else if(e.target.classList.contains('cart-item-rate-input')){
			const code=e.target.dataset.itemCode;
			e.target.addEventListener('input',()=>{
				const newRate=parseFloat(e.target.value)||0;
				if(cart[code]){cart[code].rate=newRate;refreshTotals();}
			});
		}else if(e.target.classList.contains('cart-qty-btn')){
			const code=e.target.dataset.itemCode;
			const delta=parseInt(e.target.dataset.delta,10);
			changeQty(code,delta);
		}else if(e.target.classList.contains('cart-remove')){
			removeFromCart(e.target.dataset.itemCode);
		}else if(e.currentTarget.classList.contains('item-card')||e.currentTarget.classList.contains('item-row-wrap')){
			if(e.target.classList.contains('item-name')||e.target.classList.contains('item-row-name')||e.target.classList.contains('item-modal-overlay')){
				const code=(e.currentTarget.dataset.itemCode||e.target.closest('[data-item-code]')?.dataset.itemCode);
				if(code)openItemModal(code);
			}
		}
	});
	document.getElementById('item-modal-overlay')?.addEventListener('click',e=>{
		if(e.target.id==='item-modal-overlay')closeItemModal();
	});
	document.getElementById('item-modal-close')?.addEventListener('click',closeItemModal);
	document.getElementById('order-discount-type')?.addEventListener('change',e=>{
		orderDiscountType=e.currentTarget.value;
		const valEl=document.getElementById('order-discount-value');
		if(valEl)valEl.disabled=!e.currentTarget.value;
		refreshTotals();
	});
	document.getElementById('order-discount-value')?.addEventListener('input',e=>{
		orderDiscountValue=parseFloat(e.currentTarget.value)||0;
		refreshTotals();
	});
	document.getElementById('billing-address-select')?.addEventListener('change',e=>{
		selectedBillingAddress=e.currentTarget.value;
		_renderAddressCard(customerAddresses.find(a=>a.name===selectedBillingAddress)||null,'billing-address-card');
		applyShippingMirror();
		refreshTotals();
	});
	document.getElementById('shipping-same-checkbox')?.addEventListener('change',e=>{
		shippingSameAsBilling=e.currentTarget.checked;
		applyShippingMirror();
		refreshTotals();
	});
	document.getElementById('shipping-address-select')?.addEventListener('change',e=>{
		selectedShippingAddress=e.currentTarget.value;
		_renderAddressCard(customerAddresses.find(a=>a.name===selectedShippingAddress)||null,'shipping-address-card');
		refreshTotals();
	});
	document.getElementById('valid-till')?.addEventListener('change',refreshTotals);
	document.getElementById('create-btn')?.addEventListener('click',createQuotation);
	const logoutBtn=document.querySelector('.logout-btn');
	if(logoutBtn){
		logoutBtn.addEventListener('click',e=>{
			e.preventDefault();
			const overlay=document.getElementById('logout-confirm-overlay');
			const confirmBtn=document.getElementById('logout-confirm-btn');
			const cancelBtn=document.getElementById('logout-cancel-btn');
			if(overlay)overlay.classList.add('open');
			confirmBtn?.addEventListener('click',()=>{window.location.href='/sales-logout'},{once:true});
			cancelBtn?.addEventListener('click',()=>{if(overlay)overlay.classList.remove('open')},{once:true});
		});
	}
	document.getElementById('sidebar-toggle')?.addEventListener('click',()=>{
		document.body.classList.toggle('sidebar-expanded');
	});
	const warehouses=await get('dms.api.sales.get_warehouses');
	if(warehouses&&warehouses.length){
		const opts=warehouses.map(w=>{const o=document.createElement('option');o.value=w.name;o.textContent=w.warehouse_name||w.name;return o});
		const defaultWh=warehouses[0].name;
		['warehouse-select','mob-warehouse-select','mob-warehouse-select-2'].forEach(id=>{
			const sel=document.getElementById(id);if(!sel)return;
			opts.forEach(o=>sel.appendChild(o.cloneNode(true)));
			sel.value=defaultWh;
		});
	}
	const itemGroups=await get('dms.api.sales.get_item_groups');
	if(itemGroups){
		groups=itemGroups;
		const deskCat=document.getElementById('desk-cat-list');
		const mobCat=document.getElementById('mob-cat-select');
		itemGroups.forEach(g=>{
			if(deskCat){
				const div=document.createElement('div');
				div.className='cat-item';
				div.dataset.group=g.name;
				div.innerHTML=`<span>${esc(g.name)}</span><span class="cat-count" id="cat-count-${CSS.escape(g.name)}">—</span>`;
				deskCat.appendChild(div);
				div.addEventListener('click',()=>filterGroup(g.name));
			}
			if(mobCat){
				const o=document.createElement('option');
				o.value=g.name;
				o.textContent=g.name;
				mobCat.appendChild(o);
			}
		});
	}
	const wh=warehouses&&warehouses.length?warehouses[0].name:'';
	const itemsData=await get('dms.api.sales.get_items',{warehouse:wh});
	if(itemsData){
		allItems=itemsData;
		applyFilters();
		groups.forEach(g=>{
			const cnt=allItems.filter(i=>i.item_group===g.name).length;
			const el=document.getElementById('cat-count-'+CSS.escape(g.name));
			if(el)el.textContent=cnt;
		});
		document.getElementById('cat-count-all').textContent=allItems.length;
	}
	if(CUSTOMER_ID){
		await loadCustomerAddresses();
		if(itemsData)refreshTotals();
	}
})();
