function relTime(s){
  if(!s)return '';
  const d=new Date(s.replace(' ','T')+'Z');
  const secs=Math.floor((Date.now()-d)/1000);
  if(secs<60)return 'Just now';
  if(secs<3600){const m=Math.floor(secs/60);return m+' minute'+(m>1?'s':'')+' ago'}
  if(secs<86400){const h=Math.floor(secs/3600);return h+' hour'+(h>1?'s':'')+' ago'}
  if(secs<172800)return 'Yesterday';
  const days=Math.floor(secs/86400);
  if(days<7)return days+' days ago';
  return d.toLocaleDateString('en',{month:'short',day:'numeric',year:'numeric'});
}
const AVATAR_COLORS=['#1E40AF','#92400E','#065F46','#7C3AED','#B91C1C','#0F766E','#C2410C','#4338CA'];
function avatarColor(name){let h=0;for(let c of name)h=(h*31+c.charCodeAt(0))&0xFFFF;return AVATAR_COLORS[h%AVATAR_COLORS.length]}
function initials(name){return name.split(' ').slice(0,2).map(w=>w[0]||'').join('').toUpperCase()}
function fmt(n){return 'QAR '+Number(n||0).toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2})}
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

let allCustomers=[];
let currentStatusFilter='All';

function getCustStatus(c){
  if(c.disabled)return 'Disabled';
  if(c.is_frozen)return 'Frozen';
  return 'Active';
}

function renderGrid(list){
  const grid=document.getElementById('customer-grid');
  document.getElementById('count-label').textContent=`${list.length} account${list.length!==1?'s':''}`;
  if(!list.length){grid.innerHTML='<div class="loading-grid" style="grid-column:1/-1">No customers found.</div>';return}
  grid.innerHTML=list.map(c=>{
    let badge,cardExtra='';
    if(c.disabled){
      badge='<span class="badge badge-red">Disabled</span>';
      cardExtra=' cust-disabled';
    }else if(c.is_frozen){
      badge='<span class="badge badge-amber">Frozen</span>';
      cardExtra=' cust-frozen';
    }else{
      badge='<span class="badge badge-green">Active</span>';
    }
    return `<div class="customer-card${cardExtra}" onclick="showDetail('${c.name}')">
      <div class="card-top">
        <div class="cust-avatar" style="background:${avatarColor(c.customer_name)}">${initials(c.customer_name)}</div>
        <div class="cust-info">
          <div class="cust-name">${c.customer_name}</div>
          <div class="cust-code">${c.name}</div>
        </div>
        ${badge}
      </div>
      <div class="card-meta">
        <div><div class="meta-label">Outstanding Balance</div><div class="meta-value">${fmt(c.outstanding)}</div></div>
      </div>
    </div>`
  }).join('');
}

function applyFilters(){
  const q=document.getElementById('search-input').value.toLowerCase().trim();
  let list=allCustomers;
  if(currentStatusFilter!=='All')list=list.filter(c=>getCustStatus(c)===currentStatusFilter);
  if(q)list=list.filter(c=>c.customer_name.toLowerCase().includes(q)||c.name.toLowerCase().includes(q));
  renderGrid(list);
}

function setStatusFilter(f){
  currentStatusFilter=f;
  document.querySelectorAll('.status-chip').forEach(el=>el.classList.toggle('active',el.dataset.status===f));
  applyFilters();
}

async function loadCustomers(){
  const data=await get('dms.api.sales.get_customers',{});
  allCustomers=data||[];
  applyFilters();
}

document.getElementById('search-input').addEventListener('input',()=>applyFilters());

async function showDetail(custId){
  document.getElementById('list-view').style.display='none';
  document.getElementById('detail-view').style.display='block';
  window.scrollTo(0,0);

  const c=await get('dms.api.sales.get_customer_detail',{customer:custId});
  if(!c){showList();return}

  document.getElementById('d-avatar').textContent=initials(c.customer_name);
  document.getElementById('d-avatar').style.background=avatarColor(c.customer_name);
  document.getElementById('d-name').textContent=c.customer_name;
  document.getElementById('d-meta').textContent=[c.name,c.mobile_no,c.territory].filter(Boolean).join(' · ');

  // Status badge + alert
  const statusBadge=document.getElementById('d-status');
  const statusAlert=document.getElementById('d-status-alert');
  const statusAlertMsg=document.getElementById('d-status-alert-msg');
  const newOrderBtn=document.getElementById('d-new-order-btn');
  const newQuotationBtn=document.getElementById('d-new-quotation-btn');
  if(c.disabled){
    statusBadge.className='badge badge-red';statusBadge.textContent='Disabled';
    statusAlert.className='cust-status-alert is-disabled';
    statusAlertMsg.textContent='This customer is disabled. New Sales Orders cannot be created for this account.';
    newOrderBtn.style.opacity='0.45';newOrderBtn.style.pointerEvents='none';newOrderBtn.href='#';
    newQuotationBtn.style.opacity='0.45';newQuotationBtn.style.pointerEvents='none';newQuotationBtn.href='#';
  }else if(c.is_frozen){
    statusBadge.className='badge badge-amber';statusBadge.textContent='Frozen';
    statusAlert.className='cust-status-alert is-frozen';
    statusAlertMsg.textContent='This customer account is frozen. New Sales Orders cannot be created until the account is unfrozen.';
    newOrderBtn.style.opacity='0.45';newOrderBtn.style.pointerEvents='none';newOrderBtn.href='#';
    newQuotationBtn.style.opacity='0.45';newQuotationBtn.style.pointerEvents='none';newQuotationBtn.href='#';
  }else{
    statusBadge.className='badge badge-green';statusBadge.textContent='Active';
    statusAlert.className='cust-status-alert';
    newOrderBtn.style.opacity='';newOrderBtn.style.pointerEvents='';
    newOrderBtn.href=`/sales-order?customer=${custId}`;
    newQuotationBtn.style.opacity='';newQuotationBtn.style.pointerEvents='';
    newQuotationBtn.href=`/new-quotation?customer=${custId}`;
  }

  document.getElementById('d-outstanding').textContent=fmt(c.outstanding||0);

  const orders=c.recent_orders||[];
  const badge=s=>{const m={Submitted:'badge-green',Delivered:'badge-green',Cancelled:'badge-gray',Draft:'badge-gray'};return `<span class="badge ${m[s]||'badge-gray'}">${s}</span>`};
  document.getElementById('d-orders-list').innerHTML=orders.length
    ?orders.map(o=>`<div class="order-row">
        <div><div class="order-name">${o.name}</div><div class="order-date">${relTime(o.creation)}</div></div>
        <div class="order-right">${badge(o.status)}<div class="order-amount">${fmt(o.grand_total)}</div></div>
      </div>`).join('')
    :'<div class="empty-state">No orders yet.</div>';
}

function showList(){
  document.getElementById('detail-view').style.display='none';
  document.getElementById('list-view').style.display='block';
  window.scrollTo(0,0);
}

function openModal(){document.getElementById('modal-overlay').classList.add('open')}
function closeModal(){document.getElementById('modal-overlay').classList.remove('open')}
function overlayClick(e){if(e.target===document.getElementById('modal-overlay'))closeModal()}

async function submitNewCustomer(){
  const name=document.getElementById('nc-name').value.trim();
  if(!name)return alert('Customer name required');
  const btn=document.getElementById('nc-submit-btn');
  btn.disabled=true;btn.textContent='Creating…';
  try{
    const c=await post('dms.api.sales.create_customer',{
      customer_name:name,
      territory:document.getElementById('nc-territory').value,
      mobile_no:document.getElementById('nc-mobile').value
    });
    closeModal();
    await loadCustomers();
    currentStatusFilter='All';
    document.querySelectorAll('.status-chip').forEach(el=>el.classList.toggle('active',el.dataset.status==='All'));
    showDetail(c.name);
  }catch(e){alert(e.message)}
  finally{btn.disabled=false;btn.textContent='Create Customer'}
}

const urlCustomer=new URLSearchParams(location.search).get('customer');
if(urlCustomer){showDetail(urlCustomer)}else{loadCustomers()}

document.getElementById('new-customer-btn').addEventListener('click',openModal);
document.getElementById('modal-cancel-btn').addEventListener('click',closeModal);
document.getElementById('nc-submit-btn').addEventListener('click',submitNewCustomer);
document.getElementById('modal-overlay').addEventListener('click',overlayClick);
document.getElementById('back-from-detail').addEventListener('click',showList);
document.querySelectorAll('.status-chip').forEach(el=>{
  el.addEventListener('click',()=>setStatusFilter(el.dataset.status));
});
