/* TaskM Chrome button.
   Click it once on a school page (a class OneNote, Aeries grades, Teams, a Gmail or Outlook inbox) and TaskM finds the
   homework and grades on it. After that the page stays updated on its own: whenever the student opens it again, and
   once a day in the background (a hidden tab, using the school sign-in the student already has).
   The extension never sees or stores a password. To send updates without a TaskM tab it keeps a limited "button key"
   from TaskM that can only add pages for that student and expires after 90 days. */
const TASKM = 'https://taskm-school.web.app/';
const CLIP_IN = 'https://us-central1-taskm-sync-d6861.cloudfunctions.net/clipIn';
const MAX_TEXT = 150000;
const REFRESH_HOURS = 20;          // background refresh reads a saved page when it's older than this
const VISIT_GAP_MIN = 30;          // a page opened again sooner than this isn't re-read

chrome.action.onClicked.addListener(sendTab);
chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(() => { schedule(); setTimeout(refreshAll, 60000); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'refresh') refreshAll(); });
chrome.tabs.onUpdated.addListener(onTabUpdated);

function schedule() { chrome.alarms.create('refresh', { periodInMinutes: 360, delayInMinutes: 5 }); }

// ---- the click: read this page and show the result in TaskM
async function sendTab(tab) {
  if (!tab.id) return;
  if (!/^https?:/.test(tab.url || '')) return badge(tab.id, '!', 'Open a school page first, then click the TaskM button.');
  if (tab.url.startsWith(TASKM)) return badge(tab.id, '!', 'This is TaskM. Open a school page, like your class OneNote, and click the button there.');
  if (isTeams(tab.url)) return sendTeams(tab);
  badge(tab.id, '…', 'Reading this page…', 0);
  const text = await readTab(tab.id);
  if (text === null) return badge(tab.id, '!', 'TaskM can’t read this page. Copy the text and paste it into TaskM instead.');
  if (text.length < 40) return badge(tab.id, '!', 'TaskM didn’t find any text on this page. Wait for it to finish loading and try again.');
  const clip = { type: 'taskm-clip', v: 2, url: tab.url, title: tab.title || '', text };
  await remember(clip);
  try {
    const ok = await deliver(await openTaskM(tab), clip);
    badge(tab.id, ok ? '✓' : '!', ok ? 'Sent to TaskM. It will keep this page updated.' : 'TaskM didn’t open in time. Click the button again.');
  } catch (e) {
    badge(tab.id, '!', 'Couldn’t open TaskM. Click the button again.');
  }
}

// ---- "Link Gmail" / "Link school Outlook" in TaskM's Email view: read the inbox without leaving TaskM
const MAIL_HOSTS = /^(mail\.google\.com|outlook\.(office|office365|live)\.com)$/i;
chrome.runtime.onMessage.addListener((m, sender) => {
  if (!m || m.type !== 'read' || !sender.tab || !(sender.tab.url || '').startsWith(TASKM)) return;
  let host;
  try { const u = new URL(m.url); host = u.protocol === 'https:' && u.hostname; } catch (e) { return; }
  if (!host || !MAIL_HOSTS.test(host)) return;
  readMail(sender.tab.id, m.url, m.title);
});
async function readMail(tabId, url, title) {
  const tell = (res) => chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', args: [res],
    func: (r) => window.postMessage(r, location.origin) }).catch(() => {});
  let r;
  try { r = await readInWindow(url); } catch (e) { r = {}; }
  if (r.signin || !r.text || r.text.length < 40) {
    return tell({ type: 'taskm-read-result', ok: false, reason: r.signin ? 'signin' : 'empty', url });
  }
  const clip = { type: 'taskm-clip', v: 2, url, title: r.title || title || '', text: r.text };
  await remember(clip);
  const ok = await post(tabId, clip, 50).catch(() => false);
  tell({ type: 'taskm-read-result', ok, url });
}

// ---- Teams: a click anywhere in Teams opens the Assignments app (every class) and reads that instead
const ASSIGNMENTS_APP = '66aeee93-507d-479a-a3ef-8f494af43945';
const ASSIGN_FRAME = /(^|\.)assignments\.onenote\.com$/i;
function isTeams(u) { try { return /^teams\.(microsoft\.com|cloud\.microsoft)$/i.test(new URL(u).hostname); } catch (e) { return false; } }
function assignmentsUrl(u) { return new URL(u).origin + '/l/app/' + ASSIGNMENTS_APP; }
async function sendTeams(tab) {
  badge(tab.id, '…', 'Finding your Teams assignments…', 0);
  const url = assignmentsUrl(tab.url);
  let r;
  try { r = await readInWindow(url); } catch (e) { r = {}; }
  if (r.signin) return badge(tab.id, '!', 'Sign in to Teams again, then click the TaskM button.');
  if (!r.text || r.text.length < 40) {
    // the Assignments app didn't open: send whatever this Teams page shows
    const text = await readTab(tab.id);
    if (!text || text.length < 40) return badge(tab.id, '!', 'TaskM couldn’t open your Teams assignments. Open Assignments in Teams and click the button there.');
    r = { text, title: tab.title, own: true };
  }
  const clip = { type: 'taskm-clip', v: 2, url: r.own ? tab.url : url, title: r.own ? tab.title || '' : 'Teams assignments', text: r.text };
  await remember(clip);
  try {
    const ok = await deliver(await openTaskM(tab), clip);
    badge(tab.id, ok ? '✓' : '!', ok ? 'Sent your Teams assignments to TaskM. It will keep them updated.' : 'TaskM didn’t open in time. Click the button again.');
  } catch (e) { badge(tab.id, '!', 'Couldn’t open TaskM. Click the button again.'); }
}
// Teams loads Assignments in a frame after a while; keep checking for it (and get past Teams' "open in the app?" page)
async function readTeamsAssignments(tabId) {
  let clicked = false;
  for (let i = 0; i < 20; i++) {
    await wait(2500);
    let frames;
    try { frames = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: readFrame }); } catch (e) { continue; }
    const hits = frames.filter((f) => { try { return ASSIGN_FRAME.test(new URL(f.result.url).hostname) && f.result.text.trim().length > 80; } catch (e) { return false; } });
    if (hits.length) {
      await wait(3000);   // let the list finish filling in
      frames = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: readFrame }).catch(() => frames);
      return joinFrames(frames.filter((f) => { try { return ASSIGN_FRAME.test(new URL(f.result.url).hostname); } catch (e) { return false; } }));
    }
    if (i === 8 && !clicked) {
      clicked = true;   // the link didn't open the app: click Assignments in Teams' app bar
      await chrome.scripting.executeScript({ target: { tabId }, func: () => {
        const b = [...document.querySelectorAll('button,a,[role="button"],[role="menuitem"]')].find((e) => /^assignments\b/i.test((e.getAttribute('aria-label') || e.title || e.textContent || '').trim()));
        if (b) b.click();
      } }).catch(() => {});
    } else {
      await chrome.scripting.executeScript({ target: { tabId }, func: () => {
        const b = [...document.querySelectorAll('a,button')].find((e) => /use the web app instead|continue on this browser|use the web app/i.test(e.textContent || ''));
        if (b) b.click();
      } }).catch(() => {});
    }
  }
  return null;
}

// ---- saved pages: { [pageKey]: { url, title, hash, at } } in chrome.storage.local
function pageKey(u) { try { const x = new URL(u); return x.origin + x.pathname + x.search; } catch (e) { return null; } }
async function getPages() { return (await chrome.storage.local.get('pages')).pages || {}; }
async function setPages(p) { await chrome.storage.local.set({ pages: p }); }
async function remember(clip) {
  const pages = await getPages(), k = pageKey(clip.url);
  if (!k) return;
  pages[k] = { url: clip.url, title: clip.title, hash: await sha(clip.text), at: Date.now() };
  await setPages(pages);
}

// Opening a saved page again re-reads it quietly
async function onTabUpdated(tabId, info, tab) {
  if (info.status !== 'complete' || !tab.url) return;
  if (tab.url.startsWith(TASKM)) return syncWithTaskM(tabId);
  if (refreshing.has(tabId)) return;
  const pages = await getPages(), k = pageKey(tab.url), p = k && pages[k];
  if (!p || Date.now() - p.at < VISIT_GAP_MIN * 60000) return;
  if (MAIL_HOSTS.test(new URL(tab.url).hostname) && tab.url !== p.url) return;
  if (p.url.includes('/l/app/' + ASSIGNMENTS_APP)) return;   // Teams assignments refresh in the background
  setTimeout(async () => {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t || pageKey(t.url) !== k) return;
    const text = await readTab(tabId);
    if (text && text.length >= 40) await quietUpdate(k, { url: p.url, title: t.title || p.title, text });
  }, 6000);
}

// Once a day: open each saved page in a hidden tab, read it, close it
const refreshing = new Set();
let refreshRunning = false;
async function refreshAll() {
  if (refreshRunning) return;
  refreshRunning = true;
  try {
    const pages = await getPages();
    for (const [k, p] of Object.entries(pages)) {
      if (Date.now() - p.at < REFRESH_HOURS * 3600000) continue;
      await refreshOne(k, p).catch(() => {});
    }
  } finally { refreshRunning = false; }
}
async function refreshOne(k, p) {
  const r = await readInWindow(p.url);
  if (r.signin) return quietUpdate(k, { url: p.url, title: p.title, signin: true });
  if (r.text && r.text.length >= 40) await quietUpdate(k, { url: p.url, title: r.title || p.title, text: r.text });
}
// Open a page out of the way, read it, close it: { text, title, signin }.
// A background tab tucked into a collapsed "TaskM" group, not a new window: on a Mac a new window
// pulls a full-screen Chrome out of its space and the screen goes black.
async function openReader(url) {
  const wins = await chrome.windows.getAll({ windowTypes: ['normal'] });
  const w = wins.find((x) => x.focused) || wins[0];
  if (w) {
    const t = await chrome.tabs.create({ windowId: w.id, url, active: false });
    try {
      const g = await chrome.tabs.group({ tabIds: [t.id], createProperties: { windowId: w.id } });
      await chrome.tabGroups.update(g, { title: 'TaskM', color: 'blue', collapsed: true });
    } catch (e) { /* groups are only for looks */ }
    return { tabId: t.id, close: () => chrome.tabs.remove(t.id).catch(() => {}) };
  }
  const nw = await chrome.windows.create({ url, state: 'minimized', focused: false });   // Chrome open with no windows
  return { tabId: nw.tabs[0].id, close: () => chrome.windows.remove(nw.id).catch(() => {}) };
}
async function readInWindow(url) {
  const reader = await openReader(url);
  const tabId = reader.tabId;
  refreshing.add(tabId);
  try {
    await loaded(tabId);
    await wait(6000);
    let t = await chrome.tabs.get(tabId);
    if (needsSignIn(url, t.url)) return { signin: true };
    if (url.includes('/l/app/' + ASSIGNMENTS_APP)) {
      const text = await readTeamsAssignments(tabId);
      t = await chrome.tabs.get(tabId).catch(() => t);
      if (!text && needsSignIn(url, t.url)) return { signin: true };
      return { text, title: 'Teams assignments' };
    }
    let text = await readTab(tabId);
    if (!text || text.length < 200) { await wait(6000); text = await readTab(tabId); t = await chrome.tabs.get(tabId); }
    if (needsSignIn(url, t.url)) return { signin: true };
    return { text, title: t.title || '' };
  } finally {
    refreshing.delete(tabId);
    reader.close();
  }
}
// The school sent the student to a sign-in page instead of the saved one
function needsSignIn(saved, now) {
  try {
    const a = new URL(saved), b = new URL(now);
    return a.hostname !== b.hostname && /login|signin|sso|adfs|auth|accounts\.google|workspace\.google/i.test(b.hostname + b.pathname);
  } catch (e) { return false; }
}

// Send a changed page (or a sign-in notice) straight to TaskM's server, or hold it until a TaskM tab opens
async function quietUpdate(k, clip) {
  const pages = await getPages();
  if (!pages[k]) return;
  let same = false;
  if (!clip.signin) {
    const h = await sha(clip.text);
    pages[k].at = Date.now();
    same = h === pages[k].hash;
    pages[k].hash = h;
  }
  await setPages(pages);
  const msg = { type: 'taskm-clip', v: 2, quiet: true, url: clip.url, title: clip.title, text: clip.text || '', signin: !!clip.signin };
  const { buttonKey } = await chrome.storage.local.get('buttonKey');
  // An unchanged page is still sent when TaskM can take it directly: it costs no AI read, and TaskM then shows
  // the page as checked today. Without a key there's nothing new worth holding.
  if (same && !buttonKey) return;
  if (buttonKey) {
    try {
      const r = await fetch(CLIP_IN, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: buttonKey, clip: { url: msg.url, title: msg.title }, text: msg.text, signin: msg.signin }) });
      if (r.ok) return;
      if (r.status === 401) await chrome.storage.local.remove('buttonKey');
      if (r.status === 400 || r.status === 429) return;   // TaskM looked at it and said no; holding it won't help
    } catch (e) { /* offline: hold it */ }
    if (same) return;
  }
  const { pending = {} } = await chrome.storage.local.get('pending');
  pending[k] = msg;
  await chrome.storage.local.set({ pending });
  const [t] = await chrome.tabs.query({ url: TASKM + '*' });
  if (t) syncWithTaskM(t.id);
}

// When a TaskM tab is open: hand over held updates, refresh the button key, and forget pages removed in TaskM
async function syncWithTaskM(tabId) {
  const { pending = {}, buttonKey, keyAt = 0 } = await chrome.storage.local.get(['pending', 'buttonKey', 'keyAt']);
  const wantKey = !buttonKey || Date.now() - keyAt > 30 * 864e5;
  let r;
  try {
    [r] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', args: [Object.values(pending), wantKey],
      func: (held, wantKey) => new Promise((resolve) => {
        if (window.TaskMButtonSeen) window.TaskMButtonSeen();   // ticks "Add the TaskM Chrome button" in TaskM's setup list
        let tries = 0;
        const go = () => {
          const pages = window.TaskMClipPages ? window.TaskMClipPages() : null;
          if (document.documentElement.getAttribute('data-taskm-clip') === '1' && pages) {
            held.forEach((c) => window.postMessage(c, location.origin));
            const key = wantKey && window.TaskMButtonKey ? window.TaskMButtonKey() : Promise.resolve(null);
            key.then((k) => resolve({ pages, key: k }));
          } else if (++tries > 75) resolve(null);   // not signed in yet
          else setTimeout(go, 200);
        };
        go();
      }),
    });
  } catch (e) { return; }
  const out = r && r.result;
  if (!out) return;
  const save = { pending: {} };
  if (out.key) { save.buttonKey = out.key; save.keyAt = Date.now(); }
  const keep = new Set(out.pages.map(pageKey));
  const pages = await getPages();
  for (const k of Object.keys(pages)) if (!keep.has(k) && !pending[k] && Date.now() - pages[k].at > 120000) delete pages[k];
  // pages saved in TaskM that this button doesn't know yet (after a reinstall, or another computer) start updating too
  for (const u of out.pages) {
    const k = pageKey(u);
    if (k && !pages[k] && /^https:/.test(u)) pages[k] = { url: u, title: '', hash: '', at: 0 };
  }
  save.pages = pages;
  await chrome.storage.local.set(save);
}

// ---- reading a tab: every frame's text (OneNote shows the page inside a frame, with menus in the outer page)
async function readTab(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab && /^https:\/\/mail\.google\.com\//.test(tab.url || '')) {
    const mail = await readGmail(tabId);
    if (mail && mail.length >= 200) return mail;
  }
  try {
    const frames = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: readFrame });
    return joinFrames(frames);
  } catch (e) { return null; }
}
// Gmail shows only a preview of each email in the list, so open each one's print view (same sign-in) and read it all
async function readGmail(tabId) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: gmailThreads, args: [25, 3500] });
    return r && r.result ? String(r.result).slice(0, MAX_TEXT) : null;
  } catch (e) { return null; }
}
async function gmailThreads(max, per) {
  const ik = window.GLOBALS && window.GLOBALS[9];
  const all = [...document.querySelectorAll('[data-legacy-thread-id]')];
  const shown = all.filter((e) => e.offsetParent !== null);
  const ids = [...new Set((shown.length ? shown : all).map((e) => e.getAttribute('data-legacy-thread-id')))].filter((x) => /^[0-9a-f]+$/i.test(x)).slice(0, max);
  if (!ik || !ids.length) return null;
  const base = location.pathname.replace(/\/+$/, '') + '/';
  const parts = [];
  for (const id of ids) {
    try {
      const res = await fetch(base + '?ik=' + encodeURIComponent(ik) + '&view=pt&search=all&th=' + id, { credentials: 'include' });
      if (!res.ok) continue;
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      doc.querySelectorAll('script,style').forEach((e) => e.remove());
      doc.querySelectorAll('td,th').forEach((e) => e.append(' '));
      doc.querySelectorAll('br,p,div,tr,li,h1,h2,h3,table').forEach((e) => e.append('\n'));
      const t = (doc.body ? doc.body.textContent : '').replace(/[ \t\u00a0]+/g, ' ').replace(/\n\s*\n\s*/g, '\n').trim();
      if (t.length > 40) parts.push('=== Email ===\n' + t.slice(0, per));
    } catch (e) { /* skip this one */ }
  }
  return parts.length ? parts.join('\n\n') : null;
}
function readFrame() {
  const b = document.body;
  return { text: b ? b.innerText : '', url: location.href };
}
function joinFrames(frames) {
  const seen = new Set();
  const parts = [];
  for (const f of frames || []) {
    const t = String((f && f.result && f.result.text) || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (t.length < 20 || seen.has(t)) continue;
    seen.add(t);
    parts.push(t);
  }
  parts.sort((a, b) => b.length - a.length);
  return parts.join('\n\n---\n\n').slice(0, MAX_TEXT);
}

// ---- the TaskM tab
async function openTaskM(from) {
  const [open] = await chrome.tabs.query({ url: TASKM + '*' });
  let t = open;
  if (t) {
    t = await chrome.tabs.update(t.id, { active: true });
    await chrome.windows.update(t.windowId, { focused: true });
  } else {
    t = await chrome.tabs.create({ url: TASKM, index: from.index + 1, windowId: from.windowId });
  }
  if (t.status !== 'complete') await loaded(t.id);
  return t.id;
}

function loaded(tabId) {
  return new Promise((resolve) => {
    const done = () => { chrome.tabs.onUpdated.removeListener(on); clearTimeout(timer); resolve(); };
    const on = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    const timer = setTimeout(done, 20000);
    chrome.tabs.onUpdated.addListener(on);
  });
}

// Hand the page to TaskM once it says it's ready to take one. A TaskM tab opened before an update
// doesn't know how to take pages yet, so it's reloaded once if it doesn't answer.
async function deliver(tabId, clip) {
  if (await post(tabId, clip, 15)) return true;
  await chrome.tabs.reload(tabId);
  await wait(500);
  if ((await chrome.tabs.get(tabId)).status !== 'complete') await loaded(tabId);
  return post(tabId, clip, 100);
}

async function post(tabId, clip, maxTries) {
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [clip, maxTries],
    func: (c, max) => new Promise((resolve) => {
      let tries = 0;
      const go = () => {
        if (document.documentElement.getAttribute('data-taskm-clip') === '1') { window.postMessage(c, location.origin); resolve(true); }
        else if (++tries > max) resolve(false);
        else setTimeout(go, 200);
      };
      go();
    }),
  });
  return !!(r && r.result);
}

async function sha(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return [...new Uint8Array(d)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function badge(tabId, text, title, clearAfter = 6000) {
  chrome.action.setBadgeBackgroundColor({ tabId, color: text === '!' ? '#c2410c' : '#2563eb' });
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setTitle({ tabId, title });
  if (clearAfter) setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    chrome.action.setTitle({ tabId, title: 'Send this page to TaskM' }).catch(() => {});
  }, clearAfter);
}
