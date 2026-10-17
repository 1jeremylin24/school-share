/* TaskM Chrome button.
   One click reads the page the student has open (OneNote's inner page included) and hands the text to their
   TaskM tab, which finds the homework with their TaskM account. It works on pages that need a school sign-in
   because the student is already signed in; the extension never sees or stores a password, and keeps nothing. */
const TASKM = 'https://taskm-school.web.app/';
const MAX_TEXT = 150000;

chrome.action.onClicked.addListener(sendTab);

async function sendTab(tab) {
  if (!tab.id) return;
  if (!/^https?:/.test(tab.url || '')) return badge(tab.id, '!', 'Open a school page first, then click the TaskM button.');
  if (tab.url.startsWith(TASKM)) return badge(tab.id, '!', 'This is TaskM. Open a school page, like your class OneNote, and click the button there.');
  badge(tab.id, '…', 'Reading this page…', 0);
  let frames;
  try {
    frames = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: readFrame });
  } catch (e) {
    return badge(tab.id, '!', 'TaskM can’t read this page. Copy the text and paste it into TaskM instead.');
  }
  const text = joinFrames(frames);
  if (text.length < 40) return badge(tab.id, '!', 'TaskM didn’t find any text on this page. Wait for it to finish loading and try again.');
  const clip = { type: 'taskm-clip', v: 1, url: tab.url, title: tab.title || '', text };
  try {
    const ok = await deliver(await openTaskM(tab), clip);
    badge(tab.id, ok ? '✓' : '!', ok ? 'Sent to TaskM' : 'TaskM didn’t open in time. Click the button again.');
  } catch (e) {
    badge(tab.id, '!', 'Couldn’t open TaskM. Click the button again.');
  }
}

// Runs inside each frame of the page
function readFrame() {
  const b = document.body;
  return { text: b ? b.innerText : '', url: location.href };
}

// OneNote shows the page inside a frame, with menus in the outer page; keep every frame's text, longest first, without repeats
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

// Use the open TaskM tab if there is one, otherwise open TaskM next to the page
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

// Hand the page to TaskM once it says it's ready to take one
async function deliver(tabId, clip) {
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [clip],
    func: (c) => new Promise((resolve) => {
      let tries = 0;
      const go = () => {
        if (document.documentElement.getAttribute('data-taskm-clip') === '1') { window.postMessage(c, location.origin); resolve(true); }
        else if (++tries > 100) resolve(false);
        else setTimeout(go, 200);
      };
      go();
    }),
  });
  return !!(r && r.result);
}

function badge(tabId, text, title, clearAfter = 6000) {
  chrome.action.setBadgeBackgroundColor({ tabId, color: text === '!' ? '#c2410c' : '#2563eb' });
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setTitle({ tabId, title });
  if (clearAfter) setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    chrome.action.setTitle({ tabId, title: 'Send this page to TaskM' }).catch(() => {});
  }, clearAfter);
}
