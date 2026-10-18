/* TaskM School tab: the PVPHS website (read every morning by TaskM's server, see schoolInfo in functions/index.js),
   filtered to the student's grade, with a small grade-based counselor on top. Urgent school items also join the task
   list so they show in Focus and the Calendar.
   Lives in its own file so index.html (built by build.py) only needs <script src="school.js" defer></script>.
   Uses only what the page exposes: window.TaskMAccount, window.TaskM, window.TaskMTools, window.TASKM_FIREBASE_CONFIG. */
(function(){
 'use strict';
 var d=document,root=d.documentElement;
 var SCK='taskm-school',SCF='taskm-school-filter',busy=false,showAll=false,coachOff=0;
 function A(){return window.TaskMAccount||{};}
 function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 function jl(k,v){try{var o=JSON.parse(localStorage.getItem(k)||'null');return o==null?v:o;}catch(e){return v;}}
 function js(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
 function today(){return window.TaskM&&window.TaskM.todayKey?window.TaskM.todayKey():new Date().toISOString().slice(0,10);}

 // ---------- styles ----------
 var css=
 '#schoolView{display:none}:root[data-view=school] #listView{display:none}:root[data-view=school] #schoolView{display:block}'+
 '#dNav #viewSeg button{display:flex;align-items:center;gap:9px}'+      /* desktop sidebar: icon beside the label */
 '@media (max-width:600px){#viewSeg button{flex-direction:column;font-size:11px;font-weight:600;gap:3px;padding:7px 0 5px;letter-spacing:0}#viewSeg button svg{width:19px;height:19px}}'+  /* five tabs on a phone: icon over label */
 '.sc-chips{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:2px 0 14px;padding-bottom:2px}.sc-chips::-webkit-scrollbar{display:none}'+
 '.sc-chip{flex:none;min-height:34px;padding:0 13px;border:1px solid var(--line);border-radius:999px;background:var(--panel);color:var(--muted);font:600 13px var(--ns-body,inherit);cursor:pointer;touch-action:manipulation}'+
 '.sc-chip[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--on-accent,#fff)}'+
 '.sc-day{margin:16px 2px 6px;font:700 11.5px var(--ns-body,inherit);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}'+
 '.sc-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}'+
 '.sc-it{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:var(--panel)}'+
 '.sc-it.hi{border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}'+
 '.sc-k{grid-row:span 3;width:34px;height:34px;border-radius:10px;display:grid;place-items:center;font-size:16px;background:color-mix(in srgb,var(--sc,var(--accent)) 16%,transparent)}'+
 '.sc-t{margin:0;font:600 15px/1.3 var(--ns-body,inherit);color:var(--text)}'+
 '.sc-m{font-size:12.5px;color:var(--muted);display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center}'+
 '.sc-g{padding:1px 7px;border-radius:999px;background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent);font-weight:700;font-size:11.5px}'+
 '.sc-s{margin:0;font-size:13.5px;line-height:1.45;color:var(--text);opacity:.86}.sc-s a,.sc-tip a{color:var(--accent);font-weight:600;text-decoration:none;white-space:nowrap}'+
 '.sc-more{margin-top:14px}.sc-more>summary{cursor:pointer;list-style:none;font:600 13.5px var(--ns-body,inherit);color:var(--accent);padding:8px 2px}.sc-more>summary::-webkit-details-marker{display:none}'+
 '.sc-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:18px;font-size:12.5px;color:var(--muted)}'+
 '.sc-foot button,.sc-swap{flex:none;white-space:nowrap;border:0;background:none;color:var(--accent);font:600 12.5px var(--ns-body,inherit);cursor:pointer;padding:6px 0}'+
 '.sc-empty{padding:28px 8px;text-align:center;color:var(--muted);font-size:14px}'+
 '.sc-coach{margin:0 0 16px;padding:14px 14px 12px;border-radius:16px;border:1px solid color-mix(in srgb,var(--accent) 30%,var(--line));background:linear-gradient(160deg,color-mix(in srgb,var(--accent) 13%,var(--panel)),var(--panel) 70%)}'+
 '.sc-coach h4{margin:0 0 2px;font:600 15px var(--ns-body,inherit);color:var(--text)}.sc-coach>small{display:block;font-size:12.5px;color:var(--muted);margin-bottom:10px}'+
 '.sc-tips{list-style:none;margin:0;padding:0;display:grid;gap:8px}.sc-tip{display:grid;grid-template-columns:28px minmax(0,1fr);gap:2px 10px;align-items:start}'+
 '.sc-tip>i{grid-row:span 2;width:28px;height:28px;border-radius:9px;display:grid;place-items:center;font-style:normal;font-size:15px;background:color-mix(in srgb,var(--accent) 16%,transparent)}'+
 '.sc-tip b{font:600 14px/1.3 var(--ns-body,inherit);color:var(--text)}.sc-tip span{font-size:13px;line-height:1.4;color:var(--muted)}'+
 '.sc-rel{margin:10px 0 0;padding-top:9px;border-top:1px solid var(--line);font-size:12.5px;color:var(--muted)}.sc-rel b{color:var(--text);font-weight:600}';

 // ---------- the tab ----------
 var ICON='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10l8-5 8 5v10"/><path d="M9.5 20v-5h5v5M3 20h18"/><circle cx="12" cy="10.5" r="1.6"/></svg>';
 function setView(v){root.setAttribute('data-view',v);d.querySelectorAll('#viewSeg button').forEach(function(b){b.classList.toggle('on',b.dataset.view===v);b.setAttribute('aria-selected',b.dataset.view===v);});
  try{localStorage.setItem('org-view',v);}catch(e){}}
 function mount(){var seg=d.getElementById('viewSeg');if(!seg||d.getElementById('schoolView'))return false;
  var st=d.createElement('style');st.id='taskm-school-css';st.textContent=css;d.head.appendChild(st);
  var b=d.createElement('button');b.dataset.view='school';b.setAttribute('role','tab');b.innerHTML=ICON+'<span>School</span>';
  var g=seg.querySelector('[data-view="grades"]'),e=seg.querySelector('[data-view="email"]');seg.insertBefore(b,g?g.nextSibling:e);
  b.onclick=function(){setView('school');};
  var v=d.createElement('div');v.id='schoolView';var gv=d.getElementById('gradesView')||d.getElementById('listView');gv.parentNode.insertBefore(v,gv.nextSibling);
  // the base app only knows its own tabs; reopen School if it was the last one used
  try{if(localStorage.getItem('org-view')==='school')setView('school');}catch(x){}
  return true;}

 // ---------- data ----------
 function data(){return jl(SCK,null);}
 function grade(){var a=A(),g=parseInt(a.profile&&a.profile.grade,10);return g>=9&&g<=12?g:null;}
 function fetchInfo(force){var a=A(),v=data();if(busy||a.demo||!a.uid||!a.token)return Promise.resolve(v);if(!force&&v&&Date.now()-(v.got||0)<3*3600e3)return Promise.resolve(v);
  var cfg=window.TASKM_FIREBASE_CONFIG||{},url='https://us-central1-'+(cfg.projectId||'taskm-sync-d6861')+'.cloudfunctions.net/schoolInfo';busy=true;
  return fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+a.token},body:'{"data":{}}'})
   .then(function(r){return r.json();}).then(function(j){busy=false;if(!j||!j.result)return v;var n={at:j.result.at,items:j.result.items||[],got:Date.now()};js(SCK,n);return n;})
   .catch(function(){busy=false;return v;});}

 // ---------- School tab ----------
 var KIND={no_school:['🏖️','No school','#16a34a'],schedule:['⏰','Schedule','#d97706'],exam:['📝','Finals','#dc2626'],deadline:['⏳','Deadline','#dc2626'],drill:['🚨','Drill','#ea580c'],
  asb:['📣','ASB','#7c3aed'],election:['🗳️','Election','#7c3aed'],counseling:['🧭','Counseling','#0891b2'],college:['🎓','College','#0891b2'],testing:['✏️','Testing','#2563eb'],
  club:['🤝','Clubs','#7c3aed'],sports:['🏅','Sports','#16a34a'],arts:['🎭','Arts','#db2777'],event:['🎉','Event','#5b5bd6'],announcement:['📌','News','#64748b']};
 var GROUP={all:['All',null],dates:['Dates & deadlines',['no_school','schedule','exam','deadline','drill','testing']],events:['Events',['event','arts','sports']],
  plan:['Counseling & college',['counseling','college','testing']],clubs:['Clubs & ASB',['club','asb','election']]};
 function when(it,tk){var n=Math.round((new Date(it.date+'T12:00:00')-new Date(tk+'T12:00:00'))/864e5),x=new Date(it.date+'T12:00:00');
  var lbl=n===0?'Today':n===1?'Tomorrow':x.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});if(it.end_date&&n<0)lbl='Happening now';return {d:n,lbl:lbl};}
 function clock(t){if(!t)return '';var h=+t.slice(0,2),m=t.slice(3);return (h%12||12)+(m==='00'?'':':'+m)+(h<12?' AM':' PM');}
 function row(it){var k=KIND[it.kind]||KIND.event,g=it.grades&&it.grades.length?it.grades.map(function(n){return n+'th';}).join(', '):'',meta=[k[1]];
  if(it.time)meta.push(clock(it.time));if(it.end_date)meta.push('through '+new Date(it.end_date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}));
  return '<li class="sc-it'+(it.importance==='high'?' hi':'')+'" style="--sc:'+k[2]+'"><span class="sc-k" aria-hidden="true">'+k[0]+'</span><p class="sc-t">'+esc(it.title)+'</p>'+
   '<span class="sc-m">'+esc(meta.join(' · '))+(g?'<span class="sc-g">'+esc(g)+' grade</span>':'')+'</span>'+
   (it.summary||it.link?'<p class="sc-s">'+esc(it.summary||'')+(it.link?' <a href="'+esc(it.link)+'" target="_blank" rel="noopener">More</a>':'')+'</p>':'')+'</li>';}

 // Mini counselor: general advice by grade and month (no made-up dates); matching school items are listed underneath.
 var COUNSEL=[
  {g:[9],m:[8,9,10],e:'🤝',t:'Pick one or two clubs to try',w:'Club Rush and first meetings happen early in the year. Going to a couple now is the easiest way to find your people.',k:['club','asb']},
  {g:[9],m:[9,10,11],e:'🗳️',t:'Think about running for class office',w:'Freshman class officer elections are usually in the fall. Watch for ASB election dates.',k:['election','asb']},
  {g:[9,10],m:[9,10,11,12,1,2,3,4,5],e:'📒',t:'Start an activities list',w:'Write down clubs, sports, volunteering and awards as you go. It makes applications and résumés easy later.',k:[]},
  {g:[9,10,11,12],m:[8,9,1],e:'🧭',t:'Check in with your counselor',w:'A quick visit at the start of a semester helps with schedule changes and planning.',k:['counseling'],l:'https://pvphs.pvpusd.net/apps/pages/Counseling'},
  {g:[10],m:[9,10],e:'✏️',t:'Take the PSAT for practice',w:'Sophomore year is a low-pressure practice run for junior year, when the PSAT counts for National Merit.',k:['testing']},
  {g:[10,11],m:[9,10,2,3],e:'🏅',t:'Look into National Honor Society',w:'NHS looks at GPA, service and leadership. Check the requirements and keep track of service hours.',k:['club']},
  {g:[10,11],m:[1,2,3,4],e:'📚',t:'Plan next year’s classes',w:'Course requests happen in late winter. Talk to teachers about which AP or honors classes fit you.',k:['counseling']},
  {g:[10,11],m:[3,4,5],e:'⭐',t:'Run for a club officer role',w:'Most clubs elect next year’s officers in spring. A leadership role is great experience.',k:['club','election','asb']},
  {g:[11],m:[9,10],e:'✏️',t:'PSAT/NMSQT this fall',w:'This one counts for National Merit Scholarships. A little practice beforehand goes a long way.',k:['testing']},
  {g:[10,11,12],m:[10],e:'📝',t:'Register for AP exams on time',w:'AP exam registration happens in the fall. Signing up late costs extra.',k:['testing','deadline'],l:'https://pvphs.pvpusd.net/apps/pages/AP'},
  {g:[11],m:[11,12,1,2],e:'🗓️',t:'Make an SAT/ACT plan',w:'Pick a spring test date, but check first whether your colleges use scores. UCs and CSUs don’t.',k:['testing','college'],l:'https://pvphs.pvpusd.net/apps/pages/CollegeCareerCenter'},
  {g:[11],m:[1,2,3,4,5],e:'🎓',t:'Start a college list',w:'Use MAIA Learning and the College & Career Center to find schools that fit.',k:['college'],l:'https://pvphs.pvpusd.net/apps/pages/CollegeCareerCenter'},
  {g:[11],m:[3,4,5],e:'✉️',t:'Ask two teachers for recommendation letters',w:'Ask in spring of junior year, before teachers get busy in the fall.',k:['college']},
  {g:[11],m:[1,2,3],e:'☀️',t:'Find a summer program or job',w:'Many summer programs have winter deadlines.',k:['college']},
  {g:[12],m:[8,9,10,11],e:'🎓',t:'Work on college applications',w:'Early deadlines are often November 1, and the UC application is usually due November 30.',k:['college','deadline'],l:'https://pvphs.pvpusd.net/apps/pages/CollegeCareerCenter'},
  {g:[12],m:[10,11,12,1,2],e:'💵',t:'Fill out the FAFSA',w:'Financial aid forms open in the fall. Do them with a parent, and catch any FAFSA nights the school hosts.',k:['college']},
  {g:[12],m:[9,10,11,12,1,2,3,4],e:'🏆',t:'Apply for scholarships',w:'Check the College & Career Center for local scholarships. Small ones add up.',k:['college'],l:'https://pvphs.pvpusd.net/apps/pages/CollegeCareerCenter'},
  {g:[12],m:[3,4,5],e:'✅',t:'Compare offers and pick a school',w:'Most colleges ask you to decide by May 1. Send your final transcript after graduation.',k:['college','counseling'],l:'https://pvphs.pvpusd.net/apps/pages/Counseling/TranscriptRequests'},
  {g:[9,10,11,12],m:[11,12,4,5],e:'📖',t:'Get ready for finals',w:'Start reviewing two weeks out. Check the finals schedule so nothing surprises you.',k:['exam']}];
 function coach(v,gr,tk){if(!gr)return '';var mo=new Date(tk+'T12:00:00').getMonth()+1;
  var tips=COUNSEL.filter(function(c){return c.g.indexOf(gr)>=0&&c.m.indexOf(mo)>=0;}).sort(function(a,b){return a.g.length-b.g.length;});  // advice just for this grade first
  if(!tips.length)return '';var n=Math.min(3,tips.length),start=(coachOff*n)%tips.length,pick=[];for(var i=0;i<n;i++)pick.push(tips[(start+i)%tips.length]);
  var kinds={};pick.forEach(function(c){c.k.forEach(function(k){kinds[k]=1;});});
  var rel=(v&&v.items||[]).filter(function(it){return it.date&&kinds[it.kind]&&(it.end_date||it.date)>=tk&&when(it,tk).d<=30&&(!it.grades||!it.grades.length||it.grades.indexOf(gr)>=0);}).slice(0,2);
  return '<div class="sc-coach"><h4>This month for '+gr+'th graders</h4><small>A few things worth doing now</small><ul class="sc-tips">'+
   pick.map(function(c){return '<li class="sc-tip"><i aria-hidden="true">'+c.e+'</i><b>'+esc(c.t)+'</b><span>'+esc(c.w)+(c.l?' <a href="'+esc(c.l)+'" target="_blank" rel="noopener">Learn more</a>':'')+'</span></li>';}).join('')+'</ul>'+
   (rel.length?'<p class="sc-rel">From the school: '+rel.map(function(it){return '<b>'+esc(it.title)+'</b> ('+esc(when(it,tk).lbl)+')';}).join(' · ')+'</p>':'')+
   (tips.length>n?'<button type="button" class="sc-swap" data-sccoach>Show other ideas</button>':'')+'</div>';}

 function paint(){var box=d.getElementById('schoolView');if(!box)return;var v=data(),tk=today(),gr=grade(),a=A(),f=jl(SCF,'all');if(!GROUP[f])f='all';
  var h='<section class="panel tc-panel"><div class="tc-hd"><h3>School</h3><small>'+esc(v&&v.at?'From pvphs.pvpusd.net · updated '+new Date(v.at).toLocaleString('en-US',{weekday:'short',hour:'numeric',minute:'2-digit'}):'From the PVPHS website, checked every morning')+'</small></div>'+
   coach(v,gr,tk)+'<div class="sc-chips" role="group" aria-label="Show">'+Object.keys(GROUP).map(function(k){return '<button type="button" class="sc-chip" data-scf="'+k+'" aria-pressed="'+(k===f)+'">'+GROUP[k][0]+'</button>';}).join('')+'</div>';
  if(!v||!v.items){box.innerHTML=h+'<p class="sc-empty">'+(a.demo?'Sign in to see what’s happening at PVPHS.':busy?'Reading the school website…':'Nothing from the school website yet. Check back soon.')+'</p></section>';return;}
  var kinds=GROUP[f][1],mine=function(it){return showAll||!gr||!it.grades||!it.grades.length||it.grades.indexOf(gr)>=0;};
  var L=v.items.filter(function(it){return mine(it)&&(!kinds||kinds.indexOf(it.kind)>=0);}),hidden=v.items.filter(function(it){return !mine(it);}).length;
  var dated=L.filter(function(it){return it.date&&(it.end_date||it.date)>=tk;}),soon=dated.filter(function(it){return when(it,tk).d<=14;}),later=dated.filter(function(it){return when(it,tk).d>14;}),info=L.filter(function(it){return !it.date;});
  function days(list){var out='',last='';list.forEach(function(it){var w=when(it,tk);if(w.lbl!==last){if(last)out+='</ul>';out+='<h4 class="sc-day">'+esc(w.lbl)+'</h4><ul class="sc-list">';last=w.lbl;}out+=row(it);});return out+(last?'</ul>':'');}
  if(!soon.length&&!later.length&&!info.length)h+='<p class="sc-empty">Nothing here right now.</p>';
  h+=days(soon);
  if(later.length)h+='<details class="sc-more"'+(soon.length?'':' open')+'><summary>Later this year ('+later.length+')</summary>'+days(later)+'</details>';
  if(info.length)h+='<details class="sc-more"><summary>Good to know ('+info.length+')</summary><ul class="sc-list">'+info.map(row).join('')+'</ul></details>';
  h+='<div class="sc-foot"><span>'+(gr?(showAll?'Showing every grade':'Showing '+gr+'th grade and everyone'+(hidden?' · '+hidden+' for other grades hidden':'')):'Set your grade in Settings to filter')+'</span>'+
   (gr?'<button type="button" data-scall>'+(showAll?'Just my grade':'All grades')+'</button>':'')+'</div></section>';
  box.innerHTML=h;}

 // ---------- urgent school items go into the task list (Focus and Calendar) ----------
 var URG={deadline:'form',no_school:'event',schedule:'event',drill:'event',exam:'test',testing:'test',election:'event'};
 function redraw(){if(!d.hidden)try{d.dispatchEvent(new Event('visibilitychange'));}catch(e){}var X=window.TaskMTools;if(X&&X.reload)X.reload();}
 function syncTasks(){var T=window.TaskM,v=data();if(!T||!T.items||!v||!v.items)return;var tk=today(),gr=grade();
  var norm=function(t){return String(t||'').toLowerCase().replace(/[^a-z0-9]+/g,'').slice(0,14);},have={},want={};
  T.items.forEach(function(it){if(!it.school_sync&&it.due)have[String(it.due).slice(0,10)+'|'+norm(it.title)]=1;});
  v.items.forEach(function(it){if(!URG[it.kind]||it.importance!=='high'||!it.date)return;var w=when(it,tk).d;if(w<0||w>21)return;
   if(gr&&it.grades&&it.grades.length&&it.grades.indexOf(gr)<0)return;if(!have[it.date+'|'+norm(it.title)])want[it.id]=it;});
  var ch=false;for(var i=T.items.length-1;i>=0;i--){var x=T.items[i];if(x.school_sync&&!want[x.id]){T.items.splice(i,1);ch=true;}else if(x.school_sync)delete want[x.id];}
  Object.keys(want).forEach(function(id){var it=want[id],o=new Date(it.date+'T12:00:00').toString().match(/GMT([+-]\d{2})(\d{2})/),z=o?o[1]+':'+o[2]:'-08:00',
    imp=it.kind==='deadline'||it.kind==='exam'||it.kind==='no_school'?'High':'Medium';
   T.items.push({id:id,title:it.title,type:URG[it.kind],category:'School',class_short:'PVPHS',due:it.time?it.date+'T'+it.time+':00'+z:it.date,due_sort:it.date+'T'+(it.time||'23:59')+':00'+z,
    due_has_time:!!it.time,status:'open',importance_base:imp,importance:imp,source:'PVPHS website',description:it.summary||'',notes:'',link:it.link||'',school_sync:true});ch=true;});
  if(ch)redraw();}

 function open(){paint();fetchInfo(false).then(function(){paint();syncTasks();});}
 function start(){if(!mount())return;
  d.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-scf],[data-scall],[data-sccoach]');if(!b)return;
   if(b.hasAttribute('data-sccoach'))coachOff++;else if(b.dataset.scf)js(SCF,b.dataset.scf);else showAll=!showAll;paint();});
  new MutationObserver(function(){if(root.getAttribute('data-view')==='school')open();}).observe(root,{attributes:true,attributeFilter:['data-view']});
  if(root.getAttribute('data-view')==='school')open();
  var a=A();if(a.onReady)a.onReady(function(x){if(x&&!x.demo)fetchInfo(false).then(function(){syncTasks();if(root.getAttribute('data-view')==='school')paint();});});}
 if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',function(){setTimeout(start,0);});else setTimeout(start,0);
})();
