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
