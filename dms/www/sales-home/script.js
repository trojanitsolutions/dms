function csrf(){const m=document.cookie.match(/X-Frappe-CSRF-Token=([^;]+)/);return m?decodeURIComponent(m[1]):'fetch'}
async function get(method,args={}){
  const p=new URLSearchParams(args);
  const r=await fetch(`/api/method/${method}?${p}`,{headers:{'X-Frappe-CSRF-Token':csrf(),'Accept':'application/json'}});
  if(!r.ok)return null;
  return(await r.json()).message;
}

function fmt(n){return 'QAR '+Number(n||0).toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2})}

function statusDot(s){const m={Submitted:'dot-blue',Delivered:'dot-green',Cancelled:'dot-gray',Draft:'dot-gray',Completed:'dot-green'};return m[s]||'dot-gray'}

// Exact replica of frappe.datetime.prettyDate() from frappe/public/js/frappe/utils/datetime.js
// Frappe stores creation in the system timezone without a timezone marker; parsing without 'Z'
// matches how Frappe Desk's str_to_obj() treats the string — browser local time as the reference.
function prettyDate(s){
  if(!s)return '';
  const d=new Date(s.replace(' ','T'));
  const diff=(new Date()-d)/1000;
  const day_diff=Math.floor(diff/86400);
  if(isNaN(day_diff)||day_diff<0||day_diff>=365)
    return d.toLocaleDateString('en',{month:'short',day:'numeric',year:'numeric'});
  return(
    (day_diff===0&&(
      (diff<60&&'just now')||
      (diff<120&&'1 minute ago')||
      (diff<3600&&Math.floor(diff/60)+' minutes ago')||
      (diff<7200&&'1 hour ago')||
      (Math.floor(diff/3600)+' hours ago')
    ))||
    (day_diff===1&&'Yesterday')||
    (day_diff<7&&day_diff+' days ago')||
    (day_diff<31&&Math.ceil(day_diff/7)+' weeks ago')||
    (Math.ceil(day_diff/30)+' months ago')
  );
}

(function(){
  const h=new Date().getHours();
  const g=h<12?'morning':h<17?'afternoon':'evening';
  const el=document.getElementById('greeting');
  el.textContent=el.textContent.replace('morning',g);
  const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const now=new Date();
  document.getElementById('page-date').textContent=days[now.getDay()]+', '+months[now.getMonth()]+' '+now.getDate();
})();

(async function(){
  const stats=await get('dms.api.sales.get_dashboard_stats');
  if(!stats)return;

  document.getElementById('stat-sales').textContent=fmt(stats.today_sales);
  document.getElementById('stat-sales').classList.remove('loading');
  document.getElementById('stat-orders').textContent=stats.today_orders;
  document.getElementById('stat-orders').classList.remove('loading');

  const list=document.getElementById('activity-list');
  if(!stats.recent_orders||!stats.recent_orders.length){
    list.innerHTML='<div class="empty-activity">No orders yet today.</div>';
  } else {
    list.innerHTML=stats.recent_orders.map(o=>`
      <div class="activity-item">
        <div class="activity-dot ${statusDot(o.status)}"></div>
        <div class="activity-body">
          <div class="activity-text">Order <strong>${o.name}</strong> — <strong>${o.customer_name}</strong></div>
          <div class="activity-time">${fmt(o.grand_total)} · ${o.status} · ${prettyDate(o.creation)}</div>
        </div>
      </div>`).join('');
  }

  const custs=await get('dms.api.sales.get_customers');
  if(custs){
    document.getElementById('stat-customers').textContent=custs.length;
    document.getElementById('stat-customers').classList.remove('loading');
  }
})();
