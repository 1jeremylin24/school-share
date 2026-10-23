const test = require('node:test');
const assert = require('node:assert');
const L = require('../lib');

test('homework with only an assigned date is due the next school day', () => {
  assert.strictEqual(L.nextSchoolDay('2026-10-15'), '2026-10-16'); // Thu -> Fri
  assert.strictEqual(L.nextSchoolDay('2026-10-16'), '2026-10-19'); // Fri -> Mon
  const it = L.toItem({ title: 'Worksheet 4.2', type: 'assignment', class_name: 'Calculus BC', due_date: null, assigned_date: '2026-10-16' }, { source: 'Pasted text', today: '2026-10-16' });
  assert.strictEqual(it.due, '2026-10-19');
  assert.strictEqual(it.due_sort, '2026-10-19T23:59:00-07:00');
  assert.strictEqual(it.class_short, 'Calculus BC');
  assert.strictEqual(it.importance, 'Low');
});

test('tests keep their date and time, and get the PST offset after the clocks change', () => {
  const it = L.toItem({ title: 'Unit 3 Test', type: 'test', class_name: 'AP Biology', due_date: '2026-11-03', due_time: '08:00', assigned_date: '2026-10-20' }, { source: 'x', today: '2026-10-17' });
  assert.strictEqual(it.due, '2026-11-03T08:00:00-08:00');
  assert.strictEqual(it.due_has_time, true);
  assert.strictEqual(it.importance, 'High');
});

test('items with no date or a bad date are dropped; ids are stable', () => {
  assert.strictEqual(L.toItem({ title: 'Read ch 5', type: 'assignment', due_date: null, assigned_date: null }, { source: 'x', today: '2026-10-17' }), null);
  assert.strictEqual(L.toItem({ title: 'x', type: 'test', due_date: 'next week' }, { source: 'x', today: '2026-10-17' }), null);
  const a = L.toItem({ title: 'Essay', type: 'project', due_date: '2026-10-30' }, { source: 'a', today: '2026-10-17' });
  const b = L.toItem({ title: 'essay', type: 'project', due_date: '2026-10-30' }, { source: 'b', today: '2026-10-18' });
  assert.strictEqual(a.id, b.id);
});

test('calendar feeds are read without AI', () => {
  const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261111\r\nSUMMARY:No School - Veterans\r\n Day\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART:20261020T150000Z\r\nSUMMARY:Chem Quiz\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART:20250101\r\nSUMMARY:Old\r\nEND:VEVENT\r\nEND:VCALENDAR';
  const t = L.icsToTasks(ics, '2026-10-17');
  assert.deepStrictEqual(t.map(x => [x.title, x.type, x.due_date]), [['No School - VeteransDay', 'event', '2026-11-11'], ['Chem Quiz', 'quiz', '2026-10-20']]);
});

test('only public links are fetched', () => {
  assert.ok(L.safeUrl('https://pvhs.pvpusd.net/calendar'));
  assert.strictEqual(L.safeUrl('webcal://example.com/a.ics'), 'https://example.com/a.ics');
  for (const bad of ['http://localhost/x', 'http://169.254.169.254/', 'http://metadata.google.internal/', 'file:///etc/passwd', 'http://[::1]/', 'https://user:pw@example.com/', 'nonsense'])
    assert.strictEqual(L.safeUrl(bad), null, bad);
});

test('web pages become plain text', () => {
  assert.strictEqual(L.htmlToText('<html><head><title>x</title></head><body><script>bad()</script><p>HW: p. 12&nbsp;#1-5</p><p>Quiz Fri</p></body></html>'), 'HW: p. 12 #1-5\nQuiz Fri');
});

test('combine dedupes and drops items more than three weeks old', () => {
  const x = { id: 'a', due: '2026-10-20', due_sort: '2026-10-20T23:59:00-07:00' };
  const old = { id: 'b', due: '2026-09-01', due_sort: '2026-09-01T23:59:00-07:00' };
  assert.deepStrictEqual(L.combine([[x, old], [{ ...x, title: 'new' }]], '2026-10-17'), [{ ...x, title: 'new' }]);
});

test('Word and PowerPoint files are read as text', () => {
  const { execFileSync } = require('child_process');
  const fs = require('fs'), os = require('os'), path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-'));
  fs.mkdirSync(path.join(dir, 'word'));
  fs.writeFileSync(path.join(dir, 'word', 'document.xml'), '<w:document><w:body><w:p><w:r><w:t>Chem lab report due Friday &amp; bring goggles</w:t></w:r></w:p><w:p><w:r><w:t>Quiz 10/22</w:t></w:r></w:p></w:body></w:document>');
  fs.writeFileSync(path.join(dir, '[Content_Types].xml'), '<Types/>');
  execFileSync('python3', ['-c', 'import shutil,sys;shutil.make_archive(sys.argv[1],"zip",sys.argv[2])', path.join(dir, 'out'), dir]);
  const text = L.officeText(fs.readFileSync(path.join(dir, 'out.zip')));
  assert.strictEqual(text, 'Chem lab report due Friday & bring goggles\nQuiz 10/22');
});

test('grades keep the newest value per class', () => {
  assert.deepStrictEqual(L.toGrade({ class_name: 'AP Biology', percent: 93.456 }, 'Aeries'), { course: 'AP Biology', pct: 93.5, source: 'Aeries' });
  assert.strictEqual(L.toGrade({ class_name: 'Art', percent: null }, 'x'), null);
  assert.deepStrictEqual(L.toGrade({ class_name: 'AP Calculus BC', percent: 78, letter: 'a' }, 'Aeries'), { course: 'AP Calculus BC', pct: 78, source: 'Aeries', letter: 'A' });
  assert.deepStrictEqual(L.toGrade({ class_name: 'PE', percent: null, letter: 'B+' }, 'Aeries'), { course: 'PE', pct: null, source: 'Aeries', letter: 'B+' });
  assert.deepStrictEqual(L.toGrade({ class_name: 'Art', percent: 91, letter: 'Pass' }, 'x'), { course: 'Art', pct: 91, source: 'x' });
  const g = L.combineGrades({
    a: { at: '2026-10-10T00:00:00Z', list: [{ course: 'AP Biology', pct: 88, source: 'Aeries' }, { course: 'Calc BC', pct: 95, source: 'Aeries' }] },
    b: { at: '2026-10-16T00:00:00Z', list: [{ course: 'ap biology', pct: 91, source: 'Aeries' }] },
  });
  assert.deepStrictEqual(g.map(x => [x.course, x.pct]), [['ap biology', 91], ['Calc BC', 95]]);
});

test('Chrome button pages keep the id the app gave them', () => {
  assert.strictEqual(L.clipKey('https://pvpusd-my.sharepoint.com/personal/kimk_pvpusd_net/_layouts/15/Doc.aspx?sourcedoc={abc}&wd=target%28Ch%204.one%7Cx%2F4.3%7Cy%2F%29'), 'cp5ki9ijgq1im');
  assert.strictEqual(L.clipLabel('Ch 4.one - Microsoft OneNote Online', 'https://x.sharepoint.com/'), 'Ch 4.one');
  assert.strictEqual(L.clipLabel('', 'https://www.aeries.net/student/'), 'aeries.net');
});

test('emails become Email tab rows with a stable id', () => {
  const m = { from: 'Caroline Lin', subject: 'AP exam registration', received: '2026-10-13', summary: 'Register by Fri Oct 23; $110 per exam.', category: 'school', needs_action: true, due_date: '2026-10-23' };
  const a = L.toEmail(m), b = L.toEmail({ ...m, summary: 'different wording' });
  assert.strictEqual(a.id, b.id);
  assert.deepStrictEqual([a.from, a.cat, a.act, a.due, a.got], ['Caroline Lin', 'school', true, '2026-10-23', '2026-10-13']);
  assert.strictEqual(L.toEmail({ ...m, category: 'spam', due_date: 'Friday' }).cat, 'other');
  assert.strictEqual(L.toEmail({ ...m, due_date: 'Friday' }).due, null);
  assert.strictEqual(L.toEmail({ subject: 'x' }), null);
});

test('email pages are named after the account', () => {
  assert.strictEqual(L.clipLabel('Search results - linjeremy1124@gmail.com - Gmail', 'https://mail.google.com/mail/u/0/#search/x'), 'Gmail · linjeremy1124@gmail.com');
  assert.strictEqual(L.clipLabel('Mail - Jeremy Lin - Outlook', 'https://outlook.office.com/mail/inbox'), 'School Outlook · Jeremy Lin');
  assert.strictEqual(L.clipLabel('Outlook', 'https://outlook.live.com/mail/0/'), 'Outlook.com');
});

test('the beta usage page counts visits and setup, and only the owner may open it', () => {
  const now = Date.parse('2026-10-18T20:00:00Z');
  const users = {
    a: { profile: { name: 'Ana', role: 'student', school: 'PVHS', grade: '11' }, beta: { seen: now - 3600e3, ext: '1.3.2', days: { '2026-10-18': true, '2026-10-16': true, '2026-09-01': true } },
      sources: { s1: {}, s2: {} }, aiItems: { s1: [{}, {}], s2: [{}] }, aiMail: { m: {} } },
    b: { profile: { name: 'Ben', role: 'parent' } },
  };
  const out = L.betaSummary(users, [{ uid: 'a', email: 'ana@x.com', created: 'Thu, 15 Oct 2026 10:00:00 GMT' }, { uid: 'c', email: 'cy@x.com' }],
    { f1: { text: 'old', at: 1 }, f2: { text: 'new', at: 2 } }, now);
  assert.strictEqual(out.rows[0].name, 'Ana');
  assert.deepStrictEqual([out.rows[0].days7, out.rows[0].days30, out.rows[0].tasks, out.rows[0].sources, out.rows[0].inboxes], [2, 2, 3, 2, 1]);
  assert.strictEqual(out.rows.find(r => r.email === 'cy@x.com').role, 'not set up');
  assert.deepStrictEqual(out.totals, { people: 3, students: 1, parents: 1, today: 1, week: 1, month: 1, newWeek: 1, button: 1, sources: 1, phone: 0, feedback: 2, open: 0 });
  assert.strictEqual(out.trend.length, 30);
  assert.deepStrictEqual(out.trend[29], { day: '2026-10-18', signups: 0, active: 1 });
  assert.strictEqual(out.trend.find(t => t.day === '2026-10-15').signups, 1);
  assert.deepStrictEqual(out.funnel.map(f => f[1]), [2, 1, 1, 0]);
  assert.deepStrictEqual(out.grades, { 11: 1 });
  assert.strictEqual(out.feedback[0].text, 'new');
  assert.strictEqual(L.isOwner({ email: 'LinJeremy1124@gmail.com', email_verified: true }), true);
  assert.strictEqual(L.isOwner({ email: 'linjeremy1124@gmail.com', email_verified: false }), false);
  assert.strictEqual(L.isOwner({ email: 'someone@gmail.com', email_verified: true }), false);
});

test('admin page: sources counted by kind of site, errors grouped and scrubbed', () => {
  const now = Date.parse('2026-10-18T20:00:00Z');
  const users = { a: { sources: { s1: { url: 'https://pvpusd-my.sharepoint.com/x?y=1' }, s2: { url: 'https://mail.google.com/mail/u/0/#search/x', error: 'Sign in' }, s3: { url: 'https://onenote.officeapps.live.com/' } } },
    b: { sources: { s1: { url: 'https://pvphs.pvpusd.net/news' } } } };
  const out = L.betaSummary(users, [], {}, now, { errors: {
    e1: { src: 'app', where: 'tools', msg: 'x is undefined', uid: 'a', at: now - 3600e3 }, e2: { src: 'app', where: 'tools', msg: 'x is undefined', uid: 'b', at: now - 60e3 },
    e3: { src: 'server', where: 'aiAdd', msg: 'boom', at: now - 3 * 864e5 }, e4: { src: 'app', msg: 'old', at: now - 9 * 864e5 } } });
  assert.deepStrictEqual(out.connected.find(c => c.kind === 'OneNote'), { kind: 'OneNote', pages: 2, people: 1, broken: 0 });
  assert.deepStrictEqual(out.connected.find(c => c.kind === 'Gmail'), { kind: 'Gmail', pages: 1, people: 1, broken: 1 });
  assert.strictEqual(L.sourceKind('https://pvphs.pvpusd.net/'), 'School website');
  assert.strictEqual(L.sourceKind('not a url'), 'File or text');
  assert.deepStrictEqual([out.errors.day, out.errors.week, out.errors.list.length], [2, 3, 2]);
  assert.deepStrictEqual([out.errors.list[0].count, out.errors.list[0].people], [2, 2]);
  assert.strictEqual(L.scrubError('Failed for ana@x.com at https://a.com/p?token=abc id 12345678', 300), 'Failed for <email> at https://a.com/p id <n>');
});

test('school calendars: Pacific times, HTML descriptions cleaned, master calendar minus games, practices and repeats', () => {
  const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261023T153000Z\r\nSUMMARY:Disaster Drill\r\nDESCRIPTION:<p>Fire evacuation&#160;drill</p>\r\nEND:VEVENT\r\n' +
    'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261111\r\nSUMMARY:No School\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART:20250101\r\nSUMMARY:Old\r\nEND:VEVENT\r\nEND:VCALENDAR';
  const cur = L.icsEvents(ics, '2026-10-18');
  assert.deepStrictEqual(cur.map(e => [e.date, e.time, e.title]), [['2026-10-23', '08:30', 'Disaster Drill'], ['2026-11-11', null, 'No School']]);
  assert.strictEqual(cur[0].details, 'Fire evacuation drill');
  const master = [{ date: '2026-10-23', time: null, title: 'Disaster drill' }, { date: '2026-10-20', time: null, title: 'Football Practice-Field' },
    { date: '2026-10-20', time: null, title: 'Tennis, Girls VR vs Palos Verdes' }, { date: '2026-11-03', time: '08:00', title: 'Mandated 11th Grade Hearing Screening' }];
  assert.deepStrictEqual(L.schoolEvents(cur, master).map(e => [e.title, e.cal]),
    [['Disaster Drill', 'school'], ['Mandated 11th Grade Hearing Screening', 'master'], ['No School', 'school']]);
});

test('school items: grade tags, everyone when all four grades, past items dropped, undated info last', () => {
  const t = '2026-10-18';
  const a = L.toSchoolItem({ title: 'Senior meeting', kind: 'counseling', date: '2026-10-19', grades: [12, 12, 7], importance: 'high', summary: 'x', link: 'javascript:alert(1)' }, t);
  assert.deepStrictEqual([a.grades, a.importance, a.link, a.audience], [[12], 'high', null, 'everyone']);
  assert.deepStrictEqual(L.toSchoolItem({ title: 'Pep rally', kind: 'event', date: '2026-10-29', grades: [9, 10, 11, 12] }, t).grades, []);
  assert.strictEqual(L.toSchoolItem({ title: 'Old', kind: 'event', date: '2026-10-01' }, t), null);
  assert.strictEqual(L.toSchoolItem({ title: 'x', kind: 'party', date: '2026-10-20' }, t), null);
  assert.ok(L.toSchoolItem({ title: 'AP week', kind: 'deadline', date: '2026-10-15', end_date: '2026-10-23' }, t), 'still running');
  const info = L.toSchoolItem({ title: 'Counselor directory', kind: 'counseling', date: null }, t);
  const s = L.sortSchool([info, a, a]);
  assert.deepStrictEqual(s.map(x => x.title), ['Senior meeting', 'Counselor directory']);
});

test('only the page content of an Edlio school page is kept', () => {
  const html = '<nav>Home | School Info | lots of menu</nav><div id="content_main" class="x"><h1>AP Exams</h1><p>Register by Oct 23</p></div><footer id="footer_main">Address</footer>';
  assert.strictEqual(L.htmlToText(L.edlioMain(html)), 'AP Exams\nRegister by Oct 23');
});

test('school page links are kept for the AI, bell schedule files found, bells and special days cleaned', () => {
  const html = '<p>Sign up <a href="/apps/pages/AP">here</a> or <a href="javascript:x()">not this</a></p>';
  assert.strictEqual(L.htmlToText(L.linkText(html, 'https://pvphs.pvpusd.net/apps/pages/x')), 'Sign up here (https://pvphs.pvpusd.net/apps/pages/AP) or not this');
  const page = '<div id="content_main"><img src="https://3.files.edl.io/2676/22/06/21/a.png"><a href="https://4.files.edl.io/f6d5/08/26/25/b.pdf">PDF</a>' +
    '<a href="https://4.files.edl.io/ace8/06/10/26/cal.pdf">cal</a><img src="https://3.files.edl.io/2676/22/06/21/a.png"></div><footer id="footer_main"></footer>';
  assert.deepStrictEqual(L.bellFiles(page), ['https://3.files.edl.io/2676/22/06/21/a.png', 'https://4.files.edl.io/f6d5/08/26/25/b.pdf']);
  const bells = L.toBells([
    { name: 'Regular', weekdays: [1, 2, 4, 5, 9], periods: [{ name: 'Period 2', start: '09:00', end: '09:50' }, { name: 'Period 1', start: '08:00', end: '08:52' }, { name: 'Bad', start: '1:05', end: '2:00' }] },
    { name: 'regular', weekdays: [], periods: [{ name: 'x', start: '08:00', end: '09:00' }] },
    { name: 'Late Start', weekdays: [3], periods: [] }]);
  assert.deepStrictEqual(bells.map(b => [b.name, b.weekdays, b.periods.map(p => p.name)]), [['Regular', [1, 2, 4, 5], ['Period 1', 'Period 2']]]);
  const days = L.toDays([{ date: '2026-10-23', schedule: 'regular', note: 'Disaster drill' }, { date: '2026-11-11', schedule: 'NO SCHOOL' },
    { date: '2026-10-21', schedule: 'Made up' }, { date: '2026-09-01', schedule: 'Regular' }], '2026-10-19', ['Regular']);
  assert.deepStrictEqual(days.map(d => [d.date, d.schedule]), [['2026-10-23', 'Regular'], ['2026-11-11', 'No school']]);
});

test('parent digest: overdue, week, tests, grade changes and finished work', () => {
  const now = Date.parse('2026-10-22T19:00:00Z');
  const s = { name: 'Alex Kim', updated: '2026-10-22T18:00:00Z', done: { d1: '2026-10-20T03:00:00Z' }, grades: [{ course: 'AP Bio', pct: 88.7, prev: 91 }, { course: 'Calc', pct: 94 }],
    items: [{ id: 'o', title: 'Old', due: '2026-10-20', type: 'assignment' }, { id: 't', title: 'Unit 3 test', due: '2026-10-30', type: 'test', category: 'AP Bio' },
      { id: 'w', title: 'Lab', due_sort: '2026-10-23T23:59:00-07:00', type: 'assignment' }, { id: 'd1', title: 'Done one', due: '2026-10-19' }, { id: 'x', title: 'Done too', due: '2026-10-21', status: 'done' }] };
  const k = L.weekDigest(s, now);
  assert.strictEqual(k.name, 'Alex');
  assert.deepStrictEqual(k.overdue.map(r => r.title), ['Old']);
  assert.deepStrictEqual(k.week.map(r => r.title), ['Lab']);
  assert.deepStrictEqual(k.tests.map(r => r.title), ['Unit 3 test']);
  assert.strictEqual(k.finished, 2);
  const e = L.digestEmail('Dana Kim', [k], 'https://taskm-school.web.app/app');
  assert.match(e.text, /Hi Dana,/);
  assert.match(e.text, /AP Bio: 88.7% \(down from 91%\)/);
  assert.doesNotMatch(e.text, /Calc:/);
  assert.match(e.html, /Open TaskM/);
});

test('staff posts are cleaned; busy test days hide small grades and never name anyone', () => {
  const p = L.toPost({ title: '  PSAT sign-up  closes Friday ', grades: [11, '11', 13], kind: 'deadline', date: '2026-10-30', link: 'javascript:alert(1)' }, 'Ms. Lee', '2026-10-22');
  assert.deepStrictEqual([p.title, p.grades, p.kind, p.until, p.link], ['PSAT sign-up closes Friday', [11], 'deadline', '2026-10-30', null]);
  assert.strictEqual(L.toPost({ title: 'Hi' }, 'x', '2026-10-22'), null);
  assert.strictEqual(L.toPost({ title: 'Assembly news', grades: [9, 10, 11, 12] }, 'x', '2026-10-22').until, '2026-11-05');
  const now = Date.parse('2026-10-22T19:00:00Z');
  const kid = (g, tests) => ({ grade: String(g), name: 'Secret Name', items: tests.map((d, i) => ({ id: 'i' + i, title: 'T', type: 'test', due: d })) });
  const list = [...Array(5)].map(() => kid(11, ['2026-10-27', '2026-10-27'])).concat([kid(9, ['2026-10-27'])]);
  const r = L.busyDays(list, now);
  assert.deepStrictEqual(r.rows, [{ date: '2026-10-27', grade: 11, students: 5, heavy: 5, tests: 10, of: 5 }]);
  assert.strictEqual(r.students[9], 1);
  assert.doesNotMatch(JSON.stringify(r), /Secret/);
});
