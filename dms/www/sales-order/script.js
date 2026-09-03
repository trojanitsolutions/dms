const IS_DESKTOP = () => (window.innerWidth >= 1200 && matchMedia('(pointer: fine)').matches) || window.innerWidth >= 1367;
const CUSTOMER_ID = window.pageData?.customer || '';
const CUSTOMER_NAME = window.pageData?.customer_name || '';
const ORDER_NAME = window.pageData?.order || '';
const QUOTATION_NAME = window.pageData?.quotation || '';
const LOCKED_ITEMS = !!QUOTATION_NAME;
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

let allItems=[],filteredItems=[],cart={},activeGroup='All',groups=[];
let creditInfo=null,currentGrandTotal=0;
let customerStatus={disabled:false,is_frozen:false};
let currentView=sessionStorage.getItem('itemView')||'grid';
let activeWhPopup=null;
const RENDER_BATCH=100;
let renderedCount=0;
let scrollSentinel=null,sentinelObserver=null;
let modalItemCode=null;
let orderDiscountType='',orderDiscountValue=0;
let STOCK_VALIDATION_DISABLED=false;
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
    // fresh render — clear container and paint first batch
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
  // DEBUG: Log filter state
  console.log(`DEBUG applyFilters: instockOnly=${instockOnly}, wh="${wh}", activeGroup="${activeGroup}", total_items=${allItems.length}, items_with_stock=${allItems.filter(i=>i.any_stock).length}`);
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
  console.log(`DEBUG applyFilters result: filtered_count=${filteredItems.length}`);
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
		updateCreditWarning();
		return;
	}
	totalsTimer=setTimeout(async()=>{
		try{
			const wh=getWarehouse();
			const itemsData=items.map(({item,qty,discountType,discountValue})=>{
				const row={item_code:item.name,qty,rate:item.standard_rate};
				if(discountType)row.discount_type=discountType,row.discount_value=discountValue;
				return row;
			});
			const result=await post('dms.api.sales.get_order_totals',{
				customer:CUSTOMER_ID,
				warehouse:wh,
				items_json:JSON.stringify(itemsData),
				delivery_date:document.getElementById('delivery-date').value||'',
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
			updateCreditWarning();
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

  // Update action buttons
  actionEl.innerHTML=actionMarkup(code);

  // Update stock label
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

  // Toggle OOS state on card
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

  // Sync modal action cell if this item is currently open
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

  cartEl.innerHTML=items.map(({item,qty,discountType,discountValue})=>{
    const code=item.name;
    const minusDis=qty<=1?' disabled style="opacity:.45;cursor:not-allowed"':'';
    const plusDis=displayedAvailable(code)<=0?' disabled style="opacity:.45;cursor:not-allowed"':'';
    const discInputDis=!discountType||LOCKED_ITEMS?' disabled':'';
    const discInputMax=discountType==='Percentage'?' max="100"':'';
    const removeBtn=!LOCKED_ITEMS?`<button class="cart-remove" data-item-code="${item.name}" title="Remove">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
      </button>`:'';
    return`<div class="cart-item">
      <div class="cart-item-info"><div class="cart-item-name">${item.item_name}</div><div class="cart-item-price"><span class="cart-item-rate" data-item-code="${code}">${fmt(item.standard_rate)}</span> / ${item.stock_uom||'ea'}</div><div class="qty-ctrl cart-qty-ctrl"><button class="qty-btn cart-qty-btn" data-item-code="${code}" data-delta="-1"${minusDis}>−</button><input type="text" inputmode="numeric" pattern="[0-9]*" class="qty-num cart-qty-num" data-item-code="${code}" value="${qty}" aria-label="Quantity"><button class="qty-btn cart-qty-btn" data-item-code="${code}" data-delta="1"${plusDis}>+</button></div></div>
      <div class="item-discount-ctrl"><select class="item-disc-type" data-item-code="${code}"${LOCKED_ITEMS?' disabled':''}><option value="">No disc.</option><option value="Percentage"${discountType==='Percentage'?' selected':''}>Percentage</option><option value="Amount"${discountType==='Amount'?' selected':''}>Amount</option></select><input type="number" class="item-disc-value" data-item-code="${code}" min="0" value="${discountValue}"${discInputDis}${discInputMax}></div>
      <div class="cart-item-total" data-item-code="${code}">QAR 0.00</div>
      ${removeBtn}
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

/* ── Credit ──────────────────────────────────────────────── */
function updateCreditWarning(){
  const btn=document.getElementById('submit-btn');
  const warnEl=document.getElementById('credit-warning');
  // Never enable submit for disabled/frozen customers
  if(customerStatus.disabled||customerStatus.is_frozen){
    if(warnEl)warnEl.style.display='none';
    if(btn)btn.disabled=true;
    return;
  }
  if(!creditInfo||!creditInfo.credit_limit){
    if(warnEl)warnEl.style.display='none';
    if(btn)btn.disabled=Object.keys(cart).length===0;
    return;
  }
  const exceeded=currentGrandTotal>creditInfo.available_credit;
  if(warnEl)warnEl.style.display=exceeded?'flex':'none';
  if(btn)btn.disabled=exceeded||Object.keys(cart).length===0;
}

async function loadCreditInfo(){
  if(!CUSTOMER_ID)return;
  const info=await get('dms.api.sales.get_customer_credit',{customer:CUSTOMER_ID});
  if(!info)return;

  // Customer disabled / frozen
  customerStatus={disabled:!!info.disabled,is_frozen:!!info.is_frozen};
  if(customerStatus.disabled||customerStatus.is_frozen){
    const banner=document.getElementById('cust-status-banner');
    const msg=document.getElementById('cust-status-msg');
    if(banner&&msg){
      banner.className='cust-status-banner '+(customerStatus.disabled?'is-disabled':'is-frozen');
      msg.textContent=customerStatus.disabled
        ?'This customer is disabled. Sales Orders cannot be created.'
        :'This customer account is frozen. Sales Orders cannot be created.';
      banner.style.display='flex';
    }
    const btn=document.getElementById('submit-btn');
    if(btn)btn.disabled=true;
  }

  if(!info.credit_limit)return;
  creditInfo=info;
  const sec=document.getElementById('credit-section');
  if(sec)sec.style.display='block';
  document.getElementById('credit-limit-val').textContent=fmtN(info.credit_limit);
  document.getElementById('credit-outstanding-val').textContent=fmtN(info.outstanding);
  const avail=document.getElementById('credit-available-val');
  avail.textContent=fmtN(info.available_credit);
  avail.style.color=info.available_credit<=0?'#DC2626':'#16a34a';
  updateCreditWarning();
}

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

  // Image
  const imgEl=document.getElementById('item-modal-img');
  if(imgEl){
    if(item.image){
      imgEl.innerHTML=`<img src="${esc(item.image)}" alt="" onerror="this.style.display='none'">`;
    }else{
      imgEl.innerHTML=itemIcon(item.item_group);
    }
  }

  // Name
  const nameEl=document.getElementById('item-modal-name');
  if(nameEl)nameEl.textContent=item.item_name;

  // Price
  const priceEl=document.getElementById('item-modal-price');
  if(priceEl)priceEl.textContent=fmt(item.standard_rate);

  // Description (strip HTML, hide if empty)
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

  // Action cell
  const actionEl=document.getElementById('item-modal-action');
  if(actionEl)actionEl.innerHTML=actionMarkup(modalItemCode,true);
}

function validateOrderInputs(){
	const items=Object.values(cart);
	if(!items.length){alert('Add at least one item.');return false}
	if(!CUSTOMER_ID){alert('No customer selected.');return false}
	if(customerStatus.disabled){alert('This customer is disabled. Sales Orders cannot be created.');return false}
	if(customerStatus.is_frozen){alert('This customer account is frozen. Sales Orders cannot be created.');return false}
	const wh=getWarehouse();
	if(!wh){alert('Select a warehouse first.');return false}
	if(!LOCKED_ITEMS){
		const ddVal=document.getElementById('delivery-date').value;
		const _today=(()=>{const d=new Date();const y=d.getFullYear();const m=String(d.getMonth()+1).padStart(2,'0');const dy=String(d.getDate()).padStart(2,'0');return`${y}-${m}-${dy}`})();
		if(ddVal&&ddVal<_today){alert('Delivery date cannot be in the past.');return false}
	}
	if(creditInfo&&creditInfo.credit_limit>0&&currentGrandTotal>creditInfo.available_credit){
		alert(`Order total (${fmt(currentGrandTotal)}) exceeds available credit (${fmt(creditInfo.available_credit)}).`);
		return false;
	}
	return true;
}
function buildOrderPayload(){
	const items=Object.values(cart);
	const itemsData=items.map(({item,qty,discountType,discountValue})=>{
		const row={item_code:item.name,qty,rate:item.standard_rate};
		if(discountType)row.discount_type=discountType,row.discount_value=discountValue;
		return row;
	});
	return {
		customer:CUSTOMER_ID,
		warehouse:getWarehouse(),
		items_json:JSON.stringify(itemsData),
		delivery_date:document.getElementById('delivery-date').value||'',
		customer_address:selectedBillingAddress||'',
		shipping_address:(shippingSameAsBilling ? selectedBillingAddress : selectedShippingAddress)||'',
		additional_discount_type:orderDiscountType,
		additional_discount_value:orderDiscountValue,
		existing_order:ORDER_NAME
	};
}

function buildQuotationOrderPayload(){
	const items=Object.values(cart).map(({item,qty})=>({item_code:item.name,qty}));
	return {
		name:QUOTATION_NAME,
		items_json:JSON.stringify(items),
		customer_address:selectedBillingAddress||'',
		shipping_address:(shippingSameAsBilling ? selectedBillingAddress : selectedShippingAddress)||''
	};
}

function showOrderCreated(name,submitted){
	const cartPanel=document.getElementById('cart-panel');
	if(!cartPanel)return;
	const successPanel=document.createElement('div');
	successPanel.className='quotation-so-success-panel';
	const linkHref=submitted?'/order-history':`/sales-order?order=${encodeURIComponent(name)}`;
	const linkText=submitted?'View in Order History':name;
	successPanel.innerHTML=`<div class="quotation-so-success-title">${submitted?'Order Submitted':'Order Saved as Pending'}</div>
		<div class="quotation-so-success-msg">Sales Order <strong>${esc(name)}</strong> has been created.</div>
		<div style="margin-top:12px"><a href="${linkHref}" style="color:var(--color-primary);text-decoration:none;font-weight:500">${esc(linkText)}</a></div>`;
	cartPanel.innerHTML='';
	cartPanel.appendChild(successPanel);
}

async function submitOrder(){
	if(!validateOrderInputs())return;
	const ok=await confirmAction('Submit Sales Order','This will commit stock and cannot be undone. Submit this order now?','Submit');
	if(!ok)return;
	const btn=document.getElementById('submit-btn');
	btn.disabled=true;btn.textContent='Submitting…';
	try{
		const payload=LOCKED_ITEMS?buildQuotationOrderPayload():buildOrderPayload();
		const method=LOCKED_ITEMS?'dms.api.quotation.create_sales_order_from_quotation':'dms.api.sales.create_sales_order';
		const result=await post(method,{...payload,submit:true});
		if(LOCKED_ITEMS){
			showOrderCreated(result.name,true);
		}else{
			const total=result.disable_rounded_total?result.grand_total:result.rounded_total;
			alert(`Order ${result.name} submitted! Total: ${fmt(total)}`);
			cart={};updateCartUI();
			window.location.href=`/sales-customer?customer=${CUSTOMER_ID}`;
		}
	}catch(e){alert('Error: '+e.message)}
	finally{btn.disabled=false;btn.textContent='Submit Sales Order'}
}

async function saveOrder(){
	if(!validateOrderInputs())return;
	const ok=await confirmAction('Save as Pending Order','Save this order as a draft you can submit later from Pending Orders?','Save');
	if(!ok)return;
	const btn=document.getElementById('save-btn');
	btn.disabled=true;btn.textContent='Saving…';
	try{
		const payload=LOCKED_ITEMS?buildQuotationOrderPayload():buildOrderPayload();
		const method=LOCKED_ITEMS?'dms.api.quotation.create_sales_order_from_quotation':'dms.api.sales.create_sales_order';
		const result=await post(method,{...payload,submit:false});
		if(LOCKED_ITEMS){
			showOrderCreated(result.name,false);
		}else{
			alert(`Order ${result.name} saved as pending.`);
			cart={};updateCartUI();
			window.location.href='/pending-orders';
		}
	}catch(e){alert('Error: '+e.message)}
	finally{btn.disabled=false;btn.textContent='Save'}
}

/* ── Init ────────────────────────────────────────────────── */
(async function(){
  // Delivery date: default = today, min = today, prevent past dates
  const _todayStr=(()=>{const d=new Date();const y=d.getFullYear();const m=String(d.getMonth()+1).padStart(2,'0');const day=String(d.getDate()).padStart(2,'0');return`${y}-${m}-${day}`})();
  const ddInput=document.getElementById('delivery-date');
  ddInput.min=_todayStr;
  ddInput.value=_todayStr;
  ddInput.addEventListener('change',function(){
    const errEl=document.getElementById('delivery-date-err');
    if(this.value<_todayStr){this.value=_todayStr;if(errEl)errEl.style.display='block';setTimeout(()=>{if(errEl)errEl.style.display='none'},3000);}
    else{if(errEl)errEl.style.display='none';refreshTotals();}
  });

  // Billing address select change handler
  const billSel=document.getElementById('billing-address-select');
  if(billSel){
    billSel.addEventListener('change',function(){
      selectedBillingAddress=this.value;
      _renderAddressCard(customerAddresses.find(a=>a.name===selectedBillingAddress)||null,'billing-address-card');
      if(shippingSameAsBilling)applyShippingMirror();
      refreshTotals();
    });
  }
  // Shipping same-as-billing checkbox handler
  const sameCb=document.getElementById('shipping-same-checkbox');
  if(sameCb){
    sameCb.addEventListener('change',function(){
      shippingSameAsBilling=this.checked;
      applyShippingMirror();
      refreshTotals();
    });
  }
  // Shipping address select change handler
  const shipSel=document.getElementById('shipping-address-select');
  if(shipSel){
    shipSel.addEventListener('change',function(){
      selectedShippingAddress=this.value;
      _renderAddressCard(customerAddresses.find(a=>a.name===selectedShippingAddress)||null,'shipping-address-card');
      refreshTotals();
    });
  }

  // Order-level discount handlers
  const orderDiscType=document.getElementById('order-discount-type');
  if(orderDiscType){
    orderDiscType.addEventListener('change',function(){
      orderDiscountType=this.value;
      const valInput=document.getElementById('order-discount-value');
      if(valInput){
        valInput.disabled=!this.value;
        if(this.value==='Percentage')valInput.max='100';
        else valInput.removeAttribute('max');
        if(!this.value)valInput.value='0',orderDiscountValue=0;
      }
      refreshTotals();
    });
  }
  const orderDiscVal=document.getElementById('order-discount-value');
  if(orderDiscVal){
    orderDiscVal.addEventListener('change',function(){
      orderDiscountValue=parseFloat(this.value)||0;
      refreshTotals();
    });
  }

  // Restore view preference
  setView(currentView);

  // Restore in-stock filter preference
  const _savedInstock=sessionStorage.getItem('instockFilter')==='1';
  const _instockEl=document.getElementById('instock-filter');
  if(_instockEl)_instockEl.checked=_savedInstock;

  // Load sales settings
  const sSettings=await get('dms.api.sales.get_sales_settings');
  STOCK_VALIDATION_DISABLED=!!sSettings?.disable_stock_validation;
  if(STOCK_VALIDATION_DISABLED){
    const filterRow=document.getElementById('instock-filter-row');
    if(filterRow)filterRow.style.display='none';
  }

  // Fetch reopen detail if order or quotation is set
  let reopenDetail=null;
  if(ORDER_NAME){
    reopenDetail=await get('dms.api.sales.get_pending_order_detail',{name:ORDER_NAME});
    while(!reopenDetail){
      const retry=await confirmAction(
        'Failed to Load Order',
        'Could not load the saved items for this order. Retry loading, or go back to Pending Orders?',
        'Retry'
      );
      if(!retry){window.location.href='/pending-orders';return}
      reopenDetail=await get('dms.api.sales.get_pending_order_detail',{name:ORDER_NAME});
    }
  }else if(QUOTATION_NAME){
    reopenDetail=await get('dms.api.quotation.get_quotation_for_sales_order',{name:QUOTATION_NAME});
    while(!reopenDetail){
      const retry=await confirmAction(
        'Failed to Load Quotation',
        'Could not load items for this quotation. Retry, or go back to Quotation History?',
        'Retry'
      );
      if(!retry){window.location.href='/quotation-history';return}
      reopenDetail=await get('dms.api.quotation.get_quotation_for_sales_order',{name:QUOTATION_NAME});
    }
  }

  // Initial mobile tab state
  if(!IS_DESKTOP())setMobTab('catalog');

  // Load warehouses
  const warehouses=await get('dms.api.sales.get_warehouses');
  if(warehouses&&warehouses.length){
    const opts=warehouses.map(w=>{const o=document.createElement('option');o.value=w.name;o.textContent=w.warehouse_name||w.name;return o});
    const defaultWh=reopenDetail?.warehouse||sSettings?.default_warehouse||warehouses[0].name;
    ['warehouse-select','mob-warehouse-select','mob-warehouse-select-2'].forEach(id=>{
      const sel=document.getElementById(id);if(!sel)return;
      opts.forEach(o=>sel.appendChild(o.cloneNode(true)));
      sel.value=defaultWh;
    });
  }

  // Load item groups — build desktop sidebar + mobile chips simultaneously
  const ig=await get('dms.api.sales.get_item_groups');
  groups=ig||[];
  const deskList=document.getElementById('desk-cat-list');
  const mobStrip=document.getElementById('mob-cat-strip');
  const mobCatSel=document.getElementById('mob-cat-select');
  groups.forEach(g=>{
    // Desktop sidebar
    const div=document.createElement('div');
    div.className='cat-item';div.dataset.group=g.name;
    div.innerHTML=`<span>${g.name}</span><span class="cat-count" id="cat-count-${CSS.escape(g.name)}">—</span>`;
    deskList.appendChild(div);
    // Mobile chip strip (kept in DOM, hidden via CSS)
    const btn=document.createElement('button');
    btn.className='cat-chip';btn.dataset.group=g.name;
    btn.textContent=g.name;
    mobStrip.appendChild(btn);
    // Mobile category select
    if(mobCatSel){const opt=document.createElement('option');opt.value=g.name;opt.textContent=g.name;mobCatSel.appendChild(opt);}
  });

  // Load items
  const wh=reopenDetail?.warehouse||(warehouses&&warehouses.length?warehouses[0].name:'');
  const data=await get('dms.api.sales.get_items',{warehouse:wh});
  allItems=data||[];filteredItems=allItems;
  renderedCount=0;
  renderItems(filteredItems);
  document.getElementById('cat-count-all').textContent=allItems.length;
  groups.forEach(g=>{
    const cnt=allItems.filter(i=>i.item_group===g.name).length;
    const el=document.getElementById('cat-count-'+CSS.escape(g.name));
    if(el)el.textContent=cnt;
  });

  // Populate cart from reopened order's items
  if(reopenDetail&&reopenDetail.items){
    reopenDetail.items.forEach(it=>{
      const item=allItems.find(i=>i.name===it.item_code);
      if(!item)return;
      cart[it.item_code]={item,qty:it.qty,discountType:it.discount_type||'',discountValue:it.discount_value||0};
    });
  }

  // Set delivery date from reopened order
  if(reopenDetail?.delivery_date){
    const ddInput=document.getElementById('delivery-date');
    if(ddInput)ddInput.value=reopenDetail.delivery_date;
  }

  // Set order-level discount from reopened order
  if(reopenDetail){
    orderDiscountType=reopenDetail.additional_discount_type||'';
    orderDiscountValue=reopenDetail.additional_discount_value||0;
    const orderDiscType=document.getElementById('order-discount-type');
    const orderDiscVal=document.getElementById('order-discount-value');
    if(orderDiscType){
      orderDiscType.value=orderDiscountType;
      if(orderDiscVal){
        orderDiscVal.disabled=!orderDiscountType;
        if(orderDiscountType==='Percentage')orderDiscVal.max='100';
        else orderDiscVal.removeAttribute('max');
        orderDiscVal.value=orderDiscountValue;
      }
    }
  }

  // Load credit info
  await loadCreditInfo();
  // Load customer addresses
  await loadCustomerAddresses();

  // Populate billing/shipping addresses from reopened order
  if(reopenDetail){
    const billingAddr=reopenDetail.customer_address;
    const shippingAddr=reopenDetail.shipping_address;
    if(billingAddr){
      selectedBillingAddress=billingAddr;
      const billSel=document.getElementById('billing-address-select');
      if(billSel)billSel.value=billingAddr;
      const billAddr=customerAddresses.find(a=>a.name===billingAddr);
      _renderAddressCard(billAddr||null,'billing-address-card');
    }
    if(shippingAddr){
      selectedShippingAddress=shippingAddr;
      const shipSel=document.getElementById('shipping-address-select');
      if(shipSel)shipSel.value=shippingAddr;
      const shipAddr=customerAddresses.find(a=>a.name===shippingAddr);
      _renderAddressCard(shipAddr||null,'shipping-address-card');
    }
  }

  // Apply locking for quotation-derived orders
  if(LOCKED_ITEMS){
    // Disable warehouse, discounts, delivery date
    ['warehouse-select','mob-warehouse-select','mob-warehouse-select-2'].forEach(id=>{
      const el=document.getElementById(id);if(el)el.disabled=true;
    });
    const ddInput=document.getElementById('delivery-date');
    if(ddInput)ddInput.disabled=true;
    const discType=document.getElementById('order-discount-type');
    const discVal=document.getElementById('order-discount-value');
    if(discType)discType.disabled=true;
    if(discVal)discVal.disabled=true;

    // Hide catalog, show only cart on mobile
    const catalogPanel=document.getElementById('catalog-panel');
    if(catalogPanel)catalogPanel.style.display='none';
    const sidebarCat=document.querySelector('.desk-cat-sidebar');
    if(sidebarCat)sidebarCat.style.display='none';
    const mobStrip=document.querySelector('.mob-cat-strip');
    if(mobStrip)mobStrip.style.display='none';
    const mobTabs=document.querySelector('.mob-tabs');
    if(mobTabs)mobTabs.style.display='none';
    const orderWrap=document.getElementById('order-wrap');
    if(orderWrap)orderWrap.classList.add('locked-items');
    if(!IS_DESKTOP())setMobTab('cart');

    // Add lock banner to cart
    const cartPanel=document.getElementById('cart-panel');
    if(cartPanel){
      const banner=document.createElement('div');
      banner.className='quotation-lock-banner';
      banner.innerHTML=`<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd"/></svg>
        <span>Pre-filled from Quotation <strong>${esc(QUOTATION_NAME)}</strong> — only quantities can be changed.</span>`;
      cartPanel.insertBefore(banner,cartPanel.firstChild);
    }
  }

  // Update cart and totals UI
  updateCartUI();
  refreshTotals();

  // Initial submit button state
  const btn=document.getElementById('submit-btn');
  if(btn)btn.disabled=!reopenDetail&&Object.keys(cart).length===0;

  // Modal close button
  const modalCloseBtn=document.getElementById('item-modal-close');
  if(modalCloseBtn)modalCloseBtn.addEventListener('click',closeItemModal);
})();

// Event listeners for static elements
document.querySelectorAll('.mob-tab').forEach(el=>{
  el.addEventListener('click',()=>setMobTab(el.dataset.tab));
});
document.getElementById('item-search').addEventListener('input',onSearchInput);
document.getElementById('warehouse-select').addEventListener('change',onWarehouseChange);
document.getElementById('mob-warehouse-select').addEventListener('change',onMobWarehouseChange);
document.getElementById('mob-warehouse-select-2').addEventListener('change',onMobWarehouseChange2);
document.getElementById('mob-cat-select').addEventListener('change',()=>filterGroup(document.getElementById('mob-cat-select').value));
document.getElementById('vt-grid').addEventListener('click',()=>setView('grid'));
document.getElementById('vt-list').addEventListener('click',()=>setView('list'));
document.getElementById('instock-filter').addEventListener('change',applyFilters);
const submitBtn=document.getElementById('submit-btn');
if(submitBtn)submitBtn.addEventListener('click',submitOrder);
const saveBtn=document.getElementById('save-btn');
if(saveBtn)saveBtn.addEventListener('click',saveOrder);

// Event delegation for dynamically created elements
document.addEventListener('click',e=>{
  if(e.target.classList.contains('wh-peek-btn')){
    const code=e.target.dataset.itemCode;
    showWhPopup(e,code);
  }
  if(e.target.classList.contains('cat-item')||e.target.closest('.cat-item')){
    const el=e.target.closest('.cat-item');
    if(el)filterGroup(el.dataset.group);
  }
  if(e.target.classList.contains('cat-chip')||e.target.closest('.cat-chip')){
    const el=e.target.closest('.cat-chip');
    if(el)filterGroup(el.dataset.group);
  }
  if(e.target.dataset.action==='add'){
    pendingAdd.add(e.target.dataset.itemCode);
    refreshCard(e.target.dataset.itemCode);
  }
  if(e.target.dataset.action==='save'){
    const code=e.target.dataset.itemCode;
    const input=e.target.closest('.qty-ctrl').querySelector('.qty-num');
    const added=addToCart(code,input?input.value:1);
    pendingAdd.delete(code);
    if(added){
      const searchInput=document.getElementById('item-search');
      if(searchInput.value){
        searchInput.value='';
        applyFilters();
      }
    }
  }
  if(e.target.dataset.delta){
    const code=e.target.dataset.itemCode;
    const delta=parseInt(e.target.dataset.delta);
    // pending/modal item: adjust input directly
    if(!cart[code]){
      const input=e.target.closest('.qty-ctrl').querySelector('.qty-num');
      if(!input)return;
      let n=parseInt(input.value,10)||1;
      n=Math.min(Math.max(1,n+delta),displayedAvailable(code));
      input.value=n;
      // Toggle button disabled states
      const minusBtn=e.target.closest('.qty-ctrl').querySelector('button[data-delta="-1"]');
      const plusBtn=e.target.closest('.qty-ctrl').querySelector('button[data-delta="1"]');
      if(minusBtn)minusBtn.style.opacity=n<=1?'.45':'1',minusBtn.disabled=n<=1;
      if(plusBtn)plusBtn.style.opacity=n>=displayedAvailable(code)?'.45':'1',plusBtn.disabled=n>=displayedAvailable(code);
      return;
    }
    // Order Summary qty controls: floor at 1 (don't allow decrement below 1)
    if(e.target.classList.contains('cart-qty-btn')&&delta<0&&cart[code]&&cart[code].qty<=1)return;
    changeQty(code,delta);
  }
  if(e.target.classList.contains('cart-remove')||e.target.closest('.cart-remove')){
    const el=e.target.closest('.cart-remove');
    removeFromCart(el.dataset.itemCode);
  }
  // Open item detail modal: click anywhere on item card/row except add button, qty controls, or warehouse peek
  const cardEl=e.target.closest('.item-card')||e.target.closest('.item-row-wrap');
  if(cardEl&&!e.target.closest('.add-btn')&&!e.target.closest('.qty-ctrl')&&!e.target.closest('.wh-peek-btn')){
    const code=cardEl.dataset.itemCode;
    if(code)openItemModal(code);
  }
  // Close modal: click overlay (but not the modal card itself)
  if(e.target.id==='item-modal-overlay'){
    closeItemModal();
  }
});

document.addEventListener('change',e=>{
  if(e.target.classList.contains('item-disc-type')){
    const code=e.target.dataset.itemCode;
    if(cart[code]){
      cart[code].discountType=e.target.value;
      if(!e.target.value)cart[code].discountValue=0;
      const valInput=document.querySelector(`.item-disc-value[data-item-code="${CSS.escape(code)}"]`);
      if(valInput){
        valInput.disabled=!e.target.value;
        if(e.target.value==='Percentage')valInput.max='100';
        else valInput.removeAttribute('max');
        if(!e.target.value)valInput.value='0';
      }
      updateCartUI();
    }
  }
  if(e.target.classList.contains('item-disc-value')){
    const code=e.target.dataset.itemCode;
    if(cart[code])cart[code].discountValue=parseFloat(e.target.value)||0,refreshTotals();
  }
});

// live keystroke sanitation — no cart/DOM update, so focus/cursor survive
document.addEventListener('input',e=>{
  if(e.target.tagName==='INPUT'&&e.target.classList.contains('qty-num')){
    const cleaned=e.target.value.replace(/\D/g,'');
    if(cleaned!==e.target.value)e.target.value=cleaned;
  }
});

// commit on blur
document.addEventListener('focusout',e=>{
  if(e.target.tagName==='INPUT'&&e.target.classList.contains('qty-num')){
    let val=e.target.value;
    // Order Summary qty inputs: clamp to minimum 1 (instead of deleting at 0)
    if(e.target.classList.contains('cart-qty-num')){
      const n=parseInt(val,10);
      if(isNaN(n)||n<1)val='1';
    }
    setQty(e.target.dataset.itemCode,val);
  }
});

// Enter commits immediately, Escape closes modal
document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT'&&e.target.classList.contains('qty-num')&&e.key==='Enter'){
    e.target.blur();
  }
  if(e.key==='Escape'&&modalItemCode){
    closeItemModal();
  }
});

(function(){
  var btn=document.getElementById('sidebar-toggle');
  if(!btn)return;
  btn.addEventListener('click',function(){document.body.classList.toggle('sidebar-expanded');});
  document.querySelectorAll('.nav-link').forEach(function(a){
    a.addEventListener('click',function(){if(!IS_DESKTOP())document.body.classList.remove('sidebar-expanded');});
  });
})();

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

// Nav-away guard for in-app link clicks
(function(){
	async function trySavePending(){
		if(!getWarehouse()||!CUSTOMER_ID)return false;
		try{
			await post('dms.api.sales.create_sales_order',{...buildOrderPayload(),submit:false});
			return true;
		}catch(e){return false}
	}
	document.querySelectorAll('.nav-link, .bnav-item, .mob-back').forEach(function(a){
		if(a.getAttribute('href')==='/sales-logout')return;
		a.addEventListener('click',async function(e){
			if(!cartHasItems())return;
			e.preventDefault();
			const dest=this.href;
			const ok=await confirmAction('Unsaved Order','You have items in your cart. Save this order as pending before leaving?','Save & Leave');
			if(ok)await trySavePending();
			cart={};
			window.location.href=dest;
		});
	});
})();

// Browser back button guard
(function(){
	history.pushState({dmsGuard:1},'',location.href);
	let leaving=false;
	window.addEventListener('popstate',async function(){
		if(leaving||!cartHasItems())return;
		history.pushState({dmsGuard:1},'',location.href);
		const ok=await confirmAction('Unsaved Order','You have items in your cart. Save this order as pending before leaving?','Save & Leave');
		if(ok)await (async function(){
			if(getWarehouse()&&CUSTOMER_ID){
				try{
					await post('dms.api.sales.create_sales_order',{...buildOrderPayload(),submit:false});
				}catch(e){}
			}
		})();
		leaving=true;
		history.back();
	});
})();

// beforeunload guard
window.addEventListener('beforeunload',function(e){
	if(!cartHasItems())return;
	e.preventDefault();
	e.returnValue='';
});
