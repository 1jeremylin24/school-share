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

// Links inside a school page become "text (url)" so the AI can hand them on (only http(s) links; relative ones made absolute)
function linkText(html, base) {
  return String(html).replace(/<a\b[^>]*?href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, href, inner) => {
    let url; try { url = new URL(href.replace(/&amp;/g, '&'), base).toString(); } catch (e) { return inner; }
    if (!/^https?:/i.test(url)) return inner;
    const label = htmlToText(inner);
    return label ? `${inner} (${url})` : inner;
  });
}

// Bell schedule pictures and PDFs on the school's Bell Schedule page (the school posts them as images)
function bellFiles(html) {
  const s = edlioMain(html), out = [];
  for (const m of s.matchAll(/https:\/\/\d\.files\.edl\.io\/[^"'\s)]+\.(png|jpe?g|gif|webp|pdf)/gi)) if (!out.includes(m[0])) out.push(m[0]);
  return out.filter(u => !/ace8\/06\/10\/26\//.test(u)).slice(0, 14);  // not the district calendar PDF
}

// AI-read bell schedules -> [{id, name, weekdays, periods:[{name,start,end}]}]; times are HH:MM (24-hour), periods in order
function toBells(list) {
  const out = [], seen = new Set();
  for (const b of list || []) {
    const name = String(b && b.name || '').trim().slice(0, 60);
    if (!name || seen.has(name.toLowerCase())) continue;
    const periods = (b.periods || []).map(p => ({ name: String(p && p.name || '').trim().slice(0, 40), start: p && p.start, end: p && p.end }))
      .filter(p => p.name && isHm(p.start) && isHm(p.end) && p.end > p.start).sort((x, y) => x.start.localeCompare(y.start));
    if (!periods.length) continue;
    seen.add(name.toLowerCase());
    const weekdays = [...new Set((b.weekdays || []).map(Number))].filter(n => n >= 1 && n <= 5).sort();
    out.push({ id: 'bell-' + hash(name.toLowerCase()).slice(0, 10), name, weekdays, periods, note: String(b.note || '').trim().slice(0, 200) || null });
  }
  return out;
}

// AI-read special school days -> [{date, schedule, note}]: schedule is one of the bell schedule names, or 'No school'
function toDays(list, today, names) {
  const ok = new Map((names || []).map(n => [n.toLowerCase(), n])), by = {};
  for (const x of list || []) {
    if (!x || !isYmd(x.date)) continue;
    const dd = daysBetween(today, x.date);
    if (dd < -1 || dd > 120) continue;
    const raw = String(x.schedule || '').trim(), sched = /^no school$/i.test(raw) ? 'No school' : ok.get(raw.toLowerCase());
    if (!sched) continue;
    by[x.date] = { date: x.date, schedule: sched, note: String(x.note || '').trim().slice(0, 200) || null };
  }
  return Object.values(by).sort((a, b) => a.date.localeCompare(b.date));
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

// ================= Parents, school staff and the school-wide view =================
// A task's due day (YYYY-MM-DD, Pacific) from the shared summary a student's app publishes for linked parents
function dueDay(i) {
  if (!i) return null;
  if (isYmd(i.due)) return i.due;
  const t = Date.parse(i.due_sort || i.due || '');
  return isNaN(t) ? null : ymdIn(new Date(t));
}
const isTest = i => i && (i.type === 'test' || i.type === 'quiz');
// One student's week for the parent email: overdue, due in the next 7 days, tests in the next 14, grade changes, and what got done
function weekDigest(s, now) {
  if (!s || !Array.isArray(s.items)) return null;
  const today = ymdIn(new Date(now)), wk = addDays(today, 7), two = addDays(today, 14), from = addDays(today, -7), done = s.done || {};
  const isDone = i => i.status === 'done' || !!done[i.id];
  const open = s.items.filter(i => i && i.id && !isDone(i)), dated = open.map(i => ({ i, d: dueDay(i) })).filter(x => x.d);
  const by = (a, b) => a.d.localeCompare(b.d);
  const row = x => ({ title: String(x.i.title || '').slice(0, 140), cls: String(x.i.category || '').slice(0, 60), day: x.d, type: x.i.type || 'assignment' });
  const finished = s.items.filter(i => {
    if (!i || !isDone(i)) return false;
    const at = typeof done[i.id] === 'string' ? ymdIn(new Date(done[i.id])) : dueDay(i);
    return at && at >= from && at <= today;
  }).length;
  return {
    name: String(s.name || '').split(' ')[0] || 'Your student',
    overdue: dated.filter(x => x.d < today).sort(by).map(row),
    week: dated.filter(x => x.d >= today && x.d < wk).sort(by).map(row),
    tests: dated.filter(x => isTest(x.i) && x.d >= today && x.d < two).sort(by).map(row),
    grades: (s.grades || []).filter(g => g && g.course && typeof g.pct === 'number').map(g => ({ course: String(g.course).slice(0, 60), pct: g.pct, prev: typeof g.prev === 'number' ? g.prev : null, letter: g.letter || g.cl || null })),
    finished, updated: s.updated || null, hours: s.hours && typeof s.hours.total === 'number' ? { total: s.hours.total, goal: s.hours.goal || null } : null,
  };
}
// Plain-text and HTML email for one parent; kids = [weekDigest]
function digestEmail(parentName, kids, appUrl) {
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const day = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const move = g => (g.prev == null || Math.abs(g.pct - g.prev) < 0.5 ? '' : g.pct > g.prev ? ` (up from ${g.prev}%)` : ` (down from ${g.prev}%)`);
  const text = [], html = [];
  const hi = parentName ? `Hi ${parentName.split(' ')[0]},` : 'Hi,';
  text.push(hi, '', 'Here is the week ahead from TaskM.', '');
  html.push(`<p>${esc(hi)}</p><p>Here is the week ahead from TaskM.</p>`);
  for (const k of kids) {
    const line = [k.overdue.length ? `${k.overdue.length} overdue` : null, `${k.week.length} due this week`, k.tests.length ? `${k.tests.length} test${k.tests.length > 1 ? 's and quizzes' : ' or quiz'} in the next 2 weeks` : null, `${k.finished} finished last week`].filter(Boolean).join(', ');
    text.push(`${k.name}: ${line}.`);
    html.push(`<h2 style="font:600 18px system-ui;margin:24px 0 4px">${esc(k.name)}</h2><p style="margin:0 0 12px;color:#444">${esc(line)}.</p>`);
    const list = (title, rows) => {
      if (!rows.length) return;
      text.push('', title + ':', ...rows.slice(0, 8).map(r => `- ${day(r.day)}: ${r.title}${r.cls ? ' (' + r.cls + ')' : ''}`));
      html.push(`<p style="margin:12px 0 4px;font-weight:600">${esc(title)}</p><ul style="margin:0;padding-left:18px">${rows.slice(0, 8).map(r => `<li>${esc(day(r.day))}: ${esc(r.title)}${r.cls ? ' <span style="color:#666">(' + esc(r.cls) + ')</span>' : ''}</li>`).join('')}</ul>`);
    };
    list('Overdue', k.overdue);
    list('Tests and quizzes', k.tests);
    list('Due this week', k.week.filter(r => !isTest(r)));
    const moved = k.grades.filter(g => move(g));
    if (moved.length) {
      text.push('', 'Grade changes:', ...moved.map(g => `- ${g.course}: ${g.pct}%${move(g)}`));
      html.push(`<p style="margin:12px 0 4px;font-weight:600">Grade changes</p><ul style="margin:0;padding-left:18px">${moved.map(g => `<li>${esc(g.course)}: ${esc(g.pct)}%${esc(move(g))}</li>`).join('')}</ul>`);
    }
    if (k.hours) text.push('', `Service hours: ${k.hours.total}${k.hours.goal ? ' of ' + k.hours.goal : ''}`);
  }
  text.push('', `Open TaskM: ${appUrl}`, '', 'You get this because you linked to a student in TaskM. To stop these emails, open TaskM and turn off "Weekly email".');
  html.push(`<p style="margin:24px 0"><a href="${esc(appUrl)}" style="background:#5b5bd6;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none">Open TaskM</a></p><p style="color:#777;font-size:12px">You get this because you linked to a student in TaskM. To stop these emails, open TaskM and turn off “Weekly email”.</p>`);
  return { text: text.join('\n'), html: `<div style="font:15px/1.5 system-ui;color:#111;max-width:560px">${html.join('')}</div>` };
}
// Staff announcements (posted from app/staff.html): cleaned and capped
const POST_KINDS = ['announcement', 'deadline', 'counseling', 'college', 'testing', 'event', 'club', 'sports', 'schedule'];
function toPost(x, by, today) {
  const title = String((x && x.title) || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (title.length < 3) return null;
  const grades = Array.isArray(x.grades) ? [...new Set(x.grades.map(Number).filter(g => SCHOOL_GRADES.includes(g)))].sort() : [];
  const date = isYmd(x.date) && x.date >= today ? x.date : null;
  const days = Math.min(60, Math.max(1, parseInt(x.days, 10) || 14));
  return {
    title, body: String(x.body || '').trim().slice(0, 800), kind: POST_KINDS.includes(x.kind) ? x.kind : 'announcement',
    grades: grades.length === 4 ? [] : grades, date, until: date || addDays(today, days),
    link: safeUrl(x.link || '') || null, by: String(by || 'PVPHS staff').slice(0, 80),
  };
}
// The school-wide test calendar: per day and grade, how many TaskM students have a test or quiz, and how many have 2 or more.
// No names, no classes, and a grade with fewer than MIN_GROUP students on TaskM is left out so nobody can be singled out.
const MIN_GROUP = 5;
function busyDays(summaries, now, days = 21) {
  const today = ymdIn(new Date(now)), end = addDays(today, days), per = {}, size = {};
  for (const s of summaries) {
    const g = parseInt(s && s.grade, 10);
    if (!SCHOOL_GRADES.includes(g) || !Array.isArray(s.items)) continue;
    size[g] = (size[g] || 0) + 1;
    const done = s.done || {}, mine = {};
    for (const i of s.items) {
      if (!isTest(i) || i.status === 'done' || done[i.id]) continue;
      const d = dueDay(i);
      if (d && d >= today && d < end) mine[d] = (mine[d] || 0) + 1;
    }
    for (const [d, n] of Object.entries(mine)) {
      const k = d + '|' + g, c = per[k] || (per[k] = { date: d, grade: g, students: 0, heavy: 0, tests: 0 });
      c.students++; c.tests += n; if (n >= 2) c.heavy++;
    }
  }
  const rows = Object.values(per).filter(c => size[c.grade] >= MIN_GROUP).map(c => ({ ...c, of: size[c.grade] }));
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.grade - b.grade);
  return { from: today, to: end, rows, students: Object.fromEntries(SCHOOL_GRADES.map(g => [g, size[g] || 0])), minGroup: MIN_GROUP };
}

module.exports = { isOwner, betaSummary, sourceKind, errorGroups, scrubError, TZ, ymdIn, weekdayIn, offsetOn, addDays, daysBetween, nextSchoolDay, hash, toItem, htmlToText, icsToTasks, safeUrl, combine, TYPES, toGrade, combineGrades, toEmail, MAIL_CATS, officeText, clipKey, clipLabel,
  SCHOOL_KINDS, SCHOOL_GRADES, icsEvents, schoolEvents, toSchoolItem, sortSchool, edlioMain, linkText, bellFiles, toBells, toDays,
  dueDay, weekDigest, digestEmail, POST_KINDS, toPost, busyDays, MIN_GROUP };
