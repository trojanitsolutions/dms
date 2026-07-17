const CUSTOMER_ID = '{{ customer }}';
const CUSTOMER_NAME = '{{ customer_name }}';
const IS_DESKTOP = () => window.innerWidth >= 768;

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

/* ── Stock helpers ───────────────────────────────────────── */
function displayedAvailable(code){
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
}
async function onMobWarehouseChange(){
  const wh=document.getElementById('mob-warehouse-select').value;
  setWarehouseSelects(wh);
  await reloadItems(wh);
}
async function onMobWarehouseChange2(){
  const wh=document.getElementById('mob-warehouse-select-2').value;
  setWarehouseSelects(wh);
  await reloadItems(wh);
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
  return`<div class="item-card${oos?' oos':''}" id="card-${CSS.escape(item.name)}">
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
  return`<div class="item-row-wrap" id="card-${CSS.escape(item.name)}">
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
function addToCart(code){
  const item=allItems.find(i=>i.name===code);
  if(!item||!item.any_stock)return;
  if(displayedAvailable(code)<=0)return;
  cart[code]={item,qty:1};
  updateCartUI();refreshCard(code);
}
function changeQty(code,delta){
  if(!cart[code])return;
  if(delta>0&&displayedAvailable(code)<=0)return;
  cart[code].qty=Math.max(0,cart[code].qty+delta);
  if(cart[code].qty===0)delete cart[code];
  updateCartUI();refreshCard(code);
}
function removeFromCart(code){delete cart[code];updateCartUI();refreshCard(code)}

function refreshCard(code){
  const actionEl=document.getElementById('action-'+CSS.escape(code));
  const stockEl=document.getElementById('stock-'+CSS.escape(code));
  if(!actionEl)return;
  const item=allItems.find(i=>i.name===code);if(!item)return;
  const inCart=cart[code];
  const cardOos=isCardOos(code);
  const canMore=displayedAvailable(code)>0;
  const listStyle=currentView==='list'?' style="font-size:11px;padding:5px 8px"':'';

  // Update action buttons
  if(cardOos){
    actionEl.innerHTML=`<button class="add-btn"${listStyle} disabled>OOS</button>`;
  }else if(inCart){
    const plusDis=!canMore?' disabled style="opacity:.45;cursor:not-allowed"':'';
    actionEl.innerHTML=`<div class="qty-ctrl"><button class="qty-btn" data-item-code="${code}" data-delta="-1">−</button><span class="qty-num">${inCart.qty}</span><button class="qty-btn" data-item-code="${code}" data-delta="1"${plusDis}>+</button></div>`;
  }else{
    actionEl.innerHTML=`<button class="add-btn" data-item-code="${code}" data-action="add">Add</button>`;
  }

  // Update stock label
  if(stockEl){
    const avail=displayedAvailable(code);
    const wh=getWarehouse();
    const uom=item.stock_uom||'ea';
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
}

function updateCartUI(){
  const items=Object.values(cart);
  const cartEl=document.getElementById('cart-items');
  const tabBtn=document.getElementById('cart-tab-btn');

  if(tabBtn)tabBtn.textContent=`Cart (${items.length})`;

  if(!items.length){
    cartEl.innerHTML=`<div class="no-items"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>No items yet.<br>Add products from the catalog.</div>`;
    document.getElementById('sum-subtotal').textContent='QAR 0.00';
    document.getElementById('sum-grand').textContent='QAR 0.00';
    currentGrandTotal=0;
    updateCreditWarning();
    return;
  }

  let subtotal=0;
  cartEl.innerHTML=items.map(({item,qty})=>{
    const line=item.standard_rate*qty;subtotal+=line;
    return`<div class="cart-item">
      <div class="cart-item-info"><div class="cart-item-name">${item.item_name}</div><div class="cart-item-price">${fmt(item.standard_rate)} × ${qty} ${item.stock_uom||'ea'}</div></div>
      <div class="cart-item-total">${fmt(line)}</div>
      <button class="cart-remove" data-item-code="${item.name}" title="Remove">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
      </button>
    </div>`;
  }).join('');

  currentGrandTotal=subtotal;
  document.getElementById('sum-subtotal').textContent=fmt(subtotal);
  document.getElementById('sum-grand').textContent=fmt(subtotal);
  updateCreditWarning();
}

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

/* ── Submit order ────────────────────────────────────────── */
async function submitOrder(){
  const items=Object.values(cart);
  if(!items.length){alert('Add at least one item.');return}
  if(!CUSTOMER_ID){alert('No customer selected.');return}

  if(customerStatus.disabled){alert('This customer is disabled. Sales Orders cannot be created.');return}
  if(customerStatus.is_frozen){alert('This customer account is frozen. Sales Orders cannot be created.');return}

  const wh=getWarehouse();
  if(!wh){alert('Select a warehouse first.');return}

  const ddVal=document.getElementById('delivery-date').value;
  const _today=(()=>{const d=new Date();const y=d.getFullYear();const m=String(d.getMonth()+1).padStart(2,'0');const dy=String(d.getDate()).padStart(2,'0');return`${y}-${m}-${dy}`})();
  if(ddVal&&ddVal<_today){alert('Delivery date cannot be in the past.');return}

  if(creditInfo&&creditInfo.credit_limit>0&&currentGrandTotal>creditInfo.available_credit){
    alert(`Order total (${fmt(currentGrandTotal)}) exceeds available credit (${fmt(creditInfo.available_credit)}).`);
    return;
  }

  const btn=document.getElementById('submit-btn');
  btn.disabled=true;btn.textContent='Submitting…';
  try{
    const result=await post('dms.api.sales.create_sales_order',{
      customer:CUSTOMER_ID,
      warehouse:wh,
      items_json:JSON.stringify(items.map(({item,qty})=>({item_code:item.name,qty,rate:item.standard_rate}))),
      delivery_date:document.getElementById('delivery-date').value||''
    });
    alert(`Order ${result.name} submitted! Total: ${fmt(result.grand_total)}`);
    cart={};updateCartUI();
    window.location.href=`/sales-customer?customer=${CUSTOMER_ID}`;
  }catch(e){alert('Error: '+e.message)}
  finally{btn.disabled=false;btn.textContent='Submit Sales Order'}
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
    else{if(errEl)errEl.style.display='none';}
  });

  // Restore view preference
  setView(currentView);

  // Restore in-stock filter preference
  const _savedInstock=sessionStorage.getItem('instockFilter')==='1';
  const _instockEl=document.getElementById('instock-filter');
  if(_instockEl)_instockEl.checked=_savedInstock;

  // Initial mobile tab state
  if(!IS_DESKTOP())setMobTab('catalog');

  // Load warehouses
  const warehouses=await get('dms.api.sales.get_warehouses');
  if(warehouses&&warehouses.length){
    const opts=warehouses.map(w=>{const o=document.createElement('option');o.value=w.name;o.textContent=w.warehouse_name||w.name;return o});
    ['warehouse-select','mob-warehouse-select','mob-warehouse-select-2'].forEach(id=>{
      const sel=document.getElementById(id);if(!sel)return;
      opts.forEach(o=>sel.appendChild(o.cloneNode(true)));
      sel.value=warehouses[0].name;
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
  const wh=warehouses&&warehouses.length?warehouses[0].name:'';
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

  // Load credit info
  await loadCreditInfo();

  // Initial submit button state
  const btn=document.getElementById('submit-btn');
  if(btn)btn.disabled=true;
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
    addToCart(e.target.dataset.itemCode);
  }
  if(e.target.dataset.delta){
    changeQty(e.target.dataset.itemCode,parseInt(e.target.dataset.delta));
  }
  if(e.target.classList.contains('cart-remove')||e.target.closest('.cart-remove')){
    const el=e.target.closest('.cart-remove');
    removeFromCart(el.dataset.itemCode);
  }
});

(function(){
  var btn=document.getElementById('sidebar-toggle');
  if(!btn)return;
  btn.addEventListener('click',function(){document.body.classList.toggle('sidebar-expanded');});
  document.querySelectorAll('.nav-link').forEach(function(a){
    a.addEventListener('click',function(){if(window.innerWidth<1200)document.body.classList.remove('sidebar-expanded');});
  });
})();
