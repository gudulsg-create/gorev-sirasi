import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, assign, cancel, passOn, nextPerson, addPerson, movePerson, changeSeniority, promoteAll, allowedSeniorities } from '../js/rotation.js';

function team() {
  let s = defaultState();
  s = addPerson(s, { id: 'ali', name: 'Ali', seniorityId: 'k5' });
  s = addPerson(s, { id: 'ayse', name: 'Ayşe', seniorityId: 'k5' });
  s = addPerson(s, { id: 'can', name: 'Can', seniorityId: 'k5' });
  s = addPerson(s, { id: 'deniz', name: 'Deniz', seniorityId: 'k4' });
  return s;
}
const give = (s, type, sen, by) => assign(s, type, sen, { by });

test('aynı tür ve kıdemde sırayla dağıtır ve başa döner', () => {
  let s = team();
  const names = [];
  for (let i = 0; i < 4; i++) {
    const r = give(s, 'patoloji', 'k5');
    s = r.state;
    names.push(r.assignment.personName);
  }
  assert.deepEqual(names, ['Ali', 'Ayşe', 'Can', 'Ali']);
});

test('farklı kişiler görev verse de sıra ortak ilerler', () => {
  let s = team();
  let r = give(s, 'patoloji', 'k5', 'Kıdemli A');
  s = r.state;
  r = give(s, 'patoloji', 'k5', 'Kıdemli B');
  assert.equal(r.assignment.personName, 'Ayşe');
  assert.equal(r.assignment.by, 'Kıdemli B');
});

test('her görev türünün sırası ayrıdır', () => {
  let s = team();
  s = give(s, 'patoloji', 'k5').state;
  s = give(s, 'patoloji', 'k5').state;
  const r = give(s, 'orneklem', 'k5');
  assert.equal(r.assignment.personName, 'Ali');
  assert.equal(nextPerson(s, 'patoloji', 'k5').name, 'Can');
});

test('her kıdemin sırası ayrıdır ve yalnızca o kıdemden kişi seçilir', () => {
  let s = team();
  s = give(s, 'kitap', 'k5').state;
  const r = give(s, 'kitap', 'k4');
  assert.equal(r.assignment.personName, 'Deniz');
});

test('müsait olmayan (izinli) kişi atlanır', () => {
  let s = team();
  s = { ...s, people: s.people.map((p) => (p.id === 'ayse' ? { ...p, active: false } : p)) };
  s = give(s, 'patoloji', 'k5').state;
  const r = give(s, 'patoloji', 'k5');
  assert.equal(r.assignment.personName, 'Can');
});

test('kıdemde kimse yoksa anlaşılır hata verir', () => {
  assert.throws(() => give(team(), 'patoloji', 'k3'), /3\. kıdem için müsait kimse yok/);
});

test('iptal edilen son görev sırayı geri alır', () => {
  let s = team();
  s = give(s, 'patoloji', 'k5').state; // Ali
  const r = give(s, 'patoloji', 'k5'); // Ayşe
  const c = cancel(r.state, r.assignment);
  assert.equal(c.restored, true);
  assert.equal(nextPerson(c.state, 'patoloji', 'k5').name, 'Ayşe');
});

test('ilk görev iptal edilirse sıra baştan başlar', () => {
  const r = give(team(), 'patoloji', 'k5');
  const c = cancel(r.state, r.assignment);
  assert.equal(nextPerson(c.state, 'patoloji', 'k5').name, 'Ali');
});

test('sonradan başka görev verildiyse iptal sırayı bozmaz', () => {
  let s = team();
  const r1 = give(s, 'patoloji', 'k5'); // Ali
  const r2 = give(r1.state, 'patoloji', 'k5'); // Ayşe
  const c = cancel(r2.state, r1.assignment);
  assert.equal(c.restored, false);
  assert.equal(nextPerson(c.state, 'patoloji', 'k5').name, 'Can');
});

test('sonrakine aktar: görev sıradaki kişiye geçer, sıra ondan devam eder', () => {
  let s = team();
  const r = give(s, 'patoloji', 'k5'); // Ali
  const p = passOn(r.state, r.assignment);
  assert.equal(p.patch.personName, 'Ayşe');
  assert.deepEqual(p.patch.skipped, [{ personId: 'ali', personName: 'Ali' }]);
  assert.equal(nextPerson(p.state, 'patoloji', 'k5').name, 'Can');
});

test('sonradan görev verildiyse aktarma reddedilir', () => {
  const r1 = give(team(), 'patoloji', 'k5');
  const r2 = give(r1.state, 'patoloji', 'k5');
  assert.throws(() => passOn(r2.state, r1.assignment), /aktarma yapılamaz/);
});

test('kıdemde tek müsait kişi varsa aktarma reddedilir', () => {
  const r = give(team(), 'kitap', 'k4');
  assert.throws(() => passOn(r.state, r.assignment), /başka müsait kişi yok/);
});

test('yeni eklenen kişi sıranın sonuna girer', () => {
  let s = team();
  s = give(s, 'patoloji', 'k5').state; // Ali
  s = give(s, 'patoloji', 'k5').state; // Ayşe
  s = addPerson(s, { id: 'ece', name: 'Ece', seniorityId: 'k5' });
  s = give(s, 'patoloji', 'k5').state; // Can
  assert.equal(nextPerson(s, 'patoloji', 'k5').name, 'Ece');
});

test('sırası gelen kişi silinirse sıradaki kişiye geçilir', () => {
  let s = team();
  s = give(s, 'patoloji', 'k5').state; // Ali, sıradaki Ayşe
  s = give(s, 'patoloji', 'k5').state; // Ayşe, sıradaki Can
  s = { ...s, people: s.people.filter((p) => p.id !== 'ayse') };
  assert.equal(nextPerson(s, 'patoloji', 'k5').name, 'Can');
});

test('sıra düzeni değiştirilebilir', () => {
  let s = movePerson(team(), 'can', -1);
  const names = [];
  for (let i = 0; i < 3; i++) {
    const r = give(s, 'orneklem', 'k5');
    s = r.state;
    names.push(r.assignment.personName);
  }
  assert.deepEqual(names, ['Ali', 'Can', 'Ayşe']);
});

test('kıdem değişikliği ve yeni dönem (herkes bir üst kıdeme)', () => {
  let s = changeSeniority(team(), 'ali', 'k4');
  assert.equal(give(s, 'kitap', 'k5').assignment.personName, 'Ayşe');
  s = promoteAll(team());
  assert.equal(s.people.filter((p) => p.seniorityId === 'k4').length, 3);
  assert.equal(s.people.find((p) => p.id === 'deniz').seniorityId, 'k3');
  const top = addPerson(defaultState(), { id: 'x', name: 'X', seniorityId: 'bas' });
  assert.equal(promoteAll(top).people.length, 0);
});

test('yalnızca alt kıdemlere görev verilebilir', () => {
  let s = addPerson(team(), { id: 'serhat', name: 'Serhat', seniorityId: 'k2' });
  assert.deepEqual(allowedSeniorities(s, 'serhat'), ['k3', 'k4', 'k5']);
  assert.deepEqual(allowedSeniorities(s, 'deniz'), ['k5']);
  assert.deepEqual(allowedSeniorities(s, 'ali'), []);
  assert.deepEqual(allowedSeniorities(s, null), ['bas', 'k2', 'k3', 'k4', 'k5']);
});

test('girdi durumunu değiştirmez', () => {
  const s = team();
  const before = JSON.stringify(s);
  const r = give(s, 'patoloji', 'k5');
  cancel(r.state, r.assignment);
  passOn(r.state, r.assignment);
  assert.equal(JSON.stringify(s), before);
});

import { monthKey, bumpStat, ranking, winners, prevMonth } from '../js/rotation.js';

test('ayın elemanı: sayaç, sıralama, eşitlik', () => {
  let s = team();
  s = bumpStat(s, '2026-11', 'ali', 1);
  s = bumpStat(s, '2026-11', 'ali', 1);
  s = bumpStat(s, '2026-11', 'can', 2);
  s = bumpStat(s, '2026-11', 'ayse', 1);
  assert.deepEqual(ranking(s, '2026-11').map((x) => x.personId), ['ali', 'can', 'ayse']);
  assert.deepEqual(winners(s, '2026-11').map((x) => x.personId), ['ali', 'can']);
  s = bumpStat(s, '2026-11', 'can', -1);
  assert.deepEqual(winners(s, '2026-11').map((x) => x.personId), ['ali']);
  s = bumpStat(s, '2026-11', 'ayse', -5);
  assert.equal(s.stats['2026-11'].ayse, undefined);
  assert.deepEqual(winners(s, '2026-10'), []);
});

test('ay anahtarları', () => {
  assert.equal(monthKey(new Date(2026, 10, 4).getTime()), '2026-11');
  assert.equal(prevMonth('2026-01'), '2025-12');
  assert.equal(prevMonth('2026-11'), '2026-10');
});

import { leaveOn, isAvailable, cleanLeaves } from '../js/rotation.js';

test('tarihli izin: o tarihlerde sırada atlanır, sonra geri döner', () => {
  let s = team();
  s = { ...s, people: s.people.map((p) => (p.id === 'ali' ? { ...p, leaves: [{ from: '2026-12-03', to: '2026-12-07' }] } : p)) };
  const ali = s.people.find((p) => p.id === 'ali');
  assert.equal(isAvailable(ali, '2026-12-02'), true);
  assert.equal(isAvailable(ali, '2026-12-03'), false);
  assert.equal(isAvailable(ali, '2026-12-07'), false);
  assert.equal(isAvailable(ali, '2026-12-08'), true);
  assert.equal(nextPerson(s, 'patoloji', 'k5', undefined, '2026-12-05').name, 'Ayşe');
  assert.equal(nextPerson(s, 'patoloji', 'k5', undefined, '2026-12-10').name, 'Ali');
  const dec5 = new Date(2026, 11, 5, 10).getTime();
  assert.equal(assign(s, 'patoloji', 'k5', { now: dec5 }).assignment.personName, 'Ayşe');
  assert.deepEqual(leaveOn(ali, '2026-12-04'), { from: '2026-12-03', to: '2026-12-07' });
  assert.deepEqual(cleanLeaves([{ from: '2026-11-01', to: '2026-11-02' }, { from: '2026-12-10', to: '2026-12-11' }, { from: '2026-12-01', to: '2026-12-03' }], '2026-11-20'),
    [{ from: '2026-12-01', to: '2026-12-03' }, { from: '2026-12-10', to: '2026-12-11' }]);
});

test('teslim tarihi kayda yazılır', () => {
  const r = assign(team(), 'patoloji', 'k5', { dueDate: '2026-11-10' });
  assert.equal(r.assignment.dueDate, '2026-11-10');
  assert.equal(assign(team(), 'patoloji', 'k5').assignment.dueDate, null);
});

import { REACTIONS, setReaction, groupReactions } from '../js/rotation.js';

test('emoji tepkileri: tek tepki, tekrar dokununca kalkar, yazı reddedilir', () => {
  let r = setReaction({}, 'ali', '👍');
  r = setReaction(r, 'ayse', '👍');
  r = setReaction(r, 'can', '🔥');
  assert.deepEqual(groupReactions(r), [{ emoji: '👍', ids: ['ali', 'ayse'] }, { emoji: '🔥', ids: ['can'] }]);
  r = setReaction(r, 'ali', '🙏'); // değiştir
  assert.equal(r.ali, '🙏');
  r = setReaction(r, 'ali', '🙏'); // kaldır
  assert.equal(r.ali, undefined);
  assert.throws(() => setReaction(r, 'ali', 'tamam'), /Yalnızca listedeki emojiler/);
  assert.throws(() => setReaction(r, 'ali', '👍 süper'), /Yalnızca listedeki emojiler/);
  assert.ok(REACTIONS.length >= 8);
});

import { addMonths, dueRecurring, runRecurring, issueDay } from '../js/rotation.js';

test('tekrarlayan görev: 3 ayda bir, sıradakine verilir, tarih ilerler', () => {
  assert.equal(addMonths('2026-11-30', 3), '2027-02-28');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  let s = team();
  s = { ...s, recurring: [{ id: 'r1', typeId: 'kitap', seniorityId: 'k5', every: 3, unit: 'month', nextDate: '2026-12-15', leadDays: 3, note: 'Kütüphane' }] };
  assert.equal(issueDay(s.recurring[0]), '2026-12-12');
  assert.equal(dueRecurring(s, '2026-12-11').length, 0);
  assert.equal(dueRecurring(s, '2026-12-12').length, 1);
  const r = runRecurring(s, 'r1', { id: 'a1', today: '2026-12-12', now: new Date(2026, 11, 12).getTime() });
  assert.equal(r.assignment.personName, 'Ali');
  assert.equal(r.assignment.dueDate, '2026-12-15');
  assert.equal(r.assignment.by, '🔁 Otomatik');
  assert.equal(r.state.recurring[0].nextDate, '2027-03-15');
  // aynı gün ikinci çalıştırma bir şey yapmaz (çift görev olmaz)
  assert.equal(runRecurring(r.state, 'r1', { today: '2026-12-12' }), null);
  // sonraki tur sıradaki kişiye
  const r2 = runRecurring(r.state, 'r1', { id: 'a2', today: '2027-03-12', now: new Date(2027, 2, 12).getTime() });
  assert.equal(r2.assignment.personName, 'Ayşe');
});

test('tekrarlayan görev: uzun süre açılmazsa tek görev verilir, tarih geleceğe atlar', () => {
  let s = { ...team(), recurring: [{ id: 'r1', typeId: 'kitap', seniorityId: 'k5', every: 1, unit: 'month', nextDate: '2026-01-10', leadDays: 0 }] };
  const r = runRecurring(s, 'r1', { id: 'a1', today: '2026-04-20', now: new Date(2026, 3, 20).getTime() });
  assert.equal(r.assignment.dueDate, '2026-04-20');
  assert.equal(r.state.recurring[0].nextDate, '2026-05-10');
});

import { occurrenceKind } from '../js/rotation.js';

test('her ay internetten, her 3. ay yüz yüze (ayrı görev türü ve sıra)', () => {
  let s = team();
  s = { ...s, taskTypes: [...s.taskTypes, { id: 'kitap-yy', name: 'Kitap uzatmak (yüz yüze)' }] };
  s = { ...s, recurring: [{ id: 'r1', typeId: 'kitap', seniorityId: 'k5', every: 1, unit: 'month', nextDate: '2026-12-01', leadDays: 0, note: 'İnternetten', altEvery: 3, altTypeId: 'kitap-yy', altNote: 'Kütüphaneye gidilecek' }] };
  const got = [];
  let today = '2026-12-01';
  for (let i = 0; i < 6; i++) {
    const r = runRecurring(s, 'r1', { id: 'a' + i, today, now: new Date(today + 'T10:00').getTime() });
    s = r.state;
    got.push(`${r.assignment.typeName}|${r.assignment.personName}|${r.assignment.note}`);
    today = s.recurring[0].nextDate;
  }
  assert.deepEqual(got, [
    'Kitap uzatmak|Ali|İnternetten',
    'Kitap uzatmak|Ayşe|İnternetten',
    'Kitap uzatmak (yüz yüze)|Ali|Kütüphaneye gidilecek', // yüz yüze sırası ayrı: baştan Ali
    'Kitap uzatmak|Can|İnternetten',
    'Kitap uzatmak|Ali|İnternetten',
    'Kitap uzatmak (yüz yüze)|Ayşe|Kütüphaneye gidilecek',
  ]);
  assert.equal(occurrenceKind(s.recurring[0]).alt, false); // 7. tekrar internetten
});

test('aynı görev türü ile yalnızca not farklı olabilir', () => {
  const r = { typeId: 'kitap', note: 'İnternet', altEvery: 3, altNote: 'Yüz yüze' };
  assert.deepEqual(occurrenceKind(r, 3), { alt: true, typeId: 'kitap', note: 'Yüz yüze' });
  assert.deepEqual(occurrenceKind(r, 4), { alt: false, typeId: 'kitap', note: 'İnternet' });
  assert.equal(occurrenceKind({ typeId: 'x' }, 3).alt, false);
});

import { addAnnouncement, removeAnnouncement, markAnnouncementsRead, reactAnnouncement, unreadCount, trophies, MAX_ANNOUNCEMENTS } from '../js/rotation.js';

test('duyuru: ekleme, okundu, tepki, sınırlar', () => {
  let s = team();
  s = addAnnouncement(s, { id: 'd1', text: '  Cuma toplantı 13:00  ', by: 'Hüseyin', byId: 'bas', now: 1 });
  assert.equal(s.announcements[0].text, 'Cuma toplantı 13:00');
  assert.equal(unreadCount(s, 'bas'), 0); // yazan okumuş sayılır
  assert.equal(unreadCount(s, 'ali'), 1);
  const r = markAnnouncementsRead(s, 'ali', 5);
  assert.equal(unreadCount(r, 'ali'), 0);
  assert.equal(markAnnouncementsRead(r, 'ali', 6), null); // tekrar yazma yok
  s = reactAnnouncement(r, 'd1', 'ali', '👍');
  assert.equal(s.announcements[0].reactions.ali, '👍');
  assert.throws(() => reactAnnouncement(s, 'd1', 'ali', 'tamam'), /Yalnızca listedeki/);
  assert.throws(() => addAnnouncement(s, { id: 'x', text: '   ', by: 'H', byId: 'bas' }), /boş olamaz/);
  assert.throws(() => addAnnouncement(s, { id: 'x', text: 'a'.repeat(501), by: 'H', byId: 'bas' }), /en fazla/);
  for (let i = 0; i < 25; i++) s = addAnnouncement(s, { id: 'n' + i, text: 'd' + i, by: 'H', byId: 'bas' });
  assert.equal(s.announcements.length, MAX_ANNOUNCEMENTS);
  assert.equal(s.announcements[0].id, 'n24');
  assert.equal(removeAnnouncement(s, 'n24').announcements[0].id, 'n23');
});

test('profil: kupalar', () => {
  let s = team();
  s = { ...s, stats: { '2026-09': { ali: 5, can: 2 }, '2026-10': { can: 4, ali: 4 }, '2026-11': { ayse: 3 } } };
  assert.deepEqual(trophies(s, 'ali'), ['2026-10', '2026-09']);
  assert.deepEqual(trophies(s, 'can'), ['2026-10']);
  assert.deepEqual(trophies(s, 'deniz'), []);
});

import { skipWeekend } from '../js/rotation.js';

test('günlük tekrar: her gün sıradakine, hafta sonu atlanabilir', () => {
  // 2026-11-06 Cuma, 07 Cmt, 08 Paz, 09 Pzt
  assert.equal(skipWeekend('2026-11-07'), '2026-11-09');
  assert.equal(skipWeekend('2026-11-06'), '2026-11-06');
  let s = { ...team(), recurring: [{ id: 'r1', typeId: 'patoloji', seniorityId: 'k5', every: 1, unit: 'day', nextDate: '2026-11-05', leadDays: 0, skipWeekends: true }] };
  const got = [];
  let today = '2026-11-05';
  for (let i = 0; i < 4; i++) {
    const r = runRecurring(s, 'r1', { id: 'a' + i, today, now: new Date(today + 'T09:00').getTime() });
    s = r.state;
    got.push(`${today}|${r.assignment.personName}`);
    today = s.recurring[0].nextDate;
  }
  assert.deepEqual(got, ['2026-11-05|Ali', '2026-11-06|Ayşe', '2026-11-09|Can', '2026-11-10|Ali']);
  // hafta sonu dahil
  let s2 = { ...team(), recurring: [{ id: 'r1', typeId: 'patoloji', seniorityId: 'k5', every: 1, unit: 'day', nextDate: '2026-11-06', leadDays: 0 }] };
  s2 = runRecurring(s2, 'r1', { id: 'b', today: '2026-11-06', now: new Date('2026-11-06T09:00').getTime() }).state;
  assert.equal(s2.recurring[0].nextDate, '2026-11-07');
  // aynı gün ikinci kez verilmez
  assert.equal(runRecurring(s2, 'r1', { today: '2026-11-06' }), null);
});
