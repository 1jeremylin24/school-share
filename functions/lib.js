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
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
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
function toGrade(g, source) {
  if (!g || !g.class_name || g.percent === null || g.percent === undefined || g.percent === '') return null;
  const pct = Number(g.percent);
  if (!isFinite(pct) || pct < 0 || pct > 150) return null;
  return { course: String(g.class_name).trim().slice(0, 80), pct: Math.round(pct * 10) / 10, source };
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
    return (who && !/^(mail|inbox|outlook)$/i.test(who) ? 'Outlook · ' + who : 'Outlook').slice(0, 60);
  }
  return (String(title || '').replace(/\s*[-|–—:]\s*(Microsoft\s+)?(OneNote|Teams|SharePoint|Outlook)(\s+(Online|for the web))?\s*$/i, '').trim() || host).slice(0, 60);
}

module.exports = { TZ, ymdIn, weekdayIn, offsetOn, addDays, daysBetween, nextSchoolDay, hash, toItem, htmlToText, icsToTasks, safeUrl, combine, TYPES, toGrade, combineGrades, toEmail, MAIL_CATS, officeText, clipKey, clipLabel };
