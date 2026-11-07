import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAB_ORDER, swipeDirection, neighborTab } from '../js/swipe.js';

test('sola hızlı kaydırma bir sonraki sekme (+1), sağa kaydırma önceki (-1)', () => {
  assert.equal(swipeDirection({ dx: -120, dy: 10, dt: 250 }), 1);
  assert.equal(swipeDirection({ dx: 120, dy: -10, dt: 250 }), -1);
});

test('kısa kaydırma sayılmaz', () => {
  assert.equal(swipeDirection({ dx: -30, dy: 0, dt: 150 }), 0);
});

test('dikey kaydırma (sayfayı aşağı kaydırmak) sekme değiştirmez', () => {
  assert.equal(swipeDirection({ dx: -80, dy: 120, dt: 300 }), 0);
  assert.equal(swipeDirection({ dx: -90, dy: 60, dt: 300 }), 0);
});

test('çok yavaş ve kısa sürükleme sayılmaz, yavaş ama uzun sürükleme sayılır', () => {
  assert.equal(swipeDirection({ dx: -80, dy: 5, dt: 1500 }), 0);
  assert.equal(swipeDirection({ dx: -200, dy: 5, dt: 1500 }), 1);
});

test('komşu sekme sırası: Görev ver → Görevlerim → Geçmiş → Ekip', () => {
  assert.deepEqual(TAB_ORDER, ['give', 'mine', 'history', 'team']);
  assert.equal(neighborTab(TAB_ORDER, 'give', 1), 'mine');
  assert.equal(neighborTab(TAB_ORDER, 'team', -1), 'history');
});

test('uçlarda başa sarmaz', () => {
  assert.equal(neighborTab(TAB_ORDER, 'give', -1), null);
  assert.equal(neighborTab(TAB_ORDER, 'team', 1), null);
  assert.equal(neighborTab(TAB_ORDER, 'bilinmeyen', 1), null);
});
