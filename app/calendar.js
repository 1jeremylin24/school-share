/* TaskM Calendar revamp (checklist item 4).
   Sits on top of the calendar that index.html already draws (Agenda / Month / Week, heavy days, email to-dos,
   details popup, drag to reschedule), so nothing it does is lost. This file adds:
   - every item colored by its class (same colors as the sidebar), priority kept as a small marker
   - school days off shaded (from the school calendar items and the PVPHS website data)
   - on phones, tap a day in Month to see everything due that day under the month, without a popup; swipe to change months
   Lives in its own file so index.html (built by build.py) only needs <script src="calendar.js" defer></script>.
   Uses only what the page exposes: window.TaskM and the #calView markup. */
(function(){
 'use strict';
 var d=document,root=d.documentElement;
 var PAL=['#4f5bd5','#d9480f','#2b8a3e','#ae3ec9','#1c7ed6','#e8590c','#0c8599','#c2255c','#5c940d','#7048e8','#f08c00','#495057'];
 var DOW=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],MON=['January','February','March','April','May','June','July','August','September','October','November','December'];
 var SEL='taskm-calday';
 function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 function T(){return window.TaskM;}
 function today(){var t=T();return t&&t.todayKey?t.todayKey():new Date().toISOString().slice(0,10);}
 function kd(k){var a=k.split('-');return new Date(+a[0],+a[1]-1,+a[2]);}
 function key(x){return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');}
 var PHONE=window.matchMedia?matchMedia('(max-width:600px)'):null;
 function isPhone(){return !!(PHONE&&PHONE.matches);}

 // ---------- styles ----------
 var css=
 /* chips: class color fill, class dot, priority pip (High red, Medium amber, Low none) */
 '#calView .chip2[data-id]{--cc:var(--muted);border:0!important;border-radius:7px;background:color-mix(in srgb,var(--cc) 13%,var(--panel))!important;color:var(--text);'+
  'padding:3px 7px 3px 18px;position:relative;box-shadow:none;transition:transform 120ms cubic-bezier(.23,1,.32,1),background-color 150ms ease;touch-action:manipulation;-webkit-user-select:none;user-select:none}'+
 '#calView .chip2[data-id]::before{content:"";position:absolute;left:7px;top:9px;width:6px;height:6px;border-radius:50%;background:var(--cc)}'+
 '#calView .chip2[data-id]:active{transform:scale(.97)}'+
 '@media (hover:hover) and (pointer:fine){#calView .chip2[data-id]:hover{background:color-mix(in srgb,var(--cc) 22%,var(--panel))!important}}'+
 '#calView .chip2.i-high[data-id]::after,#calView .chip2.i-medium[data-id]::after{content:"";position:absolute;right:6px;top:6px;width:5px;height:5px;border-radius:50%;background:var(--high)}'+
 '#calView .chip2.i-medium[data-id]::after{background:var(--med)}'+
 '#calView .chip2.i-high[data-id],#calView .chip2.i-medium[data-id]{padding-right:16px}'+
 '#calView .chip2.done[data-id]{opacity:.55}#calView .chip2.past[data-id]{opacity:.6}'+
 '#calView .chip2 .sub2{color:color-mix(in srgb,var(--cc) 55%,var(--muted))}'+
 '#calView .cx-type{display:inline-block;margin-right:5px;padding:0 5px;border-radius:4px;font-size:9.5px;font-weight:800;letter-spacing:.06em;line-height:15px;vertical-align:1px;background:var(--cc);color:#fff}'+
 /* month grid on phones: class-colored dots */
 '@media (max-width:600px){#calView .cal-grid:not(.week) .chip2[data-id]{padding:0;background:var(--cc)!important}#calView .cal-grid:not(.week) .chip2[data-id]::before,#calView .cal-grid:not(.week) .chip2[data-id]::after{display:none}}'+
 /* days off and short days */
 '#calView .cal-cell.cx-off,#calView .ag-day.cx-off{background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--muted) 9%,transparent) 0 6px,transparent 6px 12px)}'+
 '#calView .cx-offl{display:block;font-size:10.5px;font-weight:700;letter-spacing:.02em;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
 '#calView .cx-short{color:var(--accent)}'+
 '#calView .cal-cell.cx-wkend:not(.cx-off){background:color-mix(in srgb,var(--muted) 4%,var(--panel))}'+
 /* selected day */
 '#calView .cal-cell.cx-sel{box-shadow:inset 0 0 0 2px var(--accent)}'+
 '#calView .cal-cell[data-day]{cursor:pointer}'+
 /* day panel */
 '.cx-pane{border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:14px 14px 10px;min-width:0}'+
 '.cx-pane h3{margin:0;font-size:17px;line-height:1.25;letter-spacing:-.01em;color:var(--text)}'+
 '.cx-ph{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:2px}'+
 '.cx-rel{font-size:12.5px;font-weight:600;color:var(--accent)}'+
 '.cx-meta{font-size:12.5px;color:var(--muted);margin:0 0 10px}'+
 '.cx-meta b{color:var(--high)}'+
 '.cx-list{display:grid;gap:6px}'+
 '.cx-row{--cc:var(--muted);display:grid;grid-template-columns:4px minmax(0,1fr) auto;gap:0 10px;align-items:center;width:100%;min-height:48px;padding:8px 10px 8px 8px;border:0;border-radius:10px;'+
  'background:color-mix(in srgb,var(--cc) 9%,var(--panel));color:var(--text);font:inherit;text-align:left;cursor:pointer;touch-action:manipulation;-webkit-user-select:none;user-select:none;'+
  'transition:transform 120ms cubic-bezier(.23,1,.32,1),background-color 150ms ease}'+
 '.cx-row:active{transform:scale(.98)}'+
 '@media (hover:hover) and (pointer:fine){.cx-row:hover{background:color-mix(in srgb,var(--cc) 16%,var(--panel))}}'+
 '.cx-row:focus-visible{outline:2px solid var(--accent);outline-offset:2px}'+
 '.cx-bar{width:4px;align-self:stretch;border-radius:2px;background:var(--cc)}'+
 '.cx-t{font-size:14.5px;font-weight:600;line-height:1.3;overflow-wrap:anywhere}'+
 '.cx-row.done .cx-t{text-decoration:line-through;opacity:.6}'+
 '.cx-s{display:block;font-size:12.5px;color:var(--muted);margin-top:1px}'+
 '.cx-p{font-size:11px;font-weight:700;padding:2px 7px;border-radius:999px;white-space:nowrap}'+
 '.cx-p.high{background:var(--high-bg);color:var(--high)}.cx-p.medium{background:var(--med-bg);color:var(--med)}.cx-p.over{background:var(--high);color:#fff}'+
 '.cx-none{padding:14px 2px 8px;color:var(--muted);font-size:14px}'+
 '.cx-pane .chip2,.cx-pane [data-xid]{min-height:44px}'+
 /* class legend */
 '#calView .cx-legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin:10px 2px 0;font-size:12.5px;color:var(--muted)}'+
 '#calView .cx-legend span{display:inline-flex;align-items:center;gap:6px}'+
 '#calView .cx-legend i{width:9px;height:9px;border-radius:50%;background:var(--cc)}'+
 '#calView .cx-legend i.off{border-radius:3px;background:repeating-linear-gradient(135deg,var(--muted) 0 2px,transparent 2px 4px)}'+
 '#calView .cx-legend i.pri{width:6px;height:6px}'+
 '#calBody .cx-pane{margin-top:12px}'+
 '@media (prefers-reduced-motion:reduce){#calView .chip2[data-id],.cx-row{transition:background-color 150ms ease}}';
 var st=d.createElement('style');st.id='cx-css';st.textContent=css;(d.head||root).appendChild(st);

 // ---------- class colors: the sidebar's dots when it is drawn, otherwise the same palette in the same order ----------
 var CC={};
 function colors(){var t=T(),cs={};CC={};
  if(t&&t.items){t.items.forEach(function(it){if(it.category)cs[it.category]=1;});Object.keys(cs).sort().forEach(function(c,i){CC[c]=PAL[i%PAL.length];});}
  d.querySelectorAll('#dCls .dk-f[data-v]').forEach(function(b){var dot=b.querySelector('.dk-dot');if(dot&&dot.style.background)CC[b.dataset.v]=dot.style.background;});}
 function cc(cat){return CC[cat]||'var(--muted)';}
 function byId(id){var t=T();if(!t||!t.items)return null;for(var i=0;i<t.items.length;i++)if(t.items[i].id===id)return t.items[i];return null;}

 // ---------- school days off ----------
 var OFF=/\b(no school|no classes|holiday|break|recess|staff development|professional development|non[- ]student|school closed|day off)\b/i,
     SHORT=/\b(minimum day|late start|early (dismissal|release)|short(ened)? day)\b/i;
 function schoolDays(){var o={},t=T();
  function add(k,title){if(!k)return;k=String(k).slice(0,10);var off=OFF.test(title),sh=!off&&SHORT.test(title);if(!off&&!sh)return;
   if(!o[k]||(off&&!o[k].off))o[k]={off:off,label:off?'No school':(title.match(SHORT)||[''])[0].replace(/^./,function(c){return c.toUpperCase();})};}
  if(t&&t.items)t.items.forEach(function(it){if(/^cal-/.test(it.id)||it.school_sync||it.category==='School')add(it.due_sort||it.due,it.title||'');});
  try{var s=JSON.parse(localStorage.getItem('taskm-school')||'null');(s&&s.items||[]).forEach(function(it){if(it.kind==='no_school')add(it.date,'No school '+(it.title||''));else add(it.date,it.title||'');});}catch(e){}
  return o;}

 // ---------- the day panel ----------
 var sel=null;try{sel=sessionStorage.getItem(SEL);}catch(e){}
 function vis(it){var t=T();return (t.show()||!t.isChecked(it.id))&&!(t.swHidden&&t.swHidden(it));}
 var LV=['Low','Medium','High'];
 function dayItems(k){var t=T();return t.items.filter(function(it){return it.due_sort&&it.due_sort.slice(0,10)===k&&vis(it);})
  .sort(function(a,b){return t.isChecked(a.id)-t.isChecked(b.id)||LV.indexOf(b.importance)-LV.indexOf(a.importance)||(a.due_sort<b.due_sort?-1:1);});}
 function tm(it){if(!it.due_has_time)return '';var m=it.due_sort.match(/T(\d\d):(\d\d)/);if(!m)return '';var h=+m[1],ap=h>=12?' PM':' AM';h=h%12||12;return h+(m[2]!=='00'?':'+m[2]:'')+ap;}
 function isBig(it){return it.status==='open'&&!it.optional&&!T().isChecked(it.id)&&(it.type==='test'||it.type==='quiz'||(it.type!=='event'&&it.importance_base==='High'));}
 function row(it){var t=T(),ck=t.isChecked(it.id),ov=it.overdue&&!ck,time=tm(it),
   sub=[it.category,it.type&&it.type!=='event'?it.type:'',time].filter(Boolean).join(' · '),
   pip=ov?'<span class="cx-p over">Overdue</span>':ck?'':it.importance==='High'?'<span class="cx-p high">High</span>':it.importance==='Medium'?'<span class="cx-p medium">Medium</span>':'';
  return '<button type="button" class="cx-row'+(ck?' done':'')+'" data-cxid="'+esc(it.id)+'" style="--cc:'+cc(it.category)+'"><span class="cx-bar"></span>'+
   '<span><span class="cx-t">'+esc(it.title)+'</span><span class="cx-s">'+esc(sub)+'</span></span>'+pip+'</button>';}
 function pane(k,days){var t=T(),x=kd(k),its=dayItems(k),ex=[],td=today(),tom=key(new Date(kd(td).getFullYear(),kd(td).getMonth(),kd(td).getDate()+1));
  try{t.extras().forEach(function(p){try{ex=ex.concat(p.day(k,true)||[]);}catch(e){}});}catch(e){}
  var big=k<td?0:its.filter(isBig).length,sd=days[k],rel=k===td?'Today':k===tom?'Tomorrow':'';
  var meta=[];if(sd)meta.push(esc(sd.label));if(big>=2)meta.push('<b>Heavy day</b> · '+big+' tests, quizzes or big deadlines');
  var n=its.length+ex.length;if(!meta.length&&n)meta.push(n+(n===1?' item':' items'));
  return '<section class="cx-pane" aria-live="polite"><div class="cx-ph"><h3>'+DOW[x.getDay()]+', '+MON[x.getMonth()].slice(0,3)+' '+x.getDate()+'</h3>'+(rel?'<span class="cx-rel">'+rel+'</span>':'')+'</div>'+
   (meta.length?'<p class="cx-meta">'+meta.join(' · ')+'</p>':'')+
   (n?'<div class="cx-list">'+its.map(row).join('')+ex.join('')+'</div>':'<div class="cx-none">'+(sd&&sd.off?'No school. Enjoy the day.':'Nothing due. A good day to get ahead.')+'</div>')+'</section>';}

 // ---------- decorate whatever the calendar just drew ----------
 var body,busy=false;
 function mode(){var on=d.querySelector('#calModeSeg button.on');return on?on.dataset.mode:'month';}
 function decorate(){if(busy||!body||!T())return;busy=true;try{
  colors();var days=schoolDays(),m=mode(),grid=body.querySelector('.cal-grid'),td=today();
  body.querySelectorAll('.chip2[data-id]').forEach(function(c){var it=byId(c.dataset.id);if(!it)return;c.style.setProperty('--cc',cc(it.category));
   if(!c.querySelector('.cx-type')&&(it.type==='test'||it.type==='quiz')&&!(grid&&!grid.classList.contains('week')&&isPhone())){var ref=c.querySelector('.tm')||c.querySelector('.ov');
    var tag=d.createElement('span');tag.className='cx-type';tag.textContent=it.type==='test'?'TEST':'QUIZ';c.insertBefore(tag,ref?ref.nextSibling:c.firstChild);}});
  body.querySelectorAll('.cal-cell[data-day],.ag-day[data-day]').forEach(function(c){var k=c.dataset.day,sd=days[k],dw=kd(k).getDay();
   c.classList.toggle('cx-off',!!(sd&&sd.off));c.classList.toggle('cx-wkend',c.classList.contains('cal-cell')&&(dw===0||dw===6));
   var said=[].some.call(c.querySelectorAll('.chip2[data-id]'),function(x){var it=byId(x.dataset.id);return it&&(OFF.test(it.title)||SHORT.test(it.title));});
   if(sd&&!said&&!c.querySelector('.cx-offl')){var l=d.createElement('span');l.className='cx-offl'+(sd.off?'':' cx-short');l.textContent=sd.label;
    var dn=c.querySelector('.dnum,.ag-h');if(dn)dn.insertAdjacentElement('afterend',l);else c.insertBefore(l,c.firstChild);}});
  // day panel under the month on phones
  var old=body.querySelector('.cx-pane');if(old)old.remove();
  var showPane=grid&&!grid.classList.contains('week')&&isPhone();
  if(showPane){var cells=[].slice.call(grid.querySelectorAll('.cal-cell[data-day]'));
   var inMonth=cells.filter(function(c){return !c.classList.contains('other');}).map(function(c){return c.dataset.day;});
   if(!sel||inMonth.indexOf(sel)<0)sel=inMonth.indexOf(td)>=0?td:inMonth[0];
   cells.forEach(function(c){var x=kd(c.dataset.day);c.classList.toggle('cx-sel',c.dataset.day===sel);c.setAttribute('role','button');c.setAttribute('aria-label',DOW[x.getDay()]+' '+MON[x.getMonth()]+' '+x.getDate());c.setAttribute('aria-pressed',String(c.dataset.day===sel));});
   body.insertAdjacentHTML('beforeend',pane(sel,days));}
  legend();
 }finally{busy=false;}}
 function legend(){var lg=d.querySelector('#calView .legend');if(!lg)return;var t=T(),cs={};
  t.items.forEach(function(it){if(it.due_sort&&vis(it))cs[it.category]=1;});
  var h=Object.keys(cs).sort().map(function(c){return '<span><i style="--cc:'+cc(c)+'"></i>'+esc(c)+'</span>';}).join('')+
   '<span><i class="off"></i>No school</span><span><i class="pri" style="--cc:var(--high)"></i>High</span><span><i class="pri" style="--cc:var(--med)"></i>Medium</span>';
  var el=d.querySelector('#calView .cx-legend');if(!el){el=d.createElement('div');el.className='cx-legend';lg.parentNode.insertBefore(el,lg);}
  if(el.innerHTML!==h)el.innerHTML=h;
  // the old importance legend: keep its hints (checked, faded, overdue, heavy day), drop the High/Medium/Low swatches it shared with chips
  lg.querySelectorAll('.sw').forEach(function(s){var p=s.parentNode;if(p&&p.parentNode===lg)p.hidden=true;});}

 function start(){body=d.getElementById('calBody');if(!body||!T())return;
  function mine(n){return n.nodeType===1&&/(^| )cx-/.test(n.className||'');}
  new MutationObserver(function(rs){if(busy)return;   // skip our own day panel going in or out
   if(rs.every(function(r){return [].every.call(r.addedNodes,mine)&&[].every.call(r.removedNodes,mine);}))return;decorate();}).observe(body,{childList:true});
  // phones: tap a day in Month to list it under the month (instead of a popup). Items in the list open their details.
  body.addEventListener('click',function(e){var t=e.target;
   var r=t.closest('.cx-row');if(r){e.stopPropagation();var it=byId(r.dataset.cxid);if(it&&T().detail)T().detail(it);return;}
   var c=t.closest('.cal-grid:not(.week) .cal-cell[data-day]');if(!c||!isPhone())return;
   e.stopPropagation();sel=c.dataset.day;try{sessionStorage.setItem(SEL,sel);}catch(x){}
   if(c.classList.contains('other')){var f=body.querySelector('.cal-cell:not(.other)'),nx=d.getElementById(f&&sel<f.dataset.day?'calPrev':'calNext');if(nx)nx.click();return;}
   var tp=d.getElementById('calTip');if(tp)tp.style.display='none';   // a tap fakes a hover; don't leave its tooltip up
   decorate();var p=body.querySelector('.cx-pane');if(p&&p.getBoundingClientRect().top>innerHeight-160)p.scrollIntoView({block:'nearest',behavior:'smooth'});},true);
  // phones: swipe the month left/right to change months
  var sx=0,sy=0;body.addEventListener('touchstart',function(e){var p=e.touches[0];sx=p.clientX;sy=p.clientY;},{passive:true});
  body.addEventListener('touchend',function(e){var p=e.changedTouches[0],dx=p.clientX-sx,dy=p.clientY-sy;if(!e.target.closest('.cal-grid')||Math.abs(dx)<60||Math.abs(dx)<Math.abs(dy)*1.5)return;
   var b=d.getElementById(dx<0?'calNext':'calPrev');if(b)b.click();},{passive:true});
  if(PHONE){var rr=function(){decorate();};if(PHONE.addEventListener)PHONE.addEventListener('change',rr);}
  if(T().on)T().on(function(){setTimeout(decorate,0);});
  decorate();}
 if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',function(){setTimeout(start,0);});else setTimeout(start,0);
})();
