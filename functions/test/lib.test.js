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
