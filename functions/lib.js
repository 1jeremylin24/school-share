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

module.exports = { TZ, ymdIn, weekdayIn, offsetOn, addDays, daysBetween, nextSchoolDay, hash, toItem, htmlToText, icsToTasks, safeUrl, combine, TYPES };
