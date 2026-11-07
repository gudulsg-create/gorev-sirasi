import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueInfo, dayGroupLabel, typeIcon } from '../js/format.js';

const T = '2026-11-07';

test('dueInfo: son gün yoksa null', () => {
  assert.equal(dueInfo(null, T, 'aktif'), null);
});

test('dueInfo: açık görevde geçmiş, bugün, yarın, ileri tarih', () => {
  assert.deepEqual(dueInfo('2026-11-06', T, 'aktif'), { text: 'Son gün dündü', tone: 'late' });
  assert.deepEqual(dueInfo('2026-11-04', T, 'aktif'), { text: '3 gün gecikti', tone: 'late' });
  assert.deepEqual(dueInfo('2026-11-07', T, 'aktif'), { text: 'Son gün bugün', tone: 'today' });
  assert.deepEqual(dueInfo('2026-11-08', T, 'aktif'), { text: 'Son gün yarın', tone: 'soon' });
  assert.deepEqual(dueInfo('2026-11-09', T, 'aktif'), { text: 'Son gün 9 Kas', tone: 'normal' });
});

test('dueInfo: ay sonu geçişinde gün farkı doğru', () => {
  assert.deepEqual(dueInfo('2026-10-31', '2026-11-01', 'aktif'), { text: 'Son gün dündü', tone: 'late' });
});

test('dueInfo: bitmiş ya da iptal görevde uyarı rengi yok', () => {
  assert.deepEqual(dueInfo('2026-11-01', T, 'tamamlandı'), { text: 'Son gün 1 Kas', tone: 'normal' });
  assert.deepEqual(dueInfo('2026-11-01', T, 'iptal'), { text: 'Son gün 1 Kas', tone: 'normal' });
});

test('dayGroupLabel: bugün, dün, tarih, başka yıl', () => {
  const now = new Date(2026, 10, 7, 15, 0).getTime();
  assert.equal(dayGroupLabel(new Date(2026, 10, 7, 8, 0).getTime(), now), 'Bugün');
  assert.equal(dayGroupLabel(new Date(2026, 10, 6, 23, 0).getTime(), now), 'Dün');
  assert.equal(dayGroupLabel(new Date(2026, 10, 5, 9, 0).getTime(), now), '5 Kas');
  assert.equal(dayGroupLabel(new Date(2025, 10, 5, 9, 0).getTime(), now), '5 Kas 2025');
});

test('typeIcon: görev adına göre simge', () => {
  assert.equal(typeIcon('Patoloji yazmak'), 'microscope');
  assert.equal(typeIcon('Örneklem yazmak'), 'flask');
  assert.equal(typeIcon('Kitap uzatmak (yüz yüze)'), 'book');
  assert.equal(typeIcon('Konsültasyon'), 'clipboard');
  assert.equal(typeIcon(''), 'clipboard');
});
