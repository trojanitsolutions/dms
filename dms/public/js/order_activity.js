// Order activity: a read-only timeline of everything done to one Sales Order.
// DMSActivity.render(container, order) draws it inline; DMSActivity.openPanel(order, subtitle)
// shows it in a side panel (a bottom sheet on phones).
(function(){
	if(window.DMSActivity)return;

	const API='dms.api.order_activity.get_order_activity';

	const CSS=`
.oa-tl{list-style:none;margin:0;padding:0;position:relative}
.oa-item{display:flex;gap:12px;position:relative;padding:0 0 16px}
.oa-item:last-child{padding-bottom:0}
.oa-item:not(:last-child)::before{content:"";position:absolute;left:15px;top:34px;bottom:2px;width:2px;border-radius:1px;background:rgba(60,60,67,.12)}
.oa-icon{flex:0 0 32px;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(0,113,227,.14);color:#0060c0}
.oa-icon svg{width:15px;height:15px}
.oa-k-submit .oa-icon{background:rgba(36,138,61,.15);color:#1e7a35}
.oa-k-cancel .oa-icon{background:rgba(215,0,21,.12);color:#b8000f}
.oa-k-comment .oa-icon{background:rgba(175,82,222,.15);color:#8a3db8}
.oa-k-delivery .oa-icon{background:rgba(255,149,0,.18);color:#a35a00}
.oa-k-invoice .oa-icon{background:rgba(48,176,199,.18);color:#1b6f80}
.oa-k-created .oa-icon{background:rgba(142,142,147,.18);color:#4a4a52}
.oa-main{flex:1;min-width:0;padding-top:5px}
.oa-row1{display:flex;align-items:baseline;gap:8px}
.oa-title{flex:1;min-width:0;font-size:14px;font-weight:600;color:#1d1d1f}
.oa-time{flex:0 0 auto;font-size:12px;color:#5c5c63}
.oa-detail{font-size:13px;color:#4a4a52;margin-top:3px;overflow-wrap:anywhere;white-space:pre-line}
.oa-by{font-size:12px;color:#5c5c63;margin-top:3px}
.oa-state{padding:20px 12px;text-align:center;font-size:14px;color:#5c5c63}
.oa-retry{margin-top:10px;min-height:36px;padding:8px 16px;border-radius:980px;border:1px solid rgba(0,0,0,.08);background:rgba(255,255,255,.8);font:inherit;font-size:13px;font-weight:600;color:#1d1d1f;cursor:pointer}
.oa-retry:focus-visible,.oa-close:focus-visible{outline:none;box-shadow:0 0 0 4px rgba(0,113,227,.22)}
.oa-overlay{position:fixed;inset:0;z-index:270;background:rgba(20,24,40,.22);display:none}
.oa-overlay.open{display:block}
.oa-panel{position:fixed;top:0;right:0;bottom:0;width:420px;max-width:100vw;display:flex;flex-direction:column;box-sizing:border-box;background:rgba(255,255,255,.82);-webkit-backdrop-filter:saturate(180%) blur(30px);backdrop-filter:saturate(180%) blur(30px);border-left:1px solid rgba(255,255,255,.85);box-shadow:-24px 0 64px rgba(30,40,90,.18);color:#1d1d1f;font-family:inherit;padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);animation:oa-slide .22s cubic-bezier(.25,.1,.25,1)}
.oa-panel:focus{outline:none}
.oa-head{display:flex;align-items:center;gap:10px;padding:18px 14px 12px 20px;border-bottom:1px solid rgba(0,0,0,.06)}
.oa-head-text{flex:1;min-width:0}
.oa-head-title{font-size:17px;font-weight:700;overflow-wrap:anywhere}
.oa-head-sub{font-size:13px;color:#5c5c63;margin-top:2px;overflow-wrap:anywhere}
.oa-close{flex:none;width:36px;height:36px;padding:0;display:flex;align-items:center;justify-content:center;border-radius:50%;border:1px solid rgba(255,255,255,.85);background:rgba(255,255,255,.6);color:#4a4a52;cursor:pointer}
.oa-close:hover{background:#fff;color:#1d1d1f}
.oa-close svg{width:14px;height:14px}
.oa-body{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:18px 20px calc(20px + env(safe-area-inset-bottom))}
@keyframes oa-slide{from{transform:translateX(24px);opacity:.6}to{transform:none;opacity:1}}
@keyframes oa-sheet{from{transform:translateY(24px);opacity:.6}to{transform:none;opacity:1}}
@media (max-width:600px){
  .oa-panel{top:auto;left:0;width:100%;max-height:85vh;max-height:85dvh;border-left:none;border-radius:22px 22px 0 0;padding-top:0;animation-name:oa-sheet}
  .oa-close{width:44px;height:44px}
}
@media (pointer:coarse){.oa-retry{min-height:44px}}
@media (prefers-reduced-motion:reduce){.oa-panel{animation:none}}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.oa-panel{background:rgba(255,255,255,.97)}}
@media (prefers-reduced-transparency:reduce){.oa-panel{background:#fff;-webkit-backdrop-filter:none;backdrop-filter:none}}
`;

	const SVG=(p)=>`<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">${p}</svg>`;
	const ICON_X=SVG('<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>');
	const ICONS={
		change:SVG('<path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/>'),
		submit:SVG('<path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>'),
		cancel:ICON_X,
		comment:SVG('<path fill-rule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.84 8.84 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7z" clip-rule="evenodd"/>'),
		delivery:SVG('<path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/><path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H10a1 1 0 001-1V5a1 1 0 00-1-1H3zM14 7a1 1 0 00-1 1v6.05A2.5 2.5 0 0115.95 16H17a1 1 0 001-1v-5a1 1 0 00-.293-.707l-2-2A1 1 0 0015 7h-1z"/>'),
		invoice:SVG('<path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd"/>'),
		created:SVG('<path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd"/>'),
	};

	function esc(s){const el=document.createElement('div');el.textContent=s==null?'':String(s);return el.innerHTML}
	function csrf(){const m=document.cookie.match(/X-Frappe-CSRF-Token=([^;]+)/);return m?decodeURIComponent(m[1]):'fetch'}
	function parseTime(t){return new Date(String(t).replace(' ','T'))}
	function timeAgo(t){
		const d=parseTime(t),s=Math.max(0,(Date.now()-d.getTime())/1000);
		if(s<60)return 'just now';
		if(s<3600)return Math.floor(s/60)+' min ago';
		if(s<86400)return Math.floor(s/3600)+' h ago';
		if(s<604800)return Math.floor(s/86400)+' d ago';
		return d.toLocaleDateString('en',{month:'short',day:'numeric',year:'numeric'});
	}

	function injectCss(){
		if(document.getElementById('oa-css'))return;
		const st=document.createElement('style');
		st.id='oa-css';st.textContent=CSS;
		document.head.appendChild(st);
	}

	async function fetchActivity(order){
		const r=await fetch(`/api/method/${API}?`+new URLSearchParams({order}),{headers:{'X-Frappe-CSRF-Token':csrf(),'Accept':'application/json'}});
		if(!r.ok)throw new Error('HTTP '+r.status);
		return ((await r.json()).message||{}).items||[];
	}

	function itemHtml(i){
		const exact=i.time?parseTime(i.time).toLocaleString('en',{dateStyle:'medium',timeStyle:'short'}):'';
		return `<li class="oa-item oa-k-${esc(i.kind)}">
			<span class="oa-icon">${ICONS[i.kind]||ICONS.change}</span>
			<div class="oa-main">
				<div class="oa-row1"><span class="oa-title">${esc(i.title)}</span><time class="oa-time" datetime="${esc(i.time)}" title="${esc(exact)}">${esc(timeAgo(i.time))}</time></div>
				${i.detail?`<div class="oa-detail">${esc(i.detail)}</div>`:''}
				${i.by?`<div class="oa-by">by ${esc(i.by)}</div>`:''}
			</div>
		</li>`;
	}

	async function render(container,order){
		injectCss();
		container.innerHTML='<div class="oa-state" role="status">Loading activity…</div>';
		let items;
		try{items=await fetchActivity(order)}
		catch(e){
			container.innerHTML='<div class="oa-state" role="alert">Could not load activity.<br><button type="button" class="oa-retry">Try again</button></div>';
			container.querySelector('.oa-retry').addEventListener('click',()=>render(container,order));
			return false;
		}
		container.innerHTML=items.length
			?`<ol class="oa-tl" aria-label="Activity for ${esc(order)}">${items.map(itemHtml).join('')}</ol>`
			:'<div class="oa-state">No activity yet.</div>';
		return true;
	}

	let overlay=null,lastFocus=null;
	function closePanel(){
		if(!overlay)return;
		overlay.remove();overlay=null;
		document.removeEventListener('keydown',onKey);
		if(lastFocus&&document.contains(lastFocus))lastFocus.focus();
	}
	function onKey(e){if(e.key==='Escape')closePanel()}

	function openPanel(order,subtitle){
		injectCss();
		closePanel();
		lastFocus=document.activeElement;
		overlay=document.createElement('div');
		overlay.className='oa-overlay open';
		overlay.innerHTML=`<div class="oa-panel" role="dialog" aria-modal="true" aria-labelledby="oa-head-title" tabindex="-1">
			<div class="oa-head">
				<div class="oa-head-text">
					<div class="oa-head-title" id="oa-head-title">Activity · ${esc(order)}</div>
					${subtitle?`<div class="oa-head-sub">${esc(subtitle)}</div>`:''}
				</div>
				<button type="button" class="oa-close" aria-label="Close activity">${ICON_X}</button>
			</div>
			<div class="oa-body" aria-live="polite"></div>
		</div>`;
		document.body.appendChild(overlay);
		overlay.addEventListener('click',e=>{if(e.target===overlay)closePanel()});
		overlay.querySelector('.oa-close').addEventListener('click',closePanel);
		document.addEventListener('keydown',onKey);
		overlay.querySelector('.oa-panel').focus();
		render(overlay.querySelector('.oa-body'),order);
	}

	window.DMSActivity={render,openPanel,close:closePanel};
})();
