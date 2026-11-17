// Order notifications: a bell on every Sales page that lists changes other people
// made to the Sales Orders, Quotations and Sales Invoices the signed-in sales person created. Read-only feed.
(function(){
	if(window.__dmsOrderNotifications)return;
	window.__dmsOrderNotifications=true;

	const API='dms.api.order_notifications.';
	const POLL_MS=60000;

	const CSS=`
body.on-bell .topbar,body.on-bell .mob-header{padding-right:72px}
body.on-bell #list-view>.content>.search-bar:first-child{margin-right:56px}
.on-bell-btn{position:fixed;top:calc(14px + env(safe-area-inset-top));right:calc(16px + env(safe-area-inset-right));z-index:250;width:44px;height:44px;padding:0;display:flex;align-items:center;justify-content:center;border-radius:50%;border:1px solid rgba(255,255,255,.85);background:rgba(255,255,255,.62);-webkit-backdrop-filter:saturate(170%) blur(20px);backdrop-filter:saturate(170%) blur(20px);color:#1d1d1f;cursor:pointer;box-shadow:0 6px 20px rgba(60,70,140,.14),inset 0 1px 0 rgba(255,255,255,.8);transition:background .15s,box-shadow .15s}
.on-bell-btn:hover{background:rgba(255,255,255,.9)}
.on-bell-btn:focus-visible{outline:none;box-shadow:0 0 0 4px rgba(0,113,227,.25),0 6px 20px rgba(60,70,140,.14)}
.on-bell-btn svg{width:20px;height:20px}
.on-badge{position:absolute;top:-3px;right:-3px;min-width:18px;height:18px;padding:0 5px;box-sizing:border-box;border-radius:9px;background:#d70015;color:#fff;font-size:11px;font-weight:700;line-height:18px;text-align:center;border:2px solid #fff}
.on-badge[hidden]{display:none}
.on-overlay{display:none;position:fixed;inset:0;z-index:260}
.on-overlay.open{display:block}
.on-panel{position:fixed;top:calc(66px + env(safe-area-inset-top));right:calc(16px + env(safe-area-inset-right));width:380px;max-width:calc(100vw - 32px);max-height:min(560px,calc(100vh - 90px));max-height:min(560px,calc(100dvh - 90px));display:flex;flex-direction:column;box-sizing:border-box;background:rgba(255,255,255,.78);-webkit-backdrop-filter:saturate(180%) blur(30px);backdrop-filter:saturate(180%) blur(30px);border:1px solid rgba(255,255,255,.85);border-radius:20px;box-shadow:0 24px 64px rgba(30,40,90,.22),inset 0 1px 0 rgba(255,255,255,.8);color:#1d1d1f;font-family:inherit;animation:on-pop .18s cubic-bezier(.25,.1,.25,1)}
.on-panel:focus{outline:none}
.on-head{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;padding:16px 14px 10px 18px;border-bottom:1px solid rgba(0,0,0,.06)}
.on-title{flex:1;font-size:17px;font-weight:700}
.on-mark{border:none;background:none;color:#0066cc;font-size:13px;font-weight:600;cursor:pointer;padding:6px 8px;border-radius:8px;font-family:inherit;min-height:32px}
.on-mark:hover{background:rgba(0,113,227,.08)}
.on-mark:disabled{color:#8e8e93;cursor:default;background:none}
.on-clear{color:#d70015}
.on-clear:hover{background:rgba(215,0,21,.08)}
.on-clear.confirm{background:rgba(215,0,21,.1)}
.on-close{width:30px;height:30px;padding:0;display:flex;align-items:center;justify-content:center;border-radius:50%;border:1px solid rgba(255,255,255,.85);background:rgba(255,255,255,.6);color:#4a4a52;cursor:pointer}
.on-close:hover{background:#fff;color:#1d1d1f}
.on-close svg{width:14px;height:14px}
.on-mark:focus-visible,.on-close:focus-visible,.on-item:focus-visible,.on-retry:focus-visible{outline:none;box-shadow:0 0 0 4px rgba(0,113,227,.22)}
.on-list{overflow-y:auto;overscroll-behavior:contain;padding:6px}
.on-item{display:flex;gap:12px;width:100%;box-sizing:border-box;text-align:left;padding:10px;border:none;border-radius:14px;background:none;color:inherit;font-family:inherit;cursor:pointer;text-decoration:none;position:relative}
.on-item:hover{background:rgba(255,255,255,.75)}
.on-item.unread{background:rgba(0,113,227,.06)}
.on-item.unread:hover{background:rgba(0,113,227,.1)}
.on-icon{flex:0 0 34px;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center}
.on-icon svg{width:16px;height:16px}
.on-k-change .on-icon{background:rgba(0,113,227,.14);color:#0060c0}
.on-k-submit .on-icon{background:rgba(36,138,61,.15);color:#1e7a35}
.on-k-cancel .on-icon{background:rgba(215,0,21,.12);color:#b8000f}
.on-k-comment .on-icon{background:rgba(175,82,222,.15);color:#8a3db8}
.on-k-delivery .on-icon{background:rgba(255,149,0,.18);color:#a35a00}
.on-k-invoice .on-icon{background:rgba(48,176,199,.18);color:#1b6f80}
.on-main{flex:1;min-width:0}
.on-row1{display:flex;align-items:baseline;gap:8px}
.on-it{flex:1;min-width:0;font-size:14px;font-weight:600}
.on-time{flex:0 0 auto;font-size:12px;color:#5c5c63}
.on-order{font-size:13px;color:#1d1d1f;margin-top:1px;overflow-wrap:anywhere}
.on-order span{color:#5c5c63}
.on-detail{font-size:13px;color:#4a4a52;margin-top:3px;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.on-by{font-size:12px;color:#5c5c63;margin-top:3px}
.on-dot{position:absolute;top:16px;right:10px;width:8px;height:8px;border-radius:50%;background:#0071e3}
.on-item.unread .on-row1{padding-right:14px}
.on-state{padding:32px 20px;text-align:center;font-size:14px;color:#5c5c63}
.on-state svg{width:28px;height:28px;color:#aeaeb2;display:block;margin:0 auto 10px}
.on-retry{margin-top:12px;padding:8px 16px;border-radius:980px;border:1px solid rgba(255,255,255,.9);background:rgba(255,255,255,.7);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;color:#1d1d1f}
@keyframes on-pop{from{opacity:0;transform:translateY(-6px) scale(.98)}to{opacity:1;transform:none}}
@keyframes on-sheet{from{transform:translateY(24px);opacity:.6}to{transform:none;opacity:1}}
@media (max-width:600px){
  .on-overlay.open{background:rgba(20,24,40,.28)}
  .on-panel{top:auto;left:0;right:0;bottom:0;width:100%;max-width:none;max-height:85vh;max-height:85dvh;border-radius:22px 22px 0 0;border-bottom:none;padding-bottom:env(safe-area-inset-bottom);animation:on-sheet .22s cubic-bezier(.25,.1,.25,1)}
  .on-close{width:36px;height:36px}
  .on-mark{min-height:44px}
}
@media (pointer:coarse){.on-item{min-height:56px}}
@media (prefers-reduced-motion:reduce){.on-panel{animation:none}}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.on-panel{background:rgba(255,255,255,.97)}.on-bell-btn{background:rgba(255,255,255,.95)}}
@media (prefers-reduced-transparency:reduce){.on-panel,.on-bell-btn{background:#fff;-webkit-backdrop-filter:none;backdrop-filter:none}}
`;

	const SVG=(p)=>`<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">${p}</svg>`;
	const ICON_BELL=SVG('<path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z"/>');
	const ICON_X=SVG('<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>');
	const ICONS={
		change:SVG('<path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/>'),
		submit:SVG('<path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>'),
		cancel:ICON_X,
		comment:SVG('<path fill-rule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.84 8.84 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7z" clip-rule="evenodd"/>'),
		delivery:SVG('<path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/><path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H10a1 1 0 001-1V5a1 1 0 00-1-1H3zM14 7a1 1 0 00-1 1v6.05A2.5 2.5 0 0115.95 16H17a1 1 0 001-1v-5a1 1 0 00-.293-.707l-2-2A1 1 0 0015 7h-1z"/>'),
		invoice:SVG('<path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd"/>'),
	};

	function csrf(){const m=document.cookie.match(/X-Frappe-CSRF-Token=([^;]+)/);return m?decodeURIComponent(m[1]):'fetch'}
	async function call(method,opts){
		const r=await fetch('/api/method/'+API+method,Object.assign({headers:{'X-Frappe-CSRF-Token':csrf(),'Accept':'application/json'}},opts||{}));
		if(!r.ok)throw new Error('HTTP '+r.status);
		return (await r.json()).message;
	}
	function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
	function parseTime(t){return new Date(String(t).replace(' ','T'))}
	function timeAgo(t){
		const d=parseTime(t),s=Math.max(0,(Date.now()-d.getTime())/1000);
		if(isNaN(s))return '';
		if(s<60)return 'just now';
		if(s<3600)return Math.floor(s/60)+' min ago';
		if(s<86400)return Math.floor(s/3600)+' h ago';
		if(s<7*86400)return Math.floor(s/86400)+' d ago';
		return d.toLocaleDateString();
	}

	let btn,badge,overlay,panel,list,markBtn,clearBtn,clearTimer=null,justCleared=false,timer=null,items=[],unread=0,loaded=false,busy=false;

	function setBadge(n){
		unread=n;
		badge.hidden=!n;
		badge.textContent=n>9?'9+':String(n);
		btn.setAttribute('aria-label',n?`Notifications, ${n} unread`:'Notifications');
	}

	// Each notification opens the page that lists its document.
	function itemHref(i){
		const name=encodeURIComponent(i.order);
		if(i.doctype==='Quotation')return '/quotation-history?quotation='+name;
		if(i.doctype==='Sales Invoice')return '/sales-invoice?invoice='+name+(i.is_return?'#returns':'');
		return '/order-history?order='+name+(i.kind==='comment'?'&comments=1':'');
	}

	function itemHtml(i){
		const href=itemHref(i);
		const exact=parseTime(i.time).toLocaleString();
		return `<a class="on-item on-k-${esc(i.kind)}${i.unread?' unread':''}" href="${esc(href)}">
			<span class="on-icon">${ICONS[i.kind]||ICONS.change}</span>
			<span class="on-main">
				<span class="on-row1"><span class="on-it">${esc(i.title)}</span><time class="on-time" title="${esc(exact)}">${esc(timeAgo(i.time))}</time></span>
				<span class="on-order" style="display:block">${esc(i.order)}${i.customer_name?` <span>· ${esc(i.customer_name)}</span>`:''}</span>
				${i.detail?`<span class="on-detail">${esc(i.detail)}</span>`:''}
				${i.by?`<span class="on-by" style="display:block">by ${esc(i.by)}</span>`:''}
			</span>
			${i.unread?'<span class="on-dot" aria-label="Unread"></span>':''}
		</a>`;
	}

	function render(){
		markBtn.disabled=!items.some(i=>i.unread);
		clearBtn.disabled=!items.length;
		if(!items.length){
			resetClear();
			list.innerHTML=`<div class="on-state">${ICON_BELL}${justCleared?'You’re all caught up.':'No changes to your orders, quotations or invoices in the last 30 days.'}</div>`;
			return;
		}
		list.innerHTML=items.map(itemHtml).join('');
	}

	async function refresh(){
		if(busy)return;
		busy=true;
		try{
			const r=await call('get_notifications?limit=30');
			items=(r&&r.items)||[];
			if(items.length)justCleared=false;
			setBadge((r&&r.unread)||0);
			loaded=true;
			if(isOpen())render();
		}catch(e){
			if(isOpen()&&!loaded)list.innerHTML=`<div class="on-state">Could not load notifications.<br><button type="button" class="on-retry">Retry</button></div>`;
		}finally{busy=false}
	}

	async function markSeen(){
		if(!unread)return;
		setBadge(0);
		try{await call('mark_notifications_seen',{method:'POST'})}catch(e){}
	}

	function resetClear(){
		clearTimeout(clearTimer);clearTimer=null;
		clearBtn.classList.remove('confirm');
		clearBtn.textContent='Clear all';
	}

	async function clearAll(){
		if(!clearBtn.classList.contains('confirm')){
			clearBtn.classList.add('confirm');
			clearBtn.textContent='Clear all?';
			clearTimer=setTimeout(resetClear,3000);
			return;
		}
		resetClear();
		items=[];justCleared=true;
		setBadge(0);
		render();
		try{await call('clear_notifications',{method:'POST'})}
		catch(e){justCleared=false;refresh()}
	}

	function isOpen(){return overlay.classList.contains('open')}

	async function open(){
		overlay.classList.add('open');
		btn.setAttribute('aria-expanded','true');
		if(loaded)render();else list.innerHTML='<div class="on-state">Loading…</div>';
		panel.focus();
		if(!loaded)await refresh();
		// Opening the panel counts as seeing the current items; the dots stay until the next refresh.
		markSeen();
	}

	function close(){
		if(!isOpen())return;
		overlay.classList.remove('open');
		btn.setAttribute('aria-expanded','false');
		items.forEach(i=>i.unread=false);
		resetClear();
		btn.focus();
	}

	function startPolling(){
		stopPolling();
		timer=setInterval(()=>{if(document.visibilityState==='visible')refresh()},POLL_MS);
	}
	function stopPolling(){if(timer){clearInterval(timer);timer=null}}

	function init(){
		if(!document.body)return;
		const style=document.createElement('style');
		style.textContent=CSS;
		document.head.appendChild(style);

		btn=document.createElement('button');
		btn.type='button';
		btn.className='on-bell-btn';
		btn.setAttribute('aria-haspopup','dialog');
		btn.setAttribute('aria-expanded','false');
		btn.innerHTML=ICON_BELL+'<span class="on-badge" hidden></span>';
		badge=btn.querySelector('.on-badge');

		overlay=document.createElement('div');
		overlay.className='on-overlay';
		overlay.innerHTML=`<div class="on-panel" role="dialog" aria-modal="false" aria-labelledby="on-title" tabindex="-1">
			<div class="on-head">
				<div class="on-title" id="on-title">Notifications</div>
				<button type="button" class="on-mark" disabled>Mark all as read</button>
				<button type="button" class="on-mark on-clear" disabled>Clear all</button>
				<button type="button" class="on-close" aria-label="Close">${ICON_X}</button>
			</div>
			<div class="on-list"></div>
		</div>`;
		panel=overlay.querySelector('.on-panel');
		list=overlay.querySelector('.on-list');
		markBtn=overlay.querySelector('.on-mark:not(.on-clear)');
		clearBtn=overlay.querySelector('.on-clear');

		document.body.appendChild(btn);
		document.body.appendChild(overlay);
		document.body.classList.add('on-bell');

		btn.addEventListener('click',()=>isOpen()?close():open());
		overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
		overlay.querySelector('.on-close').addEventListener('click',close);
		markBtn.addEventListener('click',()=>{
			items.forEach(i=>i.unread=false);
			render();
			markSeen();
		});
		clearBtn.addEventListener('click',clearAll);
		list.addEventListener('click',e=>{
			if(e.target.closest('.on-retry')){list.innerHTML='<div class="on-state">Loading…</div>';refresh()}
		});
		document.addEventListener('keydown',e=>{if(e.key==='Escape'&&isOpen())close()});
		document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh()});

		setBadge(0);
		refresh();
		startPolling();
	}

	if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
