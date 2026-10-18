/* Home button: on a computer, a "Home" button next to Share (and the sidebar logo) opens the TaskM home page (taskm-school.web.app/, app/index.html).
   The home page shows "Open TaskM" to signed-in visitors, so people can go back and forth.
   Lives in its own file so index.html (built by build.py) only needs <script src="home-link.js" defer></script>. */
(function(){
 'use strict';
 if(!matchMedia('(hover:hover) and (pointer:fine)').matches||window.Capacitor)return;
 var ICON='<svg class="tt-i" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10.5 12 4l8 6.5"/><path d="M6 9v10h12V9"/><path d="M10 19v-5h4v5"/></svg>';
 function add(){
  var share=document.getElementById('shareBtn');
  if(share&&!document.getElementById('homeBtn')){
   var a=document.createElement('a');a.className='btn ib';a.id='homeBtn';a.href='/';
   a.title='TaskM home page';a.setAttribute('aria-label','Home page');a.style.textDecoration='none';
   a.innerHTML='<span class="bi">'+ICON+'</span><span class="bl"> Home</span>';
   share.parentNode.insertBefore(a,share);}
  var wm=document.querySelector('#dSide .tt-wm');   // the TaskM logo at the top of the sidebar
  if(wm&&!wm.dataset.home){wm.dataset.home='1';wm.style.cursor='pointer';wm.title='TaskM home page';
   wm.addEventListener('click',function(){location.href='/';});}
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',add);else add();
 setTimeout(add,1500);   // the header is restyled after load; make sure the button is still there
})();
