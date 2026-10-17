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
