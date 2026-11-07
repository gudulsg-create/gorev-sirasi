// Sekmeler arası parmakla sağa/sola kaydırma: saf mantık (DOM yok, test edilebilir).

/** Alt çubuktaki sekme sırası. */
export const TAB_ORDER = ['give', 'mine', 'history', 'team', 'settings'];

const MIN_DX = 60; // en az bu kadar piksel yatay hareket
const LONG_DX = 140; // bu kadar uzun sürükleme yavaş da olsa sayılır
const MAX_DT = 800; // kısa kaydırmalar bu süreden hızlı olmalı (ms)
const RATIO = 2; // yatay hareket dikeyin en az 2 katı olmalı

/**
 * Bir dokunma hareketinin sekme yönü.
 * @returns {1|-1|0} 1 = sonraki sekme (sola kaydırma), -1 = önceki (sağa kaydırma), 0 = sekme değişmez
 */
export function swipeDirection({ dx, dy, dt }) {
  const ax = Math.abs(dx);
  if (ax < MIN_DX || ax < RATIO * Math.abs(dy)) return 0;
  if (dt > MAX_DT && ax < LONG_DX) return 0;
  return dx < 0 ? 1 : -1;
}

/** Sıradaki komşu sekme; uçlarda başa sarmaz (null). */
export function neighborTab(order, current, dir) {
  const i = order.indexOf(current);
  if (i < 0 || !dir) return null;
  return order[i + dir] ?? null;
}
