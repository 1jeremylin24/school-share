// Pure helpers for the TaskM AI importer (no Firebase, no network), so they can be tested with `npm test`.
const crypto = require('crypto');

const TZ = 'America/Los_Angeles';
const DAY = 864e5;

// YYYY-MM-DD for a moment, in Pacific time
function ymdIn(date, tz = TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function weekdayIn(date, tz = TZ) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(date);
}
// Pacific UTC offset ("-07:00" or "-08:00") on a calendar day
function offsetOn(ymd, tz = TZ) {
  const d = new Date(ymd + 'T12:00:00Z');
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(d).find(p => p.type === 'timeZoneName');
  const m = /GMT([+-]\d{2}:\d{2})/.exec(part ? part.value : '');
  return m ? m[1] : '-08:00';
}
function addDays(ymd, n) {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / DAY);
}
// Homework with only an assigned date is due the next school day (weekends skipped; holidays aren't known here)
function nextSchoolDay(ymd) {
  let d = addDays(ymd, 1);
  while ([0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay())) d = addDays(d, 1);
  return d;
}
const isYmd = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T12:00:00Z'));
const isHm = s => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

function hash(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

const TYPES = ['assignment', 'test', 'quiz', 'project', 'form', 'event', 'other'];
const IMPORTANCE = { test: 'High', project: 'High', quiz: 'Medium', form: 'Medium', event: 'Low', assignment: 'Low', other: 'Low' };

// One AI task -> one TaskM list item (same shape as orgData items). Returns null when it has no usable date.
function toItem(t, { source, link, today }) {
  if (!t || !t.title) return null;
  const type = TYPES.includes(t.type) ? t.type : 'assignment';
  let due = isYmd(t.due_date) ? t.due_date : null;
  if (!due && isYmd(t.assigned_date) && (type === 'assignment' || type === 'other')) due = nextSchoolDay(t.assigned_date);
  if (!due) return null;
  const days = daysBetween(today, due);
  if (days < -21 || days > 200) return null;
  const hasTime = isHm(t.due_time);
  const off = offsetOn(due);
  const cls = (t.class_name || '').trim();
  const title = String(t.title).trim().slice(0, 160);
  const imp = IMPORTANCE[type];
  return {
    id: 'ai-' + hash([title.toLowerCase(), cls.toLowerCase(), due].join('|')).slice(0, 16),
    title,
    type,
    category: cls || 'School',
    class_short: cls ? cls.split(/\s+/).slice(0, 2).join(' ') : 'School',
    due: hasTime ? `${due}T${t.due_time}:00${off}` : due,
    due_sort: `${due}T${hasTime ? t.due_time : '23:59'}:00${off}`,
    due_has_time: hasTime,
    description: String(t.details || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    notes: '',
    source,
    link: (typeof t.link === 'string' && /^https?:\/\//.test(t.link) ? t.link : link) || null,
    status: 'open',
    importance: imp,
    importance_base: imp,
    importance_source: 'rules',
    days_remaining: days,
    overdue: days < 0,
    past: days < 0,
  };
}

// Readable text from a web page
function htmlToText(html) {
  return String(html)
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

// Calendar feeds (.ics) don't need AI: each event already has a date
function icsToTasks(ics, today) {
  const text = String(ics).replace(/\r?\n[ \t]/g, '');
  const out = [];
  for (const block of text.split('BEGIN:VEVENT').slice(1)) {
    const get = k => { const m = new RegExp('^' + k + '(?:;[^:\\n]*)?:(.*)$', 'm').exec(block); return m ? m[1].trim() : ''; };
    const start = get('DTSTART');
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/.exec(start);
    if (!m) continue;
    const day = `${m[1]}-${m[2]}-${m[3]}`;
    const d = daysBetween(today, day);
    if (d < -7 || d > 120) continue;
    const title = get('SUMMARY').replace(/\\([,;\\])/g, '$1').replace(/\\n/gi, ' ');
    if (!title) continue;
    const kind = /\b(test|exam|midterm|final)\b/i.test(title) ? 'test' : /\bquiz\b/i.test(title) ? 'quiz' : /\b(due|homework|assignment|project)\b/i.test(title) ? 'assignment' : 'event';
    // Times in UTC (ending in Z) are kept as all-day here; school calendars are almost always all-day
    out.push({ title, type: kind, class_name: null, due_date: day, due_time: null, assigned_date: null, details: get('DESCRIPTION').replace(/\\n/gi, ' ').slice(0, 300) || null, link: get('URL') || null });
  }
  return out;
}

// Only public http(s) addresses; no local or cloud-internal hosts
function safeUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim().replace(/^webcal:/i, 'https:')); } catch (e) { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h.includes('.') || /(^|\.)(localhost|internal|local)$/.test(h) || h === 'metadata.google.internal') return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':')) return null; // bare IPs not allowed
  return u.toString();
}

// Merge every source's items into one list, newest copy of each id wins, old items dropped
function combine(lists, today) {
  const by = {};
  for (const list of lists) for (const i of list || []) {
    if (!i || !i.id) continue;
    const day = String(i.due || '').slice(0, 10);
    if (isYmd(day) && daysBetween(today, day) < -21) continue;
    by[i.id] = i;
  }
  return Object.values(by).sort((a, b) => String(a.due_sort).localeCompare(String(b.due_sort)));
}

// A class grade the AI found (gradebook pages like Aeries) -> the app's grade shape
// The gradebook's own letter wins over the percent, since it includes the teacher's curve
function toGrade(g, source) {
  if (!g || !g.class_name) return null;
  const m = /^\s*([A-F][+-]?)\s*$/i.exec(String(g.letter || '')), letter = m ? m[1].toUpperCase() : null;
  const has = g.percent !== null && g.percent !== undefined && g.percent !== '', pct = has ? Number(g.percent) : NaN;
  const okPct = has && isFinite(pct) && pct >= 0 && pct <= 150;
  if (!okPct && !letter) return null;
  const out = { course: String(g.class_name).trim().slice(0, 80), pct: okPct ? Math.round(pct * 10) / 10 : null, source };
  if (letter) out.letter = letter;
  return out;
}

// An email the AI summarized (Gmail/Outlook read by the Chrome button) -> a row for the Email tab
const MAIL_CATS = ['school', 'college', 'events', 'money', 'personal', 'other'];
function toEmail(m) {
  if (!m || !m.subject || !m.summary) return null;
  const ymd = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
  const from = String(m.from || '').trim().slice(0, 80), subj = String(m.subject).trim().slice(0, 200), got = ymd(m.received);
  return {
    id: 'm' + hash([from.toLowerCase(), subj.toLowerCase(), got || ''].join('|')).slice(0, 14),
    from, subj, got, sum: String(m.summary).trim().slice(0, 500),
    cat: MAIL_CATS.includes(m.category) ? m.category : 'other',
    act: !!m.needs_action, due: ymd(m.due_date),
  };
}

// Newest grade per class across every source ({at, list} per source)
function combineGrades(bySource) {
  const by = {};
  for (const s of Object.values(bySource || {})) for (const g of (s && s.list) || []) {
    const k = String(g.course).toLowerCase();
    if (!by[k] || String(s.at) >= by[k].at) by[k] = { at: String(s.at), g };
  }
  return Object.values(by).map(x => x.g).sort((a, b) => a.course.localeCompare(b.course));
}

// Read files out of a .docx / .pptx (they are zip files) without extra packages
function unzip(buf) {
  const zlib = require('zlib');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return {};
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let n = 0; n < count && buf.readUInt32LE(p) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extra + comment;
    if (!/\.xml$/.test(name) || size > 20 * 1024 * 1024) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    try { out[name] = method === 8 ? zlib.inflateRawSync(data).toString('utf8') : method === 0 ? data.toString('utf8') : ''; } catch (e) { /* skip a broken part */ }
  }
  return out;
}
function officeText(buf) {
  const files = unzip(buf);
  const xmlText = x => x.replace(/<w:tab\/>|<a:tab\/>/g, '\t').replace(/<\/w:p>|<\/a:p>|<w:br\/>/g, '\n').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  if (files['word/document.xml']) return xmlText(files['word/document.xml']).replace(/\n{3,}/g, '\n\n').trim();
  const slides = Object.keys(files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)));
  return slides.map((n, i) => `Slide ${i + 1}\n` + xmlText(files[n]).trim()).join('\n\n').trim();
}

// The id a page sent by the TaskM Chrome button is saved under (same math the app used before, so old pages keep their id)
function clipKey(u) {
  let x;
  try { x = new URL(u); } catch (e) { return null; }
  const s = x.origin + x.pathname + x.search;
  let h = 7, g = 11;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; g = (g * 131 + s.charCodeAt(i)) | 0; }
  return 'c' + (h >>> 0).toString(36) + (g >>> 0).toString(36);
}
// A short name for a page from its tab title
function clipLabel(title, url) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { /* no host */ }
  const t = String(title || '');
  if (host === 'mail.google.com') {
    const addr = t.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/);
    return addr ? 'Gmail · ' + addr[0].slice(0, 60) : 'Gmail';
  }
  if (/^outlook\./.test(host)) {
    const who = t.replace(/^(Mail|Inbox)\s*[-–—]\s*/i, '').replace(/\s*[-–—]\s*Outlook.*$/i, '').trim();
    const name = /live\.com$/.test(host) ? 'Outlook.com' : 'School Outlook';
    return (who && !/^(mail|inbox|outlook)$/i.test(who) ? name + ' · ' + who : name).slice(0, 60);
  }
  return (String(title || '').replace(/\s*[-|–—:]\s*(Microsoft\s+)?(OneNote|Teams|SharePoint|Outlook)(\s+(Online|for the web))?\s*$/i, '').trim() || host).slice(0, 60);
}

// ---- Friends beta: who signed up, who keeps coming back, and how far each person got with setup (counts only, no homework)
const OWNER_HASHES = ['5fe6295b85aa4d852546936626db9190bb8a9eb26e955930b605d9a26ec9dd91', '03e02d55ad4902955526cf9abc17820179d63d68b620e457374c96b209bf2a8c'];
function isOwner(token) {
  return !!(token && token.email && token.email_verified && OWNER_HASHES.includes(hash(String(token.email).toLowerCase())));
}
const count = o => (o && typeof o === 'object' ? Object.keys(o).length : 0);
function betaSummary(users, authUsers, feedback, now, extra) {
  const last = n => Array.from({ length: n }, (_, i) => ymdIn(new Date(now - i * DAY)));
  const d7 = last(7), d30 = last(30), today = d7[0];
  const byUid = {};
  (authUsers || []).forEach(a => { byUid[a.uid] = a; });
  const uids = [...new Set([...Object.keys(byUid), ...Object.keys(users || {})])];
  const rows = uids.map(uid => {
    const u = (users || {})[uid] || {}, a = byUid[uid] || {}, p = u.profile || {}, b = u.beta || {}, days = b.days || {};
    const tasks = Object.values(u.aiItems || {}).reduce((n, l) => n + (Array.isArray(l) ? l.length : count(l)), 0);
    const seen = Math.max(+b.seen || 0, Date.parse(a.lastSignIn || '') || 0) || null;
    return {
      name: String(p.name || a.name || '').slice(0, 80), email: a.email || '', role: p.role || (p.school ? 'student' : 'not set up'),
      school: p.school || '', grade: p.grade || '', joined: Date.parse(a.created || p.created || '') || null, seen,
      days7: d7.filter(d => days[d]).length, week: d7.map(d => !!days[d]).reverse(), days30: d30.filter(d => days[d]).length,
      button: b.ext || null, phone: !!(b.plat && b.plat.iphone), sources: count(u.sources), tasks, inboxes: count(u.aiMail), grades: count(u.aiGrades), parents: count(u.parents),
    };
  }).sort((x, y) => (y.seen || 0) - (x.seen || 0));
  const fb = Object.entries(feedback || {}).map(([id, f]) => ({ id, ...f, done: !!f.done })).sort((x, y) => (y.at || 0) - (x.at || 0));
  const ex = extra || {};
  // Sign-ups and people who opened TaskM, per day for the last 30 days (oldest first)
  const trend = d30.slice().reverse().map(d => ({
    day: d, signups: rows.filter(r => r.joined && ymdIn(new Date(r.joined)) === d).length,
    active: uids.filter(uid => (((users || {})[uid] || {}).beta || {}).days && users[uid].beta.days[d]).length,
  }));
  const grades = {};
  rows.forEach(r => { if (r.role === 'student' && r.grade) grades[r.grade] = (grades[r.grade] || 0) + 1; });
  // Connected sources: counted by kind of site, from the host name only (never the page address or what's on it)
  const connected = {};
  uids.forEach(uid => {
    const seenKinds = new Set();
    Object.values(((users || {})[uid] || {}).sources || {}).forEach(s => {
      const k = sourceKind(s && s.url);
      const c = connected[k] || (connected[k] = { kind: k, pages: 0, people: 0, broken: 0 });
      c.pages++; if (s && s.error) c.broken++;
      if (!seenKinds.has(k)) { seenKinds.add(k); c.people++; }
    });
  });
  const students = rows.filter(r => r.role === 'student');
  return {
    at: now,
    totals: {
      people: rows.length, students: students.length, parents: rows.filter(r => r.role === 'parent').length,
      today: rows.filter(r => r.seen && ymdIn(new Date(r.seen)) === today).length, week: rows.filter(r => r.days7 > 0 || (r.seen && now - r.seen < 7 * DAY)).length,
      month: rows.filter(r => r.days30 > 0 || (r.seen && now - r.seen < 30 * DAY)).length,
      newWeek: rows.filter(r => r.joined && now - r.joined < 7 * DAY).length,
      button: rows.filter(r => r.button).length, sources: rows.filter(r => r.sources).length, phone: rows.filter(r => r.phone).length,
      feedback: fb.length, open: fb.filter(f => !f.done && f.kind === 'bug').length,
    },
    // How far students get: signed up -> picked a grade -> connected something -> came back on 3+ of the last 7 days
    funnel: [
      ['Signed up', rows.filter(r => r.role !== 'parent').length],
      ['Finished sign-up', students.length],
      ['Connected a source', students.filter(r => r.sources || r.button).length],
      ['Regulars (3+ days a week)', students.filter(r => r.days7 >= 3).length],
    ],
    trend, grades, connected: Object.values(connected).sort((a, b) => b.pages - a.pages),
    errors: errorGroups(ex.errors, now), jobs: ex.jobs || {}, rows, feedback: fb,
  };
}
// Which kind of site a saved source is, from its host name
function sourceKind(url) {
  let h = '';
  try { h = new URL(String(url || '')).hostname.toLowerCase(); } catch (e) { return 'File or text'; }
  if (/onenote|sharepoint|1drv|onedrive/.test(h)) return 'OneNote';
  if (/teams\.(microsoft|live)/.test(h)) return 'Teams';
  if (/aeries/.test(h)) return 'Aeries';
  if (h === 'mail.google.com') return 'Gmail';
  if (/outlook\.(office|office365|live)\.com$/.test(h)) return 'Outlook';
  if (h === 'classroom.google.com') return 'Google Classroom';
  if (/(^|\.)pvpusd\.net$/.test(h)) return 'School website';
  if (/pearson|savvas|mylab/.test(h)) return 'Pearson';
  if (/collegeboard\.org$/.test(h)) return 'AP Classroom';
  return 'Other link';
}
// Errors from the last 7 days, grouped so one bug hitting many people shows once with a count
function errorGroups(errors, now) {
  const g = {};
  let day = 0, week = 0;
  Object.values(errors || {}).forEach(e => {
    if (!e || !e.at || now - e.at > 7 * DAY) return;
    week++; if (now - e.at < DAY) day++;
    const k = (e.src || 'app') + '|' + (e.where || '') + '|' + String(e.msg || '').slice(0, 120);
    const x = g[k] || (g[k] = { src: e.src || 'app', where: e.where || '', msg: e.msg || '', count: 0, people: new Set(), first: e.at, last: 0, page: null, ext: null, stack: null });
    x.count++; if (e.uid) x.people.add(e.uid);
    x.first = Math.min(x.first, e.at);
    if (e.at > x.last) { x.last = e.at; x.page = e.page || null; x.ext = e.ext || null; x.stack = e.stack || null; x.app = e.app || null; }
  });
  const list = Object.values(g).map(x => ({ ...x, people: x.people.size })).sort((a, b) => b.last - a.last).slice(0, 40);
  return { day, week, list };
}
// Error reports are cut down before saving: no emails, long numbers, or link query strings, so no student content is kept
function scrubError(s, max) {
  return String(s || '').replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>').replace(/(https?:\/\/[^\s?#'")]+)[?#][^\s'")]*/g, '$1')
    .replace(/\b\d{6,}\b/g, '<n>').replace(/\s+\n/g, '\n').slice(0, max);
}

// ---- PVPHS school info: the school website, read once a day for every student (see schoolDaily in index.js)
const SCHOOL_KINDS = ['no_school', 'schedule', 'exam', 'deadline', 'drill', 'asb', 'election', 'counseling', 'college', 'testing', 'club', 'sports', 'arts', 'event', 'announcement'];
const SCHOOL_GRADES = [9, 10, 11, 12];

// Every calendar event from now to `ahead` days out: {title, date, time, location, details, link}. Times in UTC become Pacific.
function icsEvents(ics, today, ahead = 120) {
  const text = String(ics).replace(/\r?\n[ \t]/g, '');
  const un = s => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').replace(/\s+/g, ' ').trim();
  const out = [];
  for (const block of text.split('BEGIN:VEVENT').slice(1)) {
    const get = k => { const m = new RegExp('^' + k + '(?:;[^:\\n]*)?:(.*)$', 'm').exec(block); return m ? m[1].trim() : ''; };
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{2}(Z?))?/.exec(get('DTSTART'));
    if (!m) continue;
    let date = `${m[1]}-${m[2]}-${m[3]}`, time = m[4] ? `${m[4]}:${m[5]}` : null;
    if (m[6]) {
      const at = new Date(`${date}T${time}:00Z`);
      date = ymdIn(at);
      time = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
    }
    if (time === '00:00') time = null;
    const d = daysBetween(today, date);
    const title = un(get('SUMMARY'));
    if (!title || d < -1 || d > ahead) continue;
    out.push({ title: title.slice(0, 160), date, time, location: un(get('LOCATION')).slice(0, 80) || null, details: htmlToText(un(get('DESCRIPTION'))).replace(/\s+/g, ' ').slice(0, 300) || null, link: get('URL') || null });
  }
  return out.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
}

// Just the page's own content on the school's Edlio site (drops the big site menu and the footer)
function edlioMain(html) {
  const s = String(html), a = s.indexOf('id="content_main"'), b = s.indexOf('id="footer_main"');
  if (a < 0) return s;
  const from = s.indexOf('>', a) + 1, to = b > a ? s.lastIndexOf('<', b) : -1;
  return s.slice(from, to > from ? to : undefined);
}

// The school's own student calendar, plus the master calendar minus practices, games and anything already listed
const ROUTINE = /\b(practice|rehearsal|scrimmage|conditioning|open gym|weight ?room)\b|\b(VR|JV|FS|varsity|frosh)\b|\s(vs\.?|@)\s|^(tennis|volleyball|water polo|football|basketball|soccer|baseball|softball|swim|track|golf|wrestling|cross country|lacrosse)\b/i;
function schoolEvents(curated, master) {
  const key = e => e.date + '|' + e.title.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24);
  const seen = new Set(), out = [];
  for (const e of curated) if (!seen.has(key(e))) { seen.add(key(e)); out.push({ ...e, cal: 'school' }); }
  for (const e of master) if (!ROUTINE.test(e.title) && !seen.has(key(e))) { seen.add(key(e)); out.push({ ...e, cal: 'master' }); }
  return out.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
}

// One AI-read school item -> what TaskM stores at /school/pvphs/items. Dated items that are long past are dropped.
function toSchoolItem(x, today) {
  if (!x || !x.title || !SCHOOL_KINDS.includes(x.kind)) return null;
  const date = isYmd(x.date) ? x.date : null, end = isYmd(x.end_date) && date && x.end_date > date ? x.end_date : null;
  if (date && daysBetween(today, end || date) < -1) return null;
  if (date && daysBetween(today, date) > 365) return null;
  const grades = [...new Set((x.grades || []).map(Number))].filter(g => SCHOOL_GRADES.includes(g)).sort();
  const title = String(x.title).trim().slice(0, 160);
  return {
    id: 'sch-' + hash([title.toLowerCase(), date || ''].join('|')).slice(0, 16),
    title, kind: x.kind, date, end_date: end, time: isHm(x.time) ? x.time : null,
    grades: grades.length === 4 ? [] : grades,            // [] = everyone
    audience: ['students', 'parents', 'everyone'].includes(x.audience) ? x.audience : 'everyone',
    importance: ['high', 'normal', 'low'].includes(x.importance) ? x.importance : 'normal',
    summary: String(x.summary || '').trim().slice(0, 400),
    link: safeUrl(x.link || '') || null,
    source: String(x.source || '').slice(0, 60) || 'PVPHS website',
  };
}
// Dated items first (soonest first), then undated reference info; duplicates by id dropped
function sortSchool(items) {
  const by = {};
  for (const i of items) if (i && !by[i.id]) by[i.id] = i;
  return Object.values(by).sort((a, b) => (a.date ? 0 : 1) - (b.date ? 0 : 1) || String(a.date || '').localeCompare(String(b.date || '')) || a.title.localeCompare(b.title));
}

module.exports = { isOwner, betaSummary, sourceKind, errorGroups, scrubError, TZ, ymdIn, weekdayIn, offsetOn, addDays, daysBetween, nextSchoolDay, hash, toItem, htmlToText, icsToTasks, safeUrl, combine, TYPES, toGrade, combineGrades, toEmail, MAIL_CATS, officeText, clipKey, clipLabel,
  SCHOOL_KINDS, SCHOOL_GRADES, icsEvents, schoolEvents, toSchoolItem, sortSchool, edlioMain };
