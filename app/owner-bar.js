/* Owner switcher: on TaskM's owner account, a small bar at the bottom of every page jumps between
   Home (/), My TaskM (/app), Parent view (sample parent dashboard) and Admin (admin.html).
   It shows only after owner.js or admin.html has confirmed the owner on this device (localStorage taskm-owner), and only while
   someone is signed in (taskm-acct-uid, cleared by Sign out; admin.html clears the flag itself when it signs out).
   It only shows links: admin data is still checked on the server, so the flag opens nothing. */
(function(){
 'use strict';
 var KEY='taskm-owner',bar=null;
 function on(){try{return localStorage.getItem(KEY)==='1'&&(!!localStorage.getItem('taskm-acct-uid')||page()==='admin');}catch(e){return false;}}
 function page(){var p=location.pathname;
  if(/admin(\.html)?$/.test(p))return 'admin';
  if(/^\/app(\.html)?$/.test(p))return document.documentElement.classList.contains('taskm-parent')?'parent':'app';
  return 'home';}
 var LINKS=[['home','Home','/'],['app','My TaskM','/app'],['parent','Parent view','/app?parent-preview'],['admin','Admin','/admin.html']];
 function paint(){
  if(!on()){if(bar){bar.remove();bar=null;}return;}
  if(!bar){
   var st=document.createElement('style');
   st.textContent='.tm-ob{position:fixed;left:50%;bottom:calc(14px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:2147483000;display:flex;gap:2px;padding:4px;border-radius:999px;'+
    'background:rgba(14,16,32,.88);border:1px solid rgba(190,192,255,.22);box-shadow:0 10px 30px -8px rgba(0,0,0,.6);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);font:600 13px/1 "Instrument Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}'+
    '.tm-ob a{display:inline-flex;align-items:center;height:32px;padding:0 13px;border-radius:999px;color:#c9cbe6;text-decoration:none;white-space:nowrap;touch-action:manipulation;user-select:none;-webkit-user-select:none;transition:background-color 150ms ease,color 150ms ease}'+
    '.tm-ob a[aria-current=page]{background:#eeeef8;color:#0b0c18}'+
    '.tm-ob a:active{transform:scale(.97)}'+
    '@media (hover:hover) and (pointer:fine){.tm-ob a:not([aria-current]):hover{background:rgba(255,255,255,.08);color:#fff}}'+
    '@media (max-width:700px){.tm-ob{bottom:calc(84px + env(safe-area-inset-bottom,0px))}.tm-ob a{padding:0 10px}}'+
    'html.taskm-parent #tmOwnerBar#tmOwnerBar#tmOwnerBar{display:flex!important}'+   // the parent view hides everything else in <body>
    'html.au-open .tm-ob{display:none!important}'+   // never over the log in / sign up page
    '@media print{.tm-ob{display:none}}';
   document.head.appendChild(st);
   bar=document.createElement('nav');bar.className='tm-ob';bar.id='tmOwnerBar';bar.setAttribute('aria-label','Owner pages');
   bar.innerHTML=LINKS.map(function(l){return '<a href="'+l[2]+'" data-ob="'+l[0]+'">'+l[1]+'</a>';}).join('');
   bar.addEventListener('click',function(e){var a=e.target.closest('a[data-ob]');if(!a)return;var A=window.TaskMAccount,k=a.dataset.ob,cur=page();
    // inside the app, switch to and from the sample parent view without a reload
    if(A&&A.previewParent&&(cur==='app'||cur==='parent')&&(k==='app'||k==='parent')){e.preventDefault();if(k!==cur){A.previewParent(k==='parent');setTimeout(mark,50);}}});
   document.body.appendChild(bar);}
  mark();}
 function mark(){if(!bar)return;var c=page();bar.querySelectorAll('a').forEach(function(a){if(a.dataset.ob===c)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});}
 window.TaskMOwnerBar={set:function(yes){try{if(yes)localStorage.setItem(KEY,'1');else localStorage.removeItem(KEY);}catch(e){}paint();},paint:paint};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',paint);else paint();
 new MutationObserver(mark).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
 // signing out in another tab, or coming back to this page with Back, updates the bar right away
 addEventListener('storage',function(e){if(!e.key||e.key===KEY||e.key==='taskm-acct-uid')paint();});
 addEventListener('pageshow',paint);
})();
