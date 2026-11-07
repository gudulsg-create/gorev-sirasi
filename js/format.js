// Ekranda gösterilen kısa metinler: saf fonksiyonlar (DOM yok, test edilebilir).

const parts = (day) => day.split('-').map(Number);
/** "YYYY-MM-DD" → gün sayısı (saat dilimi/yaz saati etkisiz). */
const dayNum = (day) => {
  const [y, m, d] = parts(day);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
const shortFmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });
const longFmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });

/** "2026-11-09" → "9 Kas" */
export function fmtDay(day) {
  const [y, m, d] = parts(day);
  return shortFmt.format(new Date(y, m - 1, d));
}

/**
 * Son gün etiketi ve rengi.
 * @returns {null | { text: string, tone: 'late'|'today'|'soon'|'normal' }}
 */
export function dueInfo(dueDate, today, status) {
  if (!dueDate) return null;
  const plain = { text: `Son gün ${fmtDay(dueDate)}`, tone: 'normal' };
  if (status !== 'aktif') return plain;
  const diff = dayNum(dueDate) - dayNum(today);
  if (diff === -1) return { text: 'Son gün dündü', tone: 'late' };
  if (diff < -1) return { text: `${-diff} gün gecikti`, tone: 'late' };
  if (diff === 0) return { text: 'Son gün bugün', tone: 'today' };
  if (diff === 1) return { text: 'Son gün yarın', tone: 'soon' };
  return plain;
}

/** Geçmiş listesinde gün başlığı: "Bugün", "Dün", "5 Kas", başka yılsa "5 Kas 2025". */
export function dayGroupLabel(ms, nowMs = Date.now()) {
  const a = new Date(ms);
  const b = new Date(nowMs);
  const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((start(b) - start(a)) / 86400000);
  if (diff === 0) return 'Bugün';
  if (diff === 1) return 'Dün';
  return a.getFullYear() === b.getFullYear() ? shortFmt.format(a) : longFmt.format(a);
}

/** Görev türü adına göre simge adı (js/icons.js). */
export function typeIcon(name = '') {
  if (/patoloji/i.test(name)) return 'microscope';
  if (/örneklem|orneklem/i.test(name)) return 'flask';
  if (/kitap/i.test(name)) return 'book';
  return 'clipboard';
}
