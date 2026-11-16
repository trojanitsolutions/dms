// Quotation nav pop-up: choose Customer or Lead before starting a quotation.
// Used by every sales page; links opt in with the data-quotation-link attribute.
(function(){
	if(window.__dmsQuotationPartyModal)return;
	window.__dmsQuotationPartyModal=true;

	const CSS=`
.qpm-overlay{display:none;position:fixed;inset:0;background:rgba(20,24,40,.28);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);z-index:300;align-items:center;justify-content:center}
.qpm-overlay.open{display:flex}
.qpm-modal{position:relative;background:rgba(255,255,255,.72);-webkit-backdrop-filter:saturate(180%) blur(30px);backdrop-filter:saturate(180%) blur(30px);border:1px solid rgba(255,255,255,.8);color:var(--color-text-primary);border-radius:22px;padding:22px;width:calc(100% - 32px);max-width:400px;box-sizing:border-box;box-shadow:0 24px 64px rgba(30,40,90,.22),inset 0 1px 0 rgba(255,255,255,.8);font-family:inherit}
.qpm-close{position:absolute;top:14px;right:14px;width:30px;height:30px;padding:0;display:flex;align-items:center;justify-content:center;border-radius:50%;border:1px solid rgba(255,255,255,.85);background:rgba(255,255,255,.55);color:#5c5c63;cursor:pointer;transition:background .15s,color .15s}
.qpm-close:hover{background:rgba(255,255,255,.95);color:#1d1d1f}
.qpm-close:focus-visible{outline:none;box-shadow:var(--focus-ring,0 0 0 4px rgba(0,113,227,.22))}
.qpm-close svg{width:14px;height:14px}
.qpm-title{font-size:17px;font-weight:700;margin-bottom:6px;padding-right:40px}
.qpm-msg{font-size:14px;color:#4a4a52;margin-bottom:18px}
.qpm-choices{display:flex;gap:10px;margin-bottom:4px}
.qpm-choice{flex:1;padding:12px;border:1px solid rgba(255,255,255,.85);border-radius:14px;background:rgba(255,255,255,.5);color:var(--color-text-primary);font-size:15px;font-weight:600;cursor:pointer;min-height:52px;font-family:inherit;box-shadow:0 4px 14px rgba(60,70,140,.08);transition:background .15s,color .15s,box-shadow .15s}
.qpm-choice:hover,.qpm-choice:focus-visible{background:rgba(255,255,255,.95);color:var(--color-primary);box-shadow:0 6px 20px rgba(60,70,140,.14),0 0 0 2px rgba(0,113,227,.35);outline:none}
.qpm-field{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
.qpm-field label{font-size:11px;font-weight:600;color:#4a4a52;text-transform:uppercase;letter-spacing:.5px}
.qpm-field input{height:42px;padding:0 14px;background:linear-gradient(180deg,rgba(255,255,255,.75),rgba(255,255,255,.5));-webkit-backdrop-filter:saturate(160%) blur(14px);backdrop-filter:saturate(160%) blur(14px);border:1px solid rgba(255,255,255,.9);border-radius:12px;box-shadow:inset 0 1px 0 rgba(255,255,255,.9),inset 0 -1px 0 rgba(0,0,0,.03),0 2px 8px rgba(60,70,140,.08);transition:background .15s,border-color .15s,box-shadow .15s;font-size:14px;color:var(--color-text-primary);font-family:inherit;outline:none}
.qpm-field input:hover,.qpm-search:hover{background:linear-gradient(180deg,rgba(255,255,255,.85),rgba(255,255,255,.62))}
.qpm-field input::placeholder,.qpm-search::placeholder{color:#8e8e93}
.qpm-field input:focus{background:rgba(255,255,255,.92);border-color:rgba(0,113,227,.55);box-shadow:0 0 0 4px rgba(0,113,227,.16),0 2px 8px rgba(60,70,140,.08)}
.qpm-req{color:var(--color-badge-error-text,#c0392b)}
.qpm-error{font-size:13px;color:var(--color-badge-error-text,#c0392b);margin:4px 0 12px;min-height:0}
.qpm-error:empty{display:none}
.qpm-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}
.qpm-btn{flex:0 0 auto;padding:8px 16px;border-radius:980px;font-size:13px;font-weight:600;cursor:pointer;min-height:34px;font-family:inherit;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);transition:background .15s,box-shadow .15s}
.qpm-btn-cancel{border:1px solid rgba(255,255,255,.9);background:rgba(255,255,255,.55);color:var(--color-text-primary);box-shadow:0 2px 8px rgba(60,70,140,.08)}
.qpm-btn-cancel:hover{background:rgba(255,255,255,.9)}
.qpm-btn-primary{border:1px solid rgba(255,255,255,.35);background:rgba(0,113,227,.9);color:#fff;box-shadow:0 6px 18px rgba(0,113,227,.3),inset 0 1px 0 rgba(255,255,255,.35)}
.qpm-btn-primary:hover{background:rgba(0,98,196,.95)}
.qpm-btn:focus-visible{outline:none;box-shadow:var(--focus-ring,0 0 0 4px rgba(0,113,227,.22))}
.qpm-btn:disabled{opacity:.6;cursor:default}
.qpm-search{width:100%;box-sizing:border-box;height:42px;padding:0 14px;margin-bottom:10px;background:linear-gradient(180deg,rgba(255,255,255,.75),rgba(255,255,255,.5));-webkit-backdrop-filter:saturate(160%) blur(14px);backdrop-filter:saturate(160%) blur(14px);border:1px solid rgba(255,255,255,.9);border-radius:12px;box-shadow:inset 0 1px 0 rgba(255,255,255,.9),inset 0 -1px 0 rgba(0,0,0,.03),0 2px 8px rgba(60,70,140,.08);transition:background .15s,border-color .15s,box-shadow .15s;font-size:14px;color:var(--color-text-primary);font-family:inherit;outline:none}
.qpm-search:focus{background:rgba(255,255,255,.92);border-color:rgba(0,113,227,.55);box-shadow:0 0 0 4px rgba(0,113,227,.16),0 2px 8px rgba(60,70,140,.08)}
.qpm-list{max-height:280px;overflow:auto;background:rgba(255,255,255,.45);border:1px solid rgba(255,255,255,.85);border-radius:12px;margin-bottom:4px}
.qpm-row{display:block;width:100%;text-align:left;padding:10px 12px;background:none;border:none;border-bottom:1px solid rgba(0,0,0,.06);color:var(--color-text-primary);font-family:inherit;font-size:14px;font-weight:600;cursor:pointer}
.qpm-row:last-child{border-bottom:none}
.qpm-row:hover,.qpm-row:focus-visible{background:rgba(255,255,255,.75);color:var(--color-primary);outline:none}
.qpm-row-sub{display:block;font-size:12px;font-weight:400;color:#5c5c63;margin-top:2px}
.qpm-empty{padding:16px 12px;font-size:13px;color:#5c5c63;text-align:center}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.qpm-modal{background:rgba(255,255,255,.96)}.qpm-field input,.qpm-search{background:#fff}}
@media (prefers-reduced-transparency:reduce){.qpm-overlay{background:rgba(0,0,0,.4);-webkit-backdrop-filter:none;backdrop-filter:none}.qpm-modal{background:#fff;-webkit-backdrop-filter:none;backdrop-filter:none}.qpm-field input,.qpm-search{background:#fff;-webkit-backdrop-filter:none;backdrop-filter:none}}
`;

	const HTML=`
<div class="qpm-overlay" id="qpm-overlay">
  <div class="qpm-modal" role="dialog" aria-modal="true" aria-labelledby="qpm-title">
    <button type="button" class="qpm-close" id="qpm-cancel" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    <div id="qpm-step-type">
      <div class="qpm-title" id="qpm-title">New Quotation</div>
      <div class="qpm-msg">Who is this quotation for?</div>
      <div class="qpm-choices">
        <button type="button" class="qpm-choice" id="qpm-customer">Customer</button>
        <button type="button" class="qpm-choice" id="qpm-lead">Lead</button>
      </div>
    </div>
    <div id="qpm-step-pick" hidden>
      <div class="qpm-title">Select Lead</div>
      <div class="qpm-msg">Pick an existing lead, or create a new one.</div>
      <input class="qpm-search" id="qpm-search" type="search" placeholder="Search name, organisation or mobile" aria-label="Search leads" autocomplete="off">
      <div class="qpm-list" id="qpm-list" role="list"></div>
      <div class="qpm-actions">
        <button type="button" class="qpm-btn qpm-btn-cancel" id="qpm-pick-back">Back</button>
        <button type="button" class="qpm-btn qpm-btn-primary" id="qpm-new-lead">+ New Lead</button>
      </div>
    </div>
    <form id="qpm-step-lead" hidden novalidate>
      <div class="qpm-title">New Lead</div>
      <div class="qpm-msg">Enter the lead details to start the quotation.</div>
      <div class="qpm-field"><label for="qpm-first-name">First Name <span class="qpm-req">*</span></label><input id="qpm-first-name" name="first_name" autocomplete="given-name"></div>
      <div class="qpm-field"><label for="qpm-last-name">Last Name</label><input id="qpm-last-name" name="last_name" autocomplete="family-name"></div>
      <div class="qpm-field"><label for="qpm-mobile">Mobile Number <span class="qpm-req">*</span></label><input id="qpm-mobile" name="mobile_no" type="tel" autocomplete="tel"></div>
      <div class="qpm-field"><label for="qpm-org">Organisation Name</label><input id="qpm-org" name="company_name" autocomplete="organization"></div>
      <div class="qpm-error" id="qpm-error" role="alert"></div>
      <div class="qpm-actions">
        <button type="button" class="qpm-btn qpm-btn-cancel" id="qpm-back">Back</button>
        <button type="submit" class="qpm-btn qpm-btn-primary" id="qpm-create">Create</button>
      </div>
    </form>
  </div>
</div>`;

	function csrf(){const m=document.cookie.match(/X-Frappe-CSRF-Token=([^;]+)/);return m?decodeURIComponent(m[1]):(window.csrf_token||'fetch')}

	function serverMessage(data){
		try{
			if(data._server_messages){
				return JSON.parse(data._server_messages).map(m=>{try{return JSON.parse(m).message}catch(e){return m}}).join(' ').replace(/<[^>]*>/g,'');
			}
		}catch(e){}
		if(data.exception)return String(data.exception).split(':').slice(1).join(':').trim()||data.exception;
		return '';
	}

	function init(){
		const style=document.createElement('style');
		style.textContent=CSS;
		document.head.appendChild(style);
		document.body.insertAdjacentHTML('beforeend',HTML);

		const overlay=document.getElementById('qpm-overlay');
		const stepType=document.getElementById('qpm-step-type');
		const stepPick=document.getElementById('qpm-step-pick');
		const stepLead=document.getElementById('qpm-step-lead');
		const errorEl=document.getElementById('qpm-error');
		const createBtn=document.getElementById('qpm-create');
		const searchEl=document.getElementById('qpm-search');
		const listEl=document.getElementById('qpm-list');
		let busy=false;
		let leads=[];
		let searchSeq=0;
		let searchTimer=null;

		function showStep(step){
			stepType.hidden=step!=='type';
			stepPick.hidden=step!=='pick';
			stepLead.hidden=step!=='lead';
			errorEl.textContent='';
			if(step==='lead')document.getElementById('qpm-first-name').focus();
			else if(step==='pick')searchEl.focus();
			else document.getElementById('qpm-customer').focus();
		}
		function open(e){
			e.preventDefault();
			if(window.innerWidth<1200)document.body.classList.remove('sidebar-expanded');
			stepLead.reset();
			searchEl.value='';
			overlay.classList.add('open');
			showStep('type');
		}
		function close(){if(!busy)overlay.classList.remove('open')}
		function goToQuotation(lead){
			const p=new URLSearchParams({party_type:'Lead',party:lead});
			window.location.href='/new-quotation?'+p.toString();
		}

		function setListMessage(text){
			listEl.replaceChildren();
			const div=document.createElement('div');
			div.className='qpm-empty';
			div.textContent=text;
			listEl.appendChild(div);
		}
		function renderLeads(){
			if(!leads.length){setListMessage('No leads found.');return}
			listEl.replaceChildren(...leads.map(l=>{
				const row=document.createElement('button');
				row.type='button';
				row.className='qpm-row';
				row.setAttribute('role','listitem');
				row.textContent=l.display_name||l.name;
				const subText=[l.lead_name!==l.display_name?l.lead_name:'',l.mobile_no].filter(Boolean).join(' · ');
				if(subText){
					const sub=document.createElement('span');
					sub.className='qpm-row-sub';
					sub.textContent=subText;
					row.appendChild(sub);
				}
				row.addEventListener('click',()=>goToQuotation(l.name));
				return row;
			}));
		}
		async function loadLeads(){
			const seq=++searchSeq;
			setListMessage('Loading…');
			try{
				const p=new URLSearchParams({party_type:'Lead',search:searchEl.value.trim()});
				const r=await fetch('/api/method/dms.api.quotation.search_parties?'+p.toString(),{headers:{'Accept':'application/json'}});
				const data=await r.json().catch(()=>({}));
				if(seq!==searchSeq)return;
				if(!r.ok)throw new Error(serverMessage(data)||'Could not load leads.');
				leads=data.message||[];
				renderLeads();
			}catch(err){
				if(seq===searchSeq)setListMessage(err.message||'Could not load leads.');
			}
		}
		function openPicker(){
			showStep('pick');
			loadLeads();
		}

		document.querySelectorAll('a[data-quotation-link]').forEach(a=>a.addEventListener('click',open));
		document.getElementById('qpm-cancel').addEventListener('click',close);
		document.getElementById('qpm-customer').addEventListener('click',()=>{window.location.href='/sales-customer'});
		document.getElementById('qpm-lead').addEventListener('click',openPicker);
		document.getElementById('qpm-pick-back').addEventListener('click',()=>showStep('type'));
		document.getElementById('qpm-new-lead').addEventListener('click',()=>showStep('lead'));
		document.getElementById('qpm-back').addEventListener('click',()=>{if(!busy)showStep('pick')});
		searchEl.addEventListener('input',()=>{
			clearTimeout(searchTimer);
			searchTimer=setTimeout(loadLeads,300);
		});
		searchEl.addEventListener('keydown',e=>{
			if(e.key==='Enter'){
				e.preventDefault();
				if(leads.length===1)goToQuotation(leads[0].name);
			}
		});
		overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
		document.addEventListener('keydown',e=>{if(e.key==='Escape'&&overlay.classList.contains('open'))close()});

		stepLead.addEventListener('submit',async e=>{
			e.preventDefault();
			if(busy)return;
			const args={
				first_name:stepLead.first_name.value.trim(),
				last_name:stepLead.last_name.value.trim(),
				mobile_no:stepLead.mobile_no.value.trim(),
				company_name:stepLead.company_name.value.trim(),
			};
			if(!args.first_name){errorEl.textContent='First Name is required.';stepLead.first_name.focus();return}
			if(!args.mobile_no){errorEl.textContent='Mobile Number is required.';stepLead.mobile_no.focus();return}

			busy=true;createBtn.disabled=true;createBtn.textContent='Creating…';errorEl.textContent='';
			try{
				const r=await fetch('/api/method/dms.api.quotation.create_lead',{method:'POST',headers:{'X-Frappe-CSRF-Token':csrf(),'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(args)});
				const data=await r.json().catch(()=>({}));
				if(!r.ok||!data.message)throw new Error(serverMessage(data)||'Could not create the lead.');
				goToQuotation(data.message.name);
			}catch(err){
				busy=false;createBtn.disabled=false;createBtn.textContent='Create';
				errorEl.textContent=err.message||'Could not create the lead.';
			}
		});
	}

	if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
	else init();
})();
