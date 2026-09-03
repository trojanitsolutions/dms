(function(){
  var btn=document.getElementById('sidebar-toggle');
  if(!btn)return;
  btn.addEventListener('click',function(){document.body.classList.toggle('sidebar-expanded');});
  document.querySelectorAll('.nav-link').forEach(function(a){
    a.addEventListener('click',function(){if(!((window.innerWidth>=1200&&matchMedia('(pointer: fine)').matches)||window.innerWidth>=1367))document.body.classList.remove('sidebar-expanded');});
  });
})();

(function(){
  var overlay=document.getElementById('logout-confirm-overlay');
  if(!overlay)return;
  function openLogoutConfirm(e){e.preventDefault();overlay.classList.add('open')}
  function closeLogoutConfirm(){overlay.classList.remove('open')}
  document.querySelectorAll('a[href="/sales-logout"]').forEach(function(a){
    a.addEventListener('click',openLogoutConfirm);
  });
  var cancelBtn=document.getElementById('logout-cancel-btn');
  if(cancelBtn)cancelBtn.addEventListener('click',closeLogoutConfirm);
  var confirmBtn=document.getElementById('logout-confirm-btn');
  if(confirmBtn)confirmBtn.addEventListener('click',function(){
    window.location.href='/sales-logout';
  });
  overlay.addEventListener('click',function(e){if(e.target===overlay)closeLogoutConfirm()});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')closeLogoutConfirm()});
})();
