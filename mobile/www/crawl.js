/* TaskM's page reader: runs inside a school page the student is already signed in to (the TaskM Chrome button's
   reader tab, or the iPhone app's hidden reader) and moves around that one site to find homework, grades and news:
   - OneNote: opens the current notebook section, the next one and the one before, plus pages titled like a schedule.
   - Teams: reads the activity feed and recent chats, then each class team's General channel and its busiest channels.
   - Aeries and other school sites: fetches the same site's grade, assignment and calendar pages.
   It only clicks and reads. It never types, submits a form or leaves the site.
   Call TaskMCrawl.step() until it returns {done: true}; each call works for under a minute so neither the Chrome
   button nor the phone gives up waiting. The last call's text holds everything found, as parts marked with === lines.
   The same file is served at taskm-school.web.app/crawl.js for the iPhone app. */
(function () {
  if (window.TaskMCrawl) return;
  var STEP_MS = 45000, PART_MAX = 12000, TEXT_MAX = 150000;
  var NOT_SITES = /(^|\.)(google\.com|gmail\.com|outlook\.(com|office|office365|live)\.com|cloud\.microsoft|sharepoint\.com|office\.com|live\.com|microsoftonline\.com)$/i;

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function clean(t) { return String(t || '').replace(/[ \t ]+/g, ' ').replace(/\n\s*\n\s*/g, '\n').trim(); }
  function label(e) { return String(e.getAttribute('aria-label') || e.innerText || e.textContent || '').trim(); }
  function all(sel, root) { return [].slice.call((root || document).querySelectorAll(sel)); }
  function part(s, head, text) { text = clean(text); if (text.length >= 40) s.parts.push('=== ' + head + ' ===\n' + text.slice(-PART_MAX)); }

  function kind() {
    var h = location.hostname, top = window.top === window;
    if (/onenote\.officeapps\.live\.com$/i.test(h)) return 'onenote';
    if (!top) return null;
    if (/^teams\.(microsoft\.com|cloud\.microsoft)$/i.test(h)) return 'teams';
    if (/(^|\.)aeries\.(net|com)$/i.test(h)) return 'aeries';
    if (location.protocol === 'https:' && !NOT_SITES.test(h)) return 'site';
    return null;
  }

  // ---- OneNote: the notebook lives in this frame. Sections are tree items ("Ch 5, Section. ..."), pages are buttons
  // ("4.4 Optimization, page 7 of 13, Page. ..."). A teacher's homework table is usually a section's first page.
  function sections() { return all('[role=treeitem]').filter(function (e) { return /, Section\b/.test(e.getAttribute('aria-label') || ''); }); }
  function secName(e) { return (e.getAttribute('aria-label') || '').split(', Section')[0].trim(); }
  async function onenote(s) {
    if (!s.todo) {
      var l = sections();
      if (!l.length) return true;
      var cur = l.findIndex(function (e) { return /, Section\. Selected/.test(e.getAttribute('aria-label') || ''); });
      if (cur < 0) cur = 0;
      s.home = secName(l[cur]);
      s.todo = [cur, cur + 1, cur - 1].filter(function (i) { return i >= 0 && i < l.length; }).map(function (i) { return secName(l[i]); });
    }
    while (s.i < s.todo.length && Date.now() < s.until) {
      var nm = s.todo[s.i++], el = sections().find(function (e) { return secName(e) === nm; });
      if (!el) continue;
      el.click();
      await wait(4500);
      part(s, 'OneNote section ' + nm + ', first page', document.body.innerText);
      var pages = all('[aria-label*=", Page."]').filter(function (b) {
        var t = (b.getAttribute('aria-label') || '').split(/, page \d+ of/)[0];
        return /homework|assignment|schedule|calendar|agenda|due|week|syllabus|test|quiz/i.test(t) && !/, Page\. Selected/.test(b.getAttribute('aria-label') || '');
      }).slice(0, 2);
      for (var j = 0; j < pages.length; j++) {
        var title = (pages[j].getAttribute('aria-label') || '').split(/, page \d+ of/)[0];
        pages[j].click();
        await wait(3500);
        part(s, 'OneNote page ' + title + ' (section ' + nm + ')', document.body.innerText);
      }
    }
    if (s.i < s.todo.length) return false;
    var home = sections().find(function (e) { return secName(e) === s.home; });   // leave the notebook where it was
    if (home) home.click();
    return true;
  }

  // ---- Teams: activity, chats, then every team's channels
  function navBtn(re) { return all('button,[role=tab]').find(function (e) { return re.test(label(e)); }); }
  function teamCards() { return all('[data-tid$="-team-card"]'); }
  function mainText() { return (document.querySelector('[role=main]') || document.body).innerText; }
  function posts() { var t = mainText(), i = t.lastIndexOf('\nPosts\n'); return i >= 0 ? t.slice(i + 7) : t; }
  async function teamGrid() {
    if (teamCards().length) return true;
    var b = navBtn(/^Teams\b/);
    if (b) b.click();
    for (var i = 0; i < 8 && !teamCards().length; i++) {
      await wait(1000);
      var a = all('button,a,[role=button]').find(function (e) { return /^all teams$/i.test(label(e)); });
      if (a) a.click();
    }
    return teamCards().length > 0;
  }
  function chanScore(e) {
    var t = (e.innerText || '').trim(), sc = 0;
    if (/homework|assign|agenda|announce|classwork|due|event|calendar|test|quiz|schedule|important/i.test(t)) sc += 2;
    all('span', e).forEach(function (x) { if (+getComputedStyle(x).fontWeight >= 600) sc = Math.max(sc, sc + 5); });   // bold = unread
    return sc;
  }
  async function teams(s) {
    if (!s.todo) {
      var act = navBtn(/^Activity\b/);
      if (act) { act.click(); await wait(4000); part(s, 'Teams activity feed', mainText()); }
      var chat = navBtn(/^Chat\b/);
      if (chat) { chat.click(); await wait(4000); part(s, 'Teams chats, newest first', mainText().slice(0, 6000)); }
      // no team list (Teams reopened the last team): read the open team's channels only
      s.todo = (await teamGrid()) ? teamCards().map(function (c) { return c.getAttribute('data-tid'); }).slice(0, 25) : ['open'];
    }
    while (s.i < s.todo.length && Date.now() < s.until) {
      var id = s.todo[s.i++], team = (document.title.split('|')[1] || 'Open team').trim();
      if (id !== 'open') {
        if (!(await teamGrid())) break;
        var card = teamCards().find(function (c) { return c.getAttribute('data-tid') === id; });
        if (!card) continue;
        team = label(card).replace(/\s*Team \d+ of \d+$/i, '');
        card.click();
        await wait(5000);
      }
      part(s, 'Teams: ' + team + ' > General', posts().slice(-4000));
      var chans = all('[role=treeitem][aria-level="2"]').filter(function (e) { return !/^general$/i.test((e.innerText || '').trim()); })
        .map(function (e, i) { return { e: e, sc: chanScore(e), i: i }; }).sort(function (a, b) { return b.sc - a.sc || b.i - a.i; }).slice(0, 3);
      for (var j = 0; j < chans.length; j++) {
        var n = (chans[j].e.innerText || '').trim();
        chans[j].e.click();
        await wait(3500);
        part(s, 'Teams: ' + team + ' > ' + n, posts().slice(-4000));
      }
    }
    return s.i >= s.todo.length;
  }

  // ---- Aeries and other school sites: fetch the same site's useful pages (signed-in cookies come along)
  var AERIES_RE = /gradebook|missing|assignment|grades|classsummary|progress|attendance/i;
  var SITE_RE = /homework|assignment|calendar|schedule|agenda|syllabus|due|events?\b|announce|news|bulletin|counsel|deadline|grades?\b|missing/i;
  function docText(doc) {
    doc.querySelectorAll('script,style,noscript,nav,header,footer').forEach(function (e) { e.remove(); });
    doc.querySelectorAll('td,th').forEach(function (e) { e.append(' '); });
    doc.querySelectorAll('br,p,div,tr,li,h1,h2,h3,h4,table').forEach(function (e) { e.append('\n'); });
    return doc.body ? doc.body.textContent : '';
  }
  function links(root, base, re, seen) {
    var out = [];
    all('a[href]', root).forEach(function (a) {
      var u;
      try { u = new URL(a.getAttribute('href'), base); } catch (e) { return; }
      var k = u.pathname + u.search;
      if (u.origin !== location.origin || seen[k] || /logout|log-out|signout|sign-out|print|delete|remove|\.(pdf|docx?|xlsx?|pptx?|zip|jpg|png)$/i.test(u.pathname)) return;
      if (!re.test(u.pathname + ' ' + (a.textContent || ''))) return;
      seen[k] = 1;
      out.push(u.href);
    });
    return out;
  }
  async function fetchPages(s, re, max) {
    if (!s.todo) {
      s.seen = {};
      s.seen[location.pathname + location.search] = 1;
      s.todo = links(document, location.href, re, s.seen).slice(0, max);
      s.max = max;
    }
    while (s.i < s.todo.length && Date.now() < s.until) {
      var u = s.todo[s.i++];
      try {
        var r = await fetch(u, { credentials: 'include' });
        if (!r.ok || !/html/i.test(r.headers.get('content-type') || '')) continue;
        var doc = new DOMParser().parseFromString(await r.text(), 'text/html');
        var title = clean(doc.title) || new URL(u).pathname;
        // one level deeper (a class list links to each class's details), within the same page budget
        if (s.todo.length < s.max) s.todo = s.todo.concat(links(doc, u, re, s.seen)).slice(0, s.max);
        part(s, title, docText(doc));
      } catch (e) { /* skip that page */ }
    }
    return s.i >= s.todo.length;
  }

  async function step() {
    var s = window.__taskmCrawl || (window.__taskmCrawl = { parts: [], todo: null, i: 0, k: kind() });
    if (s.finished || !s.k) return { done: true };
    s.until = Date.now() + STEP_MS;
    var done = true;
    try {
      done = s.k === 'onenote' ? await onenote(s) : s.k === 'teams' ? await teams(s) : s.k === 'aeries' ? await fetchPages(s, AERIES_RE, 20) : await fetchPages(s, SITE_RE, 6);
    } catch (e) { done = true; }
    if (!done) return { done: false };
    s.finished = true;
    return { done: true, kind: s.k, text: s.parts.join('\n\n').slice(0, TEXT_MAX) };
  }
  window.TaskMCrawl = { step: step, kind: kind };
})();
