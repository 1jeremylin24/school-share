/* TaskM owner tools: when TaskM's owner is signed in to their normal student account, the account panel also shows
   "Admin page" and "Preview parent view" (a sample parent dashboard, see A.previewParent in connect.js).
   The owner check here only decides which buttons to show. The admin data itself is checked on the server
   (isOwner in functions/lib.js), so copying this list or editing this file opens nothing.
   Lives in its own file so index.html (built by build.py) only needs <script src="owner.js" defer></script>. */
(function(){
 'use strict';
 var OWNER_HASHES=['5fe6295b85aa4d852546936626db9190bb8a9eb26e955930b605d9a26ec9dd91','03e02d55ad4902955526cf9abc17820179d63d68b620e457374c96b209bf2a8c'];
 var A=window.TaskMAccount,owner=false,wantPreview=/[?&]parent-preview\b/.test(location.search);
 if(!A||!window.firebase||!firebase.apps||!firebase.apps.length||!window.crypto||!crypto.subtle)return;
 function sha(s){return crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)).then(function(b){return Array.from(new Uint8Array(b)).map(function(x){return x.toString(16).padStart(2,'0');}).join('');});}
 var rowHtml=A.rowHtml;
 A.rowHtml=function(state,label){var p=A.profile||{},h=rowHtml.apply(A,arguments);
  if(!owner||A.demo||p.role==='parent')return h;
  return h+'<div class="tt-syncb"><a class="tt-btn" href="admin.html" style="text-decoration:none">Admin page</a><button type="button" class="tt-btn" data-ownpv>Preview parent view</button></div>';};
 function preview(){if(A.previewParent)A.previewParent(true);}
 document.addEventListener('click',function(e){if(e.target.closest&&e.target.closest('[data-ownpv]'))preview();});
 firebase.auth().onAuthStateChanged(function(u){
  var bar=function(yes){if(window.TaskMOwnerBar)TaskMOwnerBar.set(yes);};   // owner-bar.js: Home / My TaskM / Parent view / Admin
  if(!u||!u.email||!u.emailVerified){owner=false;bar(false);return;}
  sha(String(u.email).toLowerCase()).then(function(h){owner=OWNER_HASHES.indexOf(h)>=0;bar(owner);if(!owner)return;
   if(window.TaskMSync&&TaskMSync.paint)TaskMSync.paint();
   if(wantPreview){wantPreview=false;history.replaceState(null,'',location.pathname+location.hash);
    var go=function(){var p=A.profile||{};if(p.role!=='parent')setTimeout(preview,300);};
    if(A.profile)go();else A.onReady(function(acc){if(acc&&acc.profile&&go){var g=go;go=null;g();}});}
  },function(){});});
})();
