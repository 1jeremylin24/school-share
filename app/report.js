/* TaskM error reports: when something in the app crashes, a short note goes to TaskM's server (reportError in
   functions/index.js) so the owner's admin page (admin.html) can show what broke. Only the error message, where it
   happened and the app version are sent, never homework; the server also strips emails and links.
   Also notes once a day whether this person uses the website or the iPhone app (for the admin page's counts).
   Lives in its own file so index.html (built by build.py) only needs <script src="report.js" defer></script>. */
(function(){
 'use strict';
 var cfg=window.TASKM_FIREBASE_CONFIG;
 if(!cfg||!cfg.projectId)return;                 // demo copies have no server
 var FN='https://us-central1-'+cfg.projectId+'.cloudfunctions.net/reportError',sent={},left=5;
 function A(){return window.TaskMAccount||{};}
 function app(){try{return window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform()?'iphone':'web';}catch(e){return 'web';}}
 function where(file){var m=String(file||'').match(/\/([\w.-]+\.js)(?:[?#].*)?$/);return m?m[1]:(String(file||'').indexOf(location.origin)===0?'index.html':'');}
 function send(msg,file,stack){
  msg=String(msg||'').slice(0,300);
  if(!msg||left<=0||sent[msg])return;
  if(/^Script error\.?$|ResizeObserver loop|chrome-extension:|moz-extension:|safari-extension:/i.test(msg+' '+(file||'')))return;
  if(file&&String(file).indexOf(location.origin)!==0)return;   // only TaskM's own code, not browser add-ons or Google's scripts
  sent[msg]=1;left--;
  var a=A(),h={'Content-Type':'application/json'};
  if(a.token&&!a.demo)h.Authorization='Bearer '+a.token;
  var body={msg:msg,where:where(file),stack:String(stack||'').slice(0,900),page:(location.hash||'').slice(0,40),app:app(),
   ext:document.documentElement.getAttribute('data-taskm-ext-v')||''};
  try{fetch(FN,{method:'POST',headers:h,body:JSON.stringify({data:body}),keepalive:true}).catch(function(){});}catch(e){}
 }
 window.addEventListener('error',function(e){if(!e||e.target!==window&&e.target&&e.target.tagName)return;   // skip broken images
  send(e.message,e.filename,e.error&&e.error.stack);});
 window.addEventListener('unhandledrejection',function(e){var r=e&&e.reason;if(!r||!(r instanceof Error))return;   // our own "couldn't reach" objects aren't crashes
  send(r.message,(String(r.stack||'').match(/https?:\/\/[^\s)]+?\.(?:js|html)/)||[location.href])[0],r.stack);});
 window.TaskMReport=function(msg,stack){send(msg,location.href,stack);};

 // Website or iPhone app, noted once a day next to the "last opened" note
 function platPing(){var a=A();if(!a.uid||!a.token||a.demo)return;var k='taskm-plat',mark=a.uid+'|'+new Date().toDateString()+'|'+app();
  try{if(localStorage.getItem(k)===mark)return;}catch(e){}
  var body={};body[app()]=true;
  fetch(cfg.databaseURL+'/users/'+a.uid+'/beta/plat.json?auth='+encodeURIComponent(a.token),{method:'PATCH',body:JSON.stringify(body)})
   .then(function(r){if(r.ok)try{localStorage.setItem(k,mark);}catch(e){}},function(){});}
 setTimeout(platPing,8000);
 document.addEventListener('visibilitychange',function(){if(!document.hidden)setTimeout(platPing,3000);});
})();
