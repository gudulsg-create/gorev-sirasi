import * as cfg from './firebase-config.js';
const { firebaseConfig, teamId } = cfg;
const vapidKey = cfg.vapidKey || '';
export const APP_VERSION = '3.0.0';
const notifyUrl = cfg.notifyUrl || '';
import { createBackend } from './backend.js';
import { TAB_ORDER, swipeDirection, neighborTab } from './swipe.js';
import { fmtDay, dueInfo, dayGroupLabel, typeIcon } from './format.js';
import { icon } from './icons.js';
import { assign, cancel, passOn, nextPerson, queueOf, addPerson, movePerson, changeSeniority, promoteAll, defaultState, allowedSeniorities, monthKey, bumpStat, ranking, winners, prevMonth, dayKey, leaveOn, cleanLeaves, REACTIONS, setReaction, groupReactions, dueRecurring, runRecurring, issueDay, occurrenceKind, skipWeekend, addAnnouncement, removeAnnouncement, markAnnouncementsRead, reactAnnouncement, unreadCount, trophies, MAX_ANNOUNCEMENT_LEN } from './rotation.js';

// ---------- Durum ----------
let backend;
let data = null; // { state, assignments }
let tab = 'give';
let prevTab = 'give'; // Ayarlar kapanınca dönülecek sekme
let historyFilter = 'all';
let connText = 'Bağlanıyor…';
// Oturum: bu cihazda giriş yapan kişi ve doğrulanmış PIN özeti.
// Başasistan kişinin PIN'ini değiştirirse özet tutmaz ve oturum kendiliğinden kapanır.
const SESSION_KEY = 'gorev-sirasi:session';
let session = null;
try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { /* yoksay */ }
function saveSession(next) {
  session = next;
  try {
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* yoksay */ }
}
/** En üst kıdem (listede ilk sıradaki, ör. Başasistan) yönetici sayılır. */
const adminSenId = () => S().seniorities[0]?.id;
/** Giriş yapmış ve PIN'i hâlâ geçerli olan kişi. */
function mePerson() {
  if (!data || !session) return null;
  const p = S().people.find((x) => x.id === session.personId);
  return p && p.pinHash && p.pinHash === session.pinHash ? p : null;
}
const isAdmin = () => !!mePerson() && mePerson().seniorityId === adminSenId();
/** Henüz PIN'i olan bir başasistan yoksa ilk kurulum aşamasıdır. */
const setupMode = () => !S().people.some((p) => p.seniorityId === adminSenId() && p.pinHash);
/** Ekip ve ayarları değiştirme yetkisi: başasistan (ya da ekip henüz boşsa herkes). */
const canManage = () => isAdmin() || !S().people.length;
const canPassOn = (a) => isAdmin() || (!!mePerson() && a.byId === mePerson().id);
const canToggleDone = (a) => isAdmin() || (!!mePerson() && (a.byId === mePerson().id || a.personId === mePerson().id));

async function hashPin(personId, pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`gorev-sirasi:${personId}:${pin}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const PIN_RE = /^[0-9]{4,6}$/;
let pinFails = 0;
let pinLockedUntil = 0;

const view = document.getElementById('view');
const dlg = document.getElementById('dlg');
const dlgForm = document.getElementById('dlg-form');
const actDlg = document.getElementById('act-dlg');
const actForm = document.getElementById('act-form');
const navBar = document.getElementById('nav-bar');
const navTitle = document.getElementById('nav-title');
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// ---------- Yardımcılar ----------
/** Güvenli DOM oluşturucu: metinler her zaman metin düğümü olarak eklenir. */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.style.cssText = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const S = () => data.state;
const typeName = (id) => S().taskTypes.find((t) => t.id === id)?.name ?? 'Silinmiş görev türü';
const senName = (id) => S().seniorities.find((s) => s.id === id)?.name ?? '—';
const addDays = (n) => dayKey(Date.now() + n * 86400000);
const fmtTime = (ms) => new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(ms);
const fmtWhen = (ms) => `${dayGroupLabel(ms)} ${fmtTime(ms)}`;
const firstName = (name = '') => name.split(' ')[0];
const personById = (id) => S().people.find((p) => p.id === id);

// ---------- Liste bileşenleri ----------
/**
 * iOS tarzı liste satırı. onclick verilirse satırın tamamı düğmedir;
 * içinde başka düğme (trailing) olacaksa onclick verme.
 */
function cell(o = {}) {
  const tag = o.tag || (o.onclick ? 'button' : 'div');
  const lead = o.icon ? h('span', { class: `cell-icon ${o.tile || ''}` }, icon(o.icon)) : o.lead ?? null;
  return h(tag, {
    class: `cell ${o.icon ? 'has-icon' : ''} ${o.av ? 'has-av' : ''} ${o.cls || ''}`,
    type: tag === 'button' ? 'button' : null,
    onclick: o.onclick,
    disabled: o.disabled,
    'aria-label': o.label,
  },
  o.before ?? null,
  o.av ?? lead,
  h('span', { class: 'cell-body' },
    h('span', { class: `cell-title ${o.titleCls || ''}` }, o.title),
    o.sub != null && o.sub !== '' ? h('span', { class: `cell-sub ${o.subCls || ''}` }, o.sub) : null,
    o.extra ?? null),
  o.detail != null ? h('span', { class: 'cell-detail' }, o.detail) : null,
  o.trailing ?? null,
  o.chev ? icon('chevron', 14, 'chev') : null);
}
/** Grup başlığı + satırlar + dipnot. */
function section(title, rows, { foot, action } = {}) {
  const list = [rows].flat(Infinity).filter(Boolean);
  return [
    title ? h('h2', { class: 'group-title' }, h('span', {}, title), action ?? null) : null,
    list.length ? h('div', { class: 'group' }, list) : null,
    foot ? h('p', { class: 'group-foot' }, foot) : null,
  ];
}
/** Etiketli giriş satırı. */
const fieldCell = (label, el) => h('label', { class: 'cell' }, h('span', { class: 'field-label' }, label), el);
/** iOS anahtarı. */
const toggle = (props) => h('span', { class: 'switch-ios' }, h('input', { type: 'checkbox', role: 'switch', ...props }));
function emptyState(ic, title, text, btn, onclick) {
  return h('div', { class: 'empty-state' },
    h('span', { class: 'big-ico' }, icon(ic, 34)),
    h('h2', {}, title),
    text ? h('p', {}, text) : null,
    btn ? h('button', { class: 'btn-lg primary', onclick }, btn) : null);
}
/** Sayfanın büyük başlığı; sağda profil fotoğrafı (Ayarlar'ı açar). */
function pageHead(title, { eyebrow, right } = {}) {
  navTitle.textContent = title;
  return h('header', { class: 'page-head' },
    h('div', {}, eyebrow ? h('span', { class: 'eyebrow' }, eyebrow) : null, h('h1', { class: 'large-title' }, title)),
    right !== undefined ? right : meButton());
}
function meButton() {
  const mp = mePerson();
  if (mp) return h('button', { class: 'avatar-btn', 'aria-label': 'Ayarlar ve hesabım', onclick: openSettings }, avatar(mp, 36));
  if (data && !S().people.length) return h('button', { class: 'text-btn', onclick: openSettings }, 'Ayarlar');
  return null;
}
function dueEl(a) {
  const d = dueInfo(a.dueDate, dayKey(), a.status);
  return d ? h('span', { class: `cell-sub tone-${d.tone}` }, d.text) : null;
}

// ---------- Profil fotoğrafı ----------
const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const COLORS = ['#2c6aa3', '#c9372c', '#2a9d6f', '#d98a1c', '#7b5ea7', '#c2185b', '#3d7a3d', '#8d6e63'];
function colorFor(id = '') {
  let n = 0;
  for (const ch of id) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[n % COLORS.length];
}
function initialsOf(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toLocaleUpperCase('tr')).join('');
}
/** Kişinin fotoğrafı (yoksa baş harfleri). p yoksa id/name ile de çalışır. */
function avatar(p, size = 32, extraClass = '') {
  const person = typeof p === 'string' ? data && S().people.find((x) => x.id === p) : p;
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px`;
  if (person?.photo && PHOTO_RE.test(person.photo)) {
    return h('img', { class: `av ${extraClass}`, src: person.photo, alt: '', style, loading: 'lazy' });
  }
  return h('span', { class: `av av-init ${extraClass}`, style: `${style};background:${colorFor(person?.id)}`, 'aria-hidden': 'true' }, initialsOf(person?.name || '?'));
}
/** Seçilen resmi ortadan kare kırpıp küçültür; ~5 KB'lık JPEG veri adresi döndürür. */
async function makePhoto(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Lütfen bir resim dosyası seçin.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Resim açılamadı. JPEG veya PNG deneyin.'));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 160;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 160, 160);
    for (const q of [0.8, 0.65, 0.5, 0.4]) {
      const out = canvas.toDataURL('image/jpeg', q);
      if (out.length < 24000) return out;
    }
    return canvas.toDataURL('image/jpeg', 0.3);
  } finally {
    URL.revokeObjectURL(url);
  }
}
const canEditPhoto = (personId) => isAdmin() || mePerson()?.id === personId;
/** Fotoğraf seçici + önizleme; değişince hemen kaydeder. */
function photoPicker(p) {
  const preview = h('span', {}, avatar(p, 88));
  const savePhoto = async (photo) => {
    if (!canEditPhoto(p.id)) return toast('Bu kişinin fotoğrafını değiştiremezsin.');
    const r = await run((st) => ({ state: { ...st, people: st.people.map((x) => (x.id === p.id ? { ...x, photo } : x)) } }));
    if (!r) return;
    preview.replaceChildren(avatar({ ...p, photo }, 88));
    removeBtn.hidden = !photo;
    pickLabel.firstChild.textContent = photo ? 'Fotoğrafı değiştir' : 'Fotoğraf ekle';
    toast(photo ? 'Fotoğraf kaydedildi' : 'Fotoğraf kaldırıldı');
  };
  const input = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try { await savePhoto(await makePhoto(file)); } catch (err) { toast(err.message); }
  } });
  const removeBtn = h('button', { type: 'button', class: 'text-btn danger', hidden: !p.photo, onclick: () => savePhoto(null) }, 'Kaldır');
  const pickLabel = h('label', { class: 'text-btn' }, p.photo ? 'Fotoğrafı değiştir' : 'Fotoğraf ekle', input);
  return h('div', { class: 'photo-edit' }, preview, h('div', { class: 'row' }, pickLabel, removeBtn));
}

// ---------- Bildirim balonu, onay, eylem sayfası ----------
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

const DANGER_WORDS = ['Sil', 'İptal et', 'Çıkar', 'Çıkış yap', 'Geçir', 'Yükle'];
function askConfirm(message, yesText = 'Evet') {
  const d = document.getElementById('confirm-dlg');
  document.getElementById('confirm-msg').textContent = message;
  const yes = document.getElementById('confirm-yes');
  yes.textContent = yesText;
  yes.classList.toggle('danger', DANGER_WORDS.includes(yesText));
  d.returnValue = '';
  d.showModal();
  return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue === 'yes'), { once: true }));
}

/** Kapanış animasyonunu oynatıp pencereyi kapatır. */
function animateClose(d, ms) {
  if (!d.open) return Promise.resolve();
  if (d._closing) return d._closing;
  d.classList.add('closing');
  d._closing = new Promise((res) => {
    d._closeTimer = setTimeout(() => {
      d.classList.remove('closing');
      d.style.transform = '';
      d.style.transition = '';
      d._closing = null;
      d.close();
      res();
    }, reducedMotion() ? 0 : ms);
  });
  return d._closing;
}
function cancelClose(d) {
  clearTimeout(d._closeTimer);
  d._closing = null;
  d.classList.remove('closing');
  d.style.transform = '';
  d.style.transition = '';
}
const closeDlg = () => animateClose(dlg, 260);
const closeAct = () => animateClose(actDlg, 240);
for (const d of [dlg, actDlg]) {
  d.addEventListener('cancel', (e) => { e.preventDefault(); animateClose(d, 250); });
  d.addEventListener('click', (e) => { if (e.target === d) animateClose(d, 250); });
}

/**
 * iOS eylem sayfası: başlık, (isteğe bağlı) emoji sırası, seçenekler ve ayrı "Vazgeç".
 * items: { label, danger?, onSelect }
 */
function actionSheet(title, items, { emojis = null } = {}) {
  cancelClose(actDlg);
  actForm.replaceChildren(
    h('div', { class: 'as-group' },
      title ? h('div', { class: 'as-title' }, title) : null,
      emojis,
      items.filter(Boolean).map((it) => h('button', { type: 'button', class: `as-btn ${it.danger ? 'danger' : ''}`, onclick: async () => { await closeAct(); it.onSelect(); } }, it.label))),
    h('div', { class: 'as-group' }, h('button', { type: 'button', class: 'as-btn cancel', onclick: closeAct }, 'Vazgeç')),
  );
  if (!actDlg.open) actDlg.showModal();
}

/** Bir işlemi çalıştırır; hata olursa kullanıcıya gösterir. */
async function run(fn, opts) {
  try {
    return await backend.transact(fn, opts);
  } catch (err) {
    toast(err.message || 'İşlem yapılamadı.');
    return null;
  }
}
/** Yalnızca ekip ayarlarını değiştiren basit işlem. */
const update = (mutator, msg) => {
  if (!canManage()) {
    toast('Bu değişikliği yalnızca başasistan yapabilir.');
    return Promise.resolve(null);
  }
  return run((s) => ({ state: mutator(s) })).then((r) => {
    if (r && msg) toast(msg);
    return r;
  });
};

// ---------- Alttan açılan sayfa ----------
/**
 * Sayfayı açar (zaten açıksa içeriğini değiştirir).
 * Üstte: solda vazgeç, ortada başlık, sağda kaydet. extra: alttaki büyük düğmeler.
 */
function openDialog(title, body, { onSubmit, submitText = 'Kaydet', extra = [], cancelText = 'Vazgeç', kind = '' } = {}) {
  cancelClose(dlg);
  dlgForm.dataset.kind = kind;
  const extras = [extra].flat().filter(Boolean);
  dlgForm.replaceChildren(
    h('div', { class: 'grabber', 'aria-hidden': 'true' }),
    h('div', { class: 'sheet-head' },
      h('span', { class: 'left' }, cancelText ? h('button', { type: 'button', class: 'text-btn', onclick: closeDlg }, cancelText) : null),
      title ? h('h2', {}, title) : h('span'),
      h('span', { class: 'right' }, onSubmit ? h('button', { type: 'submit', class: 'text-btn bold' }, submitText) : null),
    ),
    h('div', { class: 'sheet-body' }, body, extras.length ? h('div', { class: 'btn-stack' }, extras) : null),
  );
  dlgForm.onsubmit = async (e) => {
    e.preventDefault();
    if (!onSubmit || !dlgForm.reportValidity()) return;
    if ((await onSubmit(new FormData(dlgForm))) !== false) closeDlg();
  };
  if (!dlg.open) dlg.showModal();
}
/** Alttaki büyük düğme. */
const bigBtn = (label, onclick, cls = '') => h('button', { type: 'button', class: `btn-lg ${cls}`, onclick }, label);

// Tutamaktan ya da üst kısımdan aşağı çekince sayfa kapanır.
(function sheetDrag() {
  let start = null;
  dlg.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.grabber, .sheet-head') || e.target.closest('button, input, select')) return;
    start = { y: e.clientY, t: Date.now(), dy: 0 };
    dlg.style.transition = 'none';
    dlg.setPointerCapture?.(e.pointerId);
  });
  dlg.addEventListener('pointermove', (e) => {
    if (!start) return;
    start.dy = Math.max(0, e.clientY - start.y);
    dlg.style.transform = `translateY(${start.dy}px)`;
  });
  const end = () => {
    if (!start) return;
    const { dy, t } = start;
    start = null;
    const fast = dy / Math.max(1, Date.now() - t) > 0.6;
    if (dy > 110 || (fast && dy > 30)) {
      dlg.style.transition = 'transform 0.22s cubic-bezier(0.4, 0, 1, 1)';
      dlg.style.transform = 'translateY(100%)';
      setTimeout(() => { dlg.style.transform = ''; dlg.style.transition = ''; if (dlg.open) dlg.close(); }, 220);
    } else {
      dlg.style.transition = 'transform 0.35s cubic-bezier(0.23, 1, 0.32, 1)';
      dlg.style.transform = '';
    }
  };
  dlg.addEventListener('pointerup', end);
  dlg.addEventListener('pointercancel', end);
})();

// ---------- Görünümler ----------
function render() {
  document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  if (!data) return;
  const mp = mePerson();
  const locked = S().people.length && !mp;
  document.querySelector('.tabs').hidden = !!locked;
  const openMine = data.assignments.filter((a) => a.status === 'aktif' && a.personId === mp?.id).length;
  const badge = document.getElementById('mine-count');
  badge.hidden = !openMine;
  badge.textContent = String(openMine);
  const views = { give: giveView, mine: mineView, history: historyView, team: teamView, settings: settingsView };
  const out = locked ? loginView() : (views[tab] || giveView)();
  view.replaceChildren(...[out].flat(Infinity).filter(Boolean));
  onScroll();
}
function onScroll() { navBar.classList.toggle('scrolled', window.scrollY > 56); }
window.addEventListener('scroll', onScroll, { passive: true });

// --- Görev ver ---
function giveView() {
  const s = S();
  const eyebrow = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  if (!s.people.length) {
    return [pageHead('Görev ver', { eyebrow }), emptyState('users', 'Ekibi kur', 'Önce ekibe asistanları ve kıdemlerini ekle.', 'Ekibe git', () => switchTab('team'))];
  }
  const recent = data.assignments.filter((a) => a.status !== 'iptal').slice(0, 5);
  return [
    pageHead('Görev ver', { eyebrow }),
    installHint(),
    section(null, s.taskTypes.map((t) => cell({ icon: typeIcon(t.name), title: t.name, chev: true, onclick: () => chooseSeniority(t) })),
      { foot: s.taskTypes.length ? null : 'Ayarlar → Görev türleri bölümünden görev türü ekle.' }),
    announcementCell(),
    monthCell(),
    upcomingRecurring(),
    recent.length ? section('Son verilenler', recent.map((a) => taskRow(a, { mode: 'compact' }))) : null,
  ];
}

// --- Ana ekrana ekle ipucu ---
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; render(); });
window.addEventListener('appinstalled', () => { deferredInstall = null; render(); });
function installHint() {
  let dismissed = false;
  try { dismissed = localStorage.getItem('gorev-sirasi:install-hint') === 'kapali'; } catch { /* yoksay */ }
  if (isStandalone() || dismissed) return null;
  const close = h('button', { type: 'button', class: 'text-btn', style: 'color:var(--text-3);padding:4px', 'aria-label': 'İpucunu kapat', onclick: () => {
    try { localStorage.setItem('gorev-sirasi:install-hint', 'kapali'); } catch { /* yoksay */ }
    render();
  } }, icon('cancel', 22));
  const sub = deferredInstall ? 'Tek dokunuşla ana ekrana ekle.'
    : isIOS() ? `Safari'de Paylaş → Ana Ekrana Ekle.${pushConfigured() ? ' Bildirimler için gerekli.' : ''}`
    : 'Tarayıcı menüsünden (⋮) Ana ekrana ekle.';
  return section(null, cell({
    icon: 'phone', tile: 'gray', title: 'Uygulama gibi kullan', sub, subCls: 'wrap',
    trailing: h('span', { style: 'display:flex;gap:4px;align-items:center' },
      deferredInstall ? h('button', { type: 'button', class: 'pill-btn', onclick: async () => { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; render(); } }, 'Ekle') : null,
      close),
  }));
}

// --- Ayın elemanı ---
const monthLabel = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(new Date(y, mo - 1, 1));
};
/** Geçen ayın kazananları (ekipte olmayanlar dahil isimleri kayıtlardan bulunur). */
function lastMonthWinnerIds() {
  return winners(S(), prevMonth(monthKey(Date.now()))).map((w) => w.personId);
}
function monthCell() {
  const s = S();
  const cur = monthKey(Date.now());
  const prev = prevMonth(cur);
  const won = winners(s, prev);
  const top = ranking(s, cur).slice(0, 3);
  const nameOf = (id) => personById(id)?.name ?? 'Eski ekip üyesi';
  let row;
  if (won.length) {
    row = cell({
      av: avatar(personById(won[0].personId) || { id: won[0].personId, name: '?' }, 40),
      title: won.map((w) => nameOf(w.personId)).join(', '),
      sub: `${monthLabel(prev)} · ${won[0].count} görev`,
      chev: true, onclick: () => openLeaderboard(prev),
    });
  } else if (top.length) {
    row = cell({
      icon: 'trophy', tile: 'gold', title: `${monthLabel(cur)} yarışı`,
      sub: top.map((x) => `${firstName(nameOf(x.personId))} ${x.count}`).join(' · '),
      chev: true, onclick: () => openLeaderboard(cur),
    });
  } else {
    row = cell({ icon: 'trophy', tile: 'gold', title: 'Henüz tamamlanan yok', sub: 'Ay boyunca tamamlanan görevler sayılır.', subCls: 'wrap', onclick: () => openLeaderboard(cur), chev: true });
  }
  return section('Ayın elemanı', row);
}

function openLeaderboard(month) {
  const s = S();
  const months = Object.keys(s.stats || {}).filter((m) => ranking(s, m).length);
  const cur = monthKey(Date.now());
  if (!months.includes(cur)) months.push(cur);
  months.sort().reverse();
  const listWrap = h('div');
  const select = h('select', { 'aria-label': 'Ay', onchange: () => fill(select.value) },
    months.map((m) => h('option', { value: m, selected: m === month }, monthLabel(m) + (m === cur ? ' (bu ay)' : ''))));
  function fill(m) {
    const r = ranking(s, m);
    const topCount = r[0]?.count;
    listWrap.replaceChildren(...section('Sıralama', r.length ? r.map((x, i) => {
      const p = personById(x.personId);
      return cell({
        before: h('span', { style: 'width:22px;text-align:center;font-weight:600;color:var(--text-2)' }, x.count === topCount ? icon('trophy', 20) : String(i + 1)),
        av: avatar(p || { id: x.personId, name: '?' }, 36),
        title: p?.name ?? 'Eski ekip üyesi', sub: p ? senName(p.seniorityId) : null,
        detail: String(x.count),
        onclick: p ? () => openProfile(p.id) : null,
      });
    }) : h('div', { class: 'inline-empty' }, 'Bu ay henüz tamamlanan görev yok.')).flat().filter(Boolean));
  }
  fill(month);
  openDialog('Ayın elemanı', [
    section(null, fieldCell('Ay', select)),
    listWrap,
    h('p', { class: 'group-foot' }, 'Tamamlanan görevler, görevin verildiği aya sayılır. Eşitlikte birden fazla kişi ayın elemanı olur.'),
  ], { cancelText: 'Kapat' });
}

// --- Tekrarlayan görevler ---
const freqLabel = (r) => (r.unit === 'day' ? (r.every === 1 ? 'her gün' : `${r.every} günde bir`) : `${r.every} ${r.unit === 'week' ? 'haftada' : 'ayda'} bir`) + (r.skipWeekends ? ' (hafta sonu hariç)' : '');
const recurLabel = (r) => freqLabel(r) + (r.altEvery > 1 ? ` · her ${r.altEvery}. seferde: ${typeName(r.altTypeId || r.typeId)}${r.altNote ? ' (' + r.altNote + ')' : ''}` : '');
function upcomingRecurring() {
  const s = S();
  const list = (s.recurring || []).filter((r) => r.active !== false).sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  if (!list.length) return null;
  return section('Otomatik görevler', list.map((r) => {
    const kind = occurrenceKind(r);
    const n = nextPerson(s, kind.typeId, r.seniorityId);
    const day = r.skipWeekends ? skipWeekend(issueDay(r)) : issueDay(r);
    return cell({
      icon: 'repeat', tile: kind.alt ? 'orange' : 'gray',
      title: `${typeName(kind.typeId)} · ${senName(r.seniorityId)}`,
      sub: `${fmtDay(day)} verilecek · son gün ${fmtDay(r.nextDate)}${kind.note ? ' · ' + kind.note : ''}`,
      detail: n ? firstName(n.name) : 'Müsait yok',
    });
  }));
}

let recurRunning = false;
/** Zamanı gelen tekrarlayan görevleri verir. Giriş yapmış herhangi bir kullanıcının cihazı tetikleyebilir; işlem çift görev oluşturmaz. */
async function checkRecurring() {
  if (recurRunning || !data || !mePerson()) return;
  const due = dueRecurring(S());
  if (!due.length) return;
  recurRunning = true;
  try {
    for (const r of due) {
      try {
        const out = await backend.transact((state) => {
          const res = runRecurring(state, r.id, { id: uid() });
          return res ? { state: res.state, add: res.assignment } : {};
        });
        if (out?.add) {
          toast(`Otomatik görev: ${out.add.typeName} → ${out.add.personName}`);
          notify('assignment', out.add.id);
        }
      } catch (err) {
        if (isAdmin()) toast(`Otomatik görev verilemedi (${typeName(r.typeId)}): ${err.message}`);
      }
    }
  } finally {
    recurRunning = false;
  }
}

/** "Her N. seferde farklı görev" bölümü (ör. her 3. ay yüz yüze). */
function altBox(r) {
  const s = S();
  const on = h('input', { type: 'checkbox', role: 'switch', name: 'altOn', checked: r.altEvery > 1, onchange: () => { inner.forEach((el) => { el.hidden = !on.checked; }); } });
  const typeSel = h('select', { name: 'altTypeId' },
    h('option', { value: '' }, 'Aynı görev'),
    s.taskTypes.map((t) => h('option', { value: t.id, selected: t.id === r.altTypeId }, t.name)));
  const makeType = cell({ title: 'Ayrı “yüz yüze” görev türü oluştur', cls: 'accent', onclick: async () => {
    const base = typeName(dlgForm.querySelector('select[name=typeId]')?.value) || 'Görev';
    const name = `${base} (yüz yüze)`;
    const existing = S().taskTypes.find((t) => t.name === name);
    const id = existing?.id || uid();
    if (!existing) await update((st) => ({ ...st, taskTypes: [...st.taskTypes, { id, name }] }), `"${name}" görev türü eklendi`);
    if (![...typeSel.options].some((o) => o.value === id)) typeSel.append(h('option', { value: id }, name));
    typeSel.value = id;
  } });
  const hidden = !(r.altEvery > 1);
  const inner = [
    fieldCell('Her kaçıncı', h('input', { name: 'altEvery', type: 'number', min: '2', max: '12', value: String(r.altEvery > 1 ? r.altEvery : 3), style: 'text-align:right' })),
    fieldCell('Görev', typeSel),
    makeType,
    fieldCell('Not', h('input', { name: 'altNote', maxlength: '80', value: r.altNote || '', placeholder: 'Yüz yüze: kütüphaneye gidilecek' })),
  ];
  inner.forEach((el) => { el.hidden = hidden; });
  return section('Dönüşümlü görev', [h('label', { class: 'cell' }, h('span', { class: 'cell-body' }, h('span', { class: 'cell-title wrap' }, 'Belirli aralıklarla farklı görev ver')), h('span', { class: 'switch-ios' }, on)), inner],
    { foot: 'Ör. her 3. ay yüz yüze. Ayrı görev türü seçilirse onun sırası da ayrı döner; kütüphaneye gitme işi de adil dağılır.' });
}

function editRecurring(r) {
  const s = S();
  const isNew = !r;
  const kitap = s.taskTypes.find((t) => /kitap/i.test(t.name) && !/yüz/i.test(t.name));
  const yuzyuze = s.taskTypes.find((t) => /yüz yüze/i.test(t.name));
  r = r ?? { typeId: kitap?.id ?? s.taskTypes[0]?.id, seniorityId: s.seniorities[s.seniorities.length - 1]?.id, every: 1, unit: 'month', nextDate: '', leadDays: 3, note: 'İnternetten uzatma', active: true,
    altEvery: 3, altTypeId: yuzyuze?.id || '', altNote: 'Yüz yüze: kütüphaneye gidilecek', skipWeekends: true };
  const sel = (name, items, val) => h('select', { name }, items.map((x) => h('option', { value: x.id, selected: x.id === val }, x.name)));
  const num = (name, min, max, val) => h('input', { name, type: 'number', min, max, required: true, value: String(val), style: 'text-align:right' });
  const body = [
    section(null, [fieldCell('Görev', sel('typeId', s.taskTypes, r.typeId)), fieldCell('Kıdem', sel('seniorityId', s.seniorities, r.seniorityId))],
      { foot: 'Görev bu kıdemde sırası gelen kişiye verilir.' }),
    section('Sıklık', [
      fieldCell('Her', num('every', '1', '24', r.every)),
      fieldCell('Birim', h('select', { name: 'unit', onchange: (e) => { const lead = dlgForm.querySelector('input[name=leadDays]'); if (e.target.value === 'day' && lead && Number(lead.value) > 0) lead.value = '0'; } },
        h('option', { value: 'day', selected: r.unit === 'day' }, 'günde bir'),
        h('option', { value: 'week', selected: r.unit === 'week' }, 'haftada bir'),
        h('option', { value: 'month', selected: !r.unit || r.unit === 'month' }, 'ayda bir'))),
      h('label', { class: 'cell' }, h('span', { class: 'cell-body' }, h('span', { class: 'cell-title' }, 'Hafta sonları verme')), toggle({ name: 'skipWeekends', checked: !!r.skipWeekends })),
    ]),
    section('Tarih', [
      fieldCell('Son gün', h('input', { name: 'nextDate', type: 'date', required: true, value: r.nextDate })),
      fieldCell('Kaç gün önce', num('leadDays', '0', '60', r.leadDays)),
    ], { foot: 'Son gün ör. kütüphaneye gidilmesi gereken gün. Günlük görevlerde 0 (o gün verilir) önerilir.' }),
    section(null, fieldCell('Not', h('input', { name: 'note', maxlength: '80', value: r.note || '', placeholder: 'İnternetten uzatma' }))),
    altBox(r),
    !isNew ? section(null, h('label', { class: 'cell' }, h('span', { class: 'cell-body' }, h('span', { class: 'cell-title' }, 'Etkin')), toggle({ name: 'active', checked: r.active !== false }))) : null,
  ];
  openDialog(isNew ? 'Yeni otomatik görev' : 'Otomatik görev', body, {
    extra: !isNew ? [bigBtn('Sil', async () => {
      if (!(await askConfirm('Bu tekrarlayan görev silinsin mi? Daha önce verilen görevler kalır.', 'Sil'))) return;
      await update((st) => ({ ...st, recurring: (st.recurring || []).filter((x) => x.id !== r.id) }), 'Silindi');
      openRecurringList();
    }, 'danger')] : [],
    onSubmit: async (fd) => {
      const altOn = fd.get('altOn') === 'on';
      const item = {
        altEvery: altOn ? Math.max(2, Math.min(12, Number(fd.get('altEvery')) || 3)) : 0,
        altTypeId: altOn ? (fd.get('altTypeId') || '') : '',
        altNote: altOn ? (fd.get('altNote') || '').trim() : '',
        seq: r.seq || 0,
        id: r.id || uid(),
        typeId: fd.get('typeId'),
        seniorityId: fd.get('seniorityId'),
        every: Math.max(1, Math.min(24, Number(fd.get('every')) || 1)),
        unit: ['day', 'week'].includes(fd.get('unit')) ? fd.get('unit') : 'month',
        skipWeekends: fd.get('skipWeekends') === 'on',
        nextDate: fd.get('skipWeekends') === 'on' ? skipWeekend(fd.get('nextDate')) : fd.get('nextDate'),
        leadDays: Math.max(0, Math.min(60, Number(fd.get('leadDays')) || 0)),
        note: (fd.get('note') || '').trim(),
        active: isNew ? true : fd.get('active') === 'on',
        lastRun: r.lastRun || null,
      };
      await update((st) => ({ ...st, recurring: isNew ? [...(st.recurring || []), item] : (st.recurring || []).map((x) => (x.id === item.id ? item : x)) }), 'Kaydedildi');
      setTimeout(checkRecurring, 300);
      openRecurringList();
      return false;
    },
  });
}

function openRecurringList() {
  const list = S().recurring || [];
  openDialog('Otomatik görevler', [
    section(null, [
      list.map((r) => cell({
        icon: 'repeat', tile: r.active === false ? 'gray' : '',
        title: `${typeName(r.typeId)} · ${senName(r.seniorityId)}`,
        sub: r.active === false ? 'Kapalı' : `${recurLabel(r)} · sıradaki ${fmtDay(r.nextDate)}`,
        chev: true, onclick: () => editRecurring(r),
      })),
      cell({ icon: 'plus', title: 'Otomatik görev ekle', cls: 'accent', onclick: () => editRecurring() }),
    ], { foot: 'Belirli aralıklarla yapılan işler (ör. 3 ayda bir kitap uzatma). Tarih yaklaşınca görev sıradaki kişiye kendiliğinden verilir.' }),
  ], { cancelText: 'Bitti' });
}

// --- Görev verme sayfası ---
function chooseSeniority(type) {
  const s = S();
  let due = null;
  const dueLabel = () => (due === null ? 'Yok' : due === dayKey() ? 'Bugün' : due === addDays(1) ? 'Yarın' : fmtDay(due));
  const dueDetail = h('span', {}, dueLabel());
  const dateInput = h('input', { type: 'date', class: 'chip', min: dayKey(), 'aria-label': 'Tarih seç', onchange: () => setDue(dateInput.value || null) });
  const quick = [['Yok', null], ['Bugün', 0], ['Yarın', 1], ['3 gün', 3], ['1 hafta', 7]];
  const chipBtns = quick.map(([label, n]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(n === null), onclick: () => setDue(n === null ? null : addDays(n)) }, label));
  const chips = h('div', { class: 'chips', hidden: true }, chipBtns, dateInput);
  function setDue(v) {
    due = v;
    dueDetail.textContent = dueLabel();
    chipBtns.forEach((b, i) => b.setAttribute('aria-pressed', String((quick[i][1] === null ? null : addDays(quick[i][1])) === due)));
  }
  const note = h('input', { name: 'note', maxlength: '120', placeholder: 'İsteğe bağlı', autocomplete: 'off' });
  const allowed = allowedSeniorities(s, mePerson()?.id);
  const rows = s.seniorities.filter((x) => allowed.includes(x.id)).map((x) => {
    const next = nextPerson(s, type.id, x.id);
    return cell({
      av: next ? avatar(next, 38) : h('span', { class: 'cell-icon gray' }, icon('user')),
      cls: next ? '' : 'dim',
      title: next ? next.name : x.name,
      sub: next ? x.name : 'Müsait kimse yok',
      trailing: next ? h('button', { type: 'button', class: 'pill-btn', onclick: () => give(type, x, note.value.trim(), due) }, 'Ver') : null,
    });
  });
  openDialog(type.name, [
    rows.length ? section('Kime verilsin?', rows) : section(null, h('div', { class: 'inline-empty' }, 'Senin altında görev verebileceğin bir kıdem yok.')),
    section('Seçenekler', [
      h('div', {},
        cell({ icon: 'calendar', tile: 'red', title: 'Son gün', detail: dueDetail, chev: true, onclick: () => { chips.hidden = !chips.hidden; } }),
        chips),
      h('label', { class: 'cell has-icon' }, h('span', { class: 'cell-icon gray' }, icon('note')), h('span', { class: 'field-label' }, 'Not'), note),
    ], { foot: 'Nota hasta adı, TC no gibi kişisel sağlık verisi yazma; not kilit ekranında görünebilir.' }),
  ], { cancelText: 'Vazgeç' });
}

async function give(type, sen, note, dueDate = null) {
  const mp = mePerson();
  if (!mp) {
    await closeDlg();
    return openLogin();
  }
  if (!allowedSeniorities(S(), mp.id).includes(sen.id)) return toast('Yalnızca alt kıdemlere görev verebilirsin.');
  const r = await run((state) => {
    const out = assign(state, type.id, sen.id, { id: uid(), by: mp.name, byId: mp.id, note, dueDate });
    return { state: out.state, add: out.assignment };
  });
  if (!r) return;
  navigator.vibrate?.(12);
  notify('assignment', r.add.id);
  showResult(r.add);
}

function showResult(a) {
  const d = dueInfo(a.dueDate, dayKey(), a.status);
  const body = h('div', { class: 'result' },
    h('div', { class: 'result-photo' }, avatar(a.personId, 104), h('span', { class: 'result-check' }, icon('check', 18))),
    h('p', { class: 'result-name' }, a.personName),
    h('p', { class: 'result-sub' }, `${a.typeName} · ${a.seniorityName}`),
    d ? h('p', { class: `result-due tone-${d.tone}` }, d.text) : null,
    a.skipped?.length ? h('p', { class: 'result-sub small' }, `${a.skipped.map((x) => x.personName).join(', ')} yerine aktarıldı`) : null,
  );
  openDialog(null, body, {
    cancelText: null,
    extra: [
      bigBtn('Tamam', closeDlg, 'primary'),
      canPassOn(a) && bigBtn('Sonrakine aktar', () => doPassOn(a, true)),
      isAdmin() && bigBtn('Geri al', () => doCancel(a, true), 'danger'),
    ],
  });
}

async function doCancel(a, fromResult = false) {
  if (!isAdmin()) return toast('Görevleri yalnızca başasistan iptal edebilir.');
  if (!fromResult && !(await askConfirm(`${a.typeName} → ${a.personName} görevi iptal edilsin mi?`, 'İptal et'))) return;
  const r = await run((state, cur) => {
    if (!cur) throw new Error('Kayıt bulunamadı.');
    const out = cancel(state, cur);
    const next = cur.status === 'tamamlandı' ? bumpStat(out.state, monthKey(cur.createdAt), cur.personId, -1) : out.state;
    return { state: next, patch: out.patch, restored: out.restored };
  }, { assignmentId: a.id });
  if (!r) return;
  if (dlg.open) closeDlg();
  toast(r.restored ? `İptal edildi. Sıra yine ${a.personName}'da.` : 'İptal edildi');
}

async function doPassOn(a, fromResult = false) {
  if (!canPassOn(a)) return toast('Görevi yalnızca veren kişi ya da başasistan aktarabilir.');
  if (!fromResult && !(await askConfirm(`${a.personName} müsait değil mi? Görev sıradaki kişiye aktarılsın.`, 'Aktar'))) return;
  const r = await run((state, cur) => {
    if (!cur) throw new Error('Kayıt bulunamadı.');
    const out = passOn(state, cur);
    return { state: out.state, patch: out.patch, updated: { ...cur, ...out.patch } };
  }, { assignmentId: a.id });
  if (!r) return;
  notify('assignment', a.id);
  if (fromResult) showResult(r.updated);
  else toast(`Görev ${r.updated.personName} kişisine aktarıldı`);
}

async function toggleDone(a) {
  if (!canToggleDone(a)) return toast('Bunu yalnızca görevi alan, veren ya da başasistan değiştirebilir.');
  const r = await run((state, cur) => {
    if (!cur) throw new Error('Kayıt bulunamadı.');
    if (cur.status === 'iptal') throw new Error('İptal edilmiş görev değiştirilemez.');
    const done = cur.status !== 'tamamlandı';
    // Ayın elemanı sayacı: görevin verildiği aya, görevi alan kişiye yazılır.
    const next = bumpStat(state, monthKey(cur.createdAt), cur.personId, done ? 1 : -1);
    return { state: next, patch: { status: done ? 'tamamlandı' : 'aktif', completedAt: done ? Date.now() : null }, done };
  }, { assignmentId: a.id });
  if (r) toast(r.done ? 'Tamamlandı' : 'Yeniden açıldı');
}

// --- Bildirimler ---
const DEVICE_KEY = 'gorev-sirasi:device';
function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) { id = 'c' + Math.random().toString(36).slice(2, 10); localStorage.setItem(DEVICE_KEY, id); }
    return id;
  } catch { return 'c-gecici'; }
}
const pushConfigured = () => !!(backend && backend.kind === 'firebase' && vapidKey && notifyUrl);
const pushCapable = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
/** 'yok' (kurulmamış), 'ana-ekran' (iPhone'da önce ana ekrana eklenmeli), 'desteklenmiyor', 'engelli', 'acik', 'kapali' */
function pushState() {
  if (!pushConfigured()) return 'yok';
  if (isIOS() && !isStandalone()) return 'ana-ekran';
  if (!pushCapable()) return 'desteklenmiyor';
  if (Notification.permission === 'denied') return 'engelli';
  const me = mePerson();
  return Notification.permission === 'granted' && me?.push?.[deviceId()] ? 'acik' : 'kapali';
}
async function swReady() {
  const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }));
  await navigator.serviceWorker.ready;
  return reg;
}
async function savePushToken(token) {
  const me = mePerson();
  if (!me) return null;
  const dev = deviceId();
  return run((st) => ({ state: { ...st, people: st.people.map((x) => (x.id === me.id ? { ...x, push: { ...(x.push || {}), [dev]: token } } : x)) } }));
}
async function removePushToken(personId) {
  const dev = deviceId();
  return run((st) => ({ state: { ...st, people: st.people.map((x) => {
    if (x.id !== personId || !x.push?.[dev]) return x;
    const push = { ...x.push };
    delete push[dev];
    return { ...x, push };
  }) } }));
}
async function enablePush() {
  const state = pushState();
  if (state === 'ana-ekran') return toast('iPhone\'da bildirim için önce uygulamayı ana ekrana ekleyip oradan aç.');
  if (state === 'desteklenmiyor') return toast('Bu tarayıcı bildirimleri desteklemiyor.');
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Bildirim izni verilmedi. Telefon ayarlarından izin verebilirsin.'); refreshOpenDialogs(); return; }
    const token = await backend.getPushToken(await swReady(), vapidKey);
    if (!token) throw new Error('Bildirim anahtarı alınamadı.');
    if (await savePushToken(token)) toast('Bildirimler açıldı');
  } catch (err) {
    toast('Bildirim açılamadı: ' + (err.message || err));
  }
  refreshOpenDialogs();
}
async function disablePush() {
  const me = mePerson();
  if (!me) return;
  await removePushToken(me.id);
  await backend.deletePushToken();
  toast('Bildirimler bu cihazda kapatıldı');
  refreshOpenDialogs();
}
/** Uygulama açıldığında anahtarı tazele (değiştiyse kaydet). */
let pushRefreshed = false;
async function refreshPushToken() {
  if (pushRefreshed || !pushConfigured() || !pushCapable() || Notification.permission !== 'granted' || !mePerson()) return;
  if (isIOS() && !isStandalone()) return;
  pushRefreshed = true;
  try {
    const token = await backend.getPushToken(await swReady(), vapidKey);
    if (token && mePerson()?.push?.[deviceId()] !== token) await savePushToken(token);
  } catch { /* sessizce geç */ }
}
/** Sunucuya "bu kayıt için bildirim gönder" der. Sunucu kaydı kendisi doğrular. */
function notify(kind, id) {
  if (!notifyUrl || !id) return;
  fetch(notifyUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ team: teamId, kind, id }), keepalive: true }).catch(() => {});
}
/** Ayarlar'daki bildirim anahtarı. */
function notifSection() {
  const st = pushState();
  if (st === 'yok') return null;
  const msg = {
    'ana-ekran': 'iPhone\'da bildirim almak için uygulamayı ana ekrana ekleyip simgeden açman gerekiyor.',
    desteklenmiyor: 'Bu tarayıcı bildirimleri desteklemiyor.',
    engelli: 'Bildirimler bu cihazda engellenmiş. Telefonun Ayarlar → Bildirimler bölümünden Görev Sırası\'na izin ver.',
    acik: 'Sana görev verildiğinde ve yeni duyuru geldiğinde bu cihaza bildirim gelir.',
    kapali: 'Sana görev verildiğinde ve yeni duyuru geldiğinde telefonuna bildirim gelsin.',
  }[st];
  const usable = st === 'acik' || st === 'kapali';
  return section('Bildirimler', h('label', { class: 'cell has-icon' },
    h('span', { class: 'cell-icon red' }, icon('bell')),
    h('span', { class: 'cell-body' }, h('span', { class: 'cell-title' }, 'Bildirimler')),
    toggle({ checked: st === 'acik', disabled: !usable, onchange: (e) => (e.target.checked ? enablePush() : disablePush()) }),
  ), { foot: msg });
}
function refreshOpenDialogs() {
  render();
  if (dlg.open && dlgForm.dataset.kind === 'account') openAccount();
}

// --- Duyuru panosu ---
let annOpen = false;
let annNamesFor = null; // okuyan listesi açık duyuru
function announcementCell() {
  const s = S();
  const me = mePerson();
  const list = s.announcements || [];
  if (!list.length) {
    return me ? section('Duyuru', cell({ icon: 'megaphone', tile: 'orange', title: 'Duyuru yaz', cls: 'accent', chev: true, onclick: openAnnouncements })) : null;
  }
  const a = list[0];
  const unread = unreadCount(s, me?.id);
  return section('Duyuru', cell({
    icon: 'megaphone', tile: 'orange',
    title: a.text, sub: `${a.by} · ${fmtWhen(a.createdAt)}`,
    trailing: unread ? h('span', { class: 'unread-dot', 'aria-label': `${unread} okunmamış` }) : null,
    chev: true, onclick: openAnnouncements,
  }), { action: list.length > 1 ? h('button', { class: 'text-btn', onclick: openAnnouncements }, `Tümü (${list.length})`) : null });
}

function openAnnouncements() {
  annOpen = true;
  annNamesFor = null;
  renderAnnouncements();
  const me = mePerson();
  if (me && unreadCount(S(), me.id)) {
    run((st) => {
      const next = markAnnouncementsRead(st, me.id);
      return next ? { state: next } : {};
    });
  }
  dlg.addEventListener('close', () => { annOpen = false; }, { once: true });
}

function renderAnnouncements() {
  const s = S();
  const me = mePerson();
  const prevText = dlgForm.querySelector('textarea[name=ann]')?.value || '';
  const total = s.people.length;
  const nameOf = (id) => personById(id)?.name ?? 'Eski ekip üyesi';
  const items = (s.announcements || []).map((a) => {
    const readIds = Object.keys(a.readBy || {}).filter((id) => personById(id));
    const showNames = annNamesFor === a.id;
    const unreadPeople = s.people.filter((p) => !a.readBy?.[p.id]);
    const canDelete = isAdmin() || (me && a.byId === me.id);
    return h('div', { class: 'group', style: 'margin-top:12px' },
      h('div', { class: 'cell' }, h('span', { class: 'cell-body' },
        h('span', { class: 'cell-title wrap', style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, a.text),
        h('span', { class: 'cell-sub' }, `${a.by} · ${fmtWhen(a.createdAt)}`),
        h('span', { class: 'reacts' },
          groupReactions(a.reactions).map((g) => h('button', { type: 'button', class: `react-chip ${me && g.ids.includes(me.id) ? 'mine' : ''}`, title: g.ids.map(nameOf).join(', '), onclick: () => reactAnn(a, g.emoji) },
            h('span', { class: 'e' }, g.emoji), String(g.ids.length))),
          me ? h('button', { type: 'button', class: 'react-chip', 'aria-label': 'Tepki ver', onclick: () => actionSheet('Tepki ver', [], { emojis: emojiRow((e) => reactAnn(a, e), a.reactions?.[me.id]) }) }, icon('smile', 16)) : null,
          h('button', { type: 'button', class: 'react-chip', onclick: () => { annNamesFor = showNames ? null : a.id; renderAnnouncements(); } }, `Okuyan ${readIds.length}/${total}`),
        ),
        showNames ? h('span', { class: 'cell-sub wrap', style: 'margin-top:6px' }, `Okudu: ${readIds.map(nameOf).join(', ') || '—'}`) : null,
        showNames ? h('span', { class: 'cell-sub wrap' }, `Henüz okumadı: ${unreadPeople.map((p) => p.name).join(', ') || '—'}`) : null,
      )),
      canDelete ? cell({ title: 'Duyuruyu sil', cls: 'danger', onclick: async () => {
        if (!(await askConfirm('Bu duyuru silinsin mi?', 'Sil'))) return;
        const r = await run((st) => {
          const cur = (st.announcements || []).find((x) => x.id === a.id);
          const meNow = mePerson();
          if (cur && !(isAdmin() || cur.byId === meNow?.id)) throw new Error('Yalnızca kendi duyurunu silebilirsin.');
          return { state: removeAnnouncement(st, a.id) };
        });
        if (r) { toast('Duyuru silindi'); renderAnnouncements(); }
      } }) : null,
    );
  });
  const composer = me ? section('Yeni duyuru', [
    h('div', { class: 'cell' }, h('textarea', { name: 'ann', rows: '3', maxlength: String(MAX_ANNOUNCEMENT_LEN), placeholder: 'Ekibe duyuru yaz' })),
    h('div', { class: 'cell', style: 'justify-content:flex-end' }, h('button', { type: 'button', class: 'pill-btn', onclick: postAnnouncement }, 'Yayınla')),
  ], { foot: 'Hasta bilgisi yazma. Herkes duyuru yazabilir; kendi duyurunu silebilirsin, başasistan tüm duyuruları silebilir.' }) : null;
  openDialog('Duyurular', [
    composer,
    items.length ? [h('h2', { class: 'group-title' }, 'Duyurular'), items] : h('p', { class: 'group-foot', style: 'text-align:center;margin-top:24px' }, 'Henüz duyuru yok.'),
  ], { cancelText: 'Kapat', kind: 'ann' });
  const ta = dlgForm.querySelector('textarea[name=ann]');
  if (ta && prevText) ta.value = prevText;
}

async function postAnnouncement() {
  const me = mePerson();
  const ta = dlgForm.querySelector('textarea[name=ann]');
  const text = ta?.value.trim();
  if (!text) return toast('Duyuru boş olamaz.');
  if (!me) return openLogin();
  const annId = uid();
  const r = await run((st) => ({ state: addAnnouncement(st, { id: annId, text, by: me.name, byId: me.id }) }));
  if (r) notify('announcement', annId);
  if (!r) return;
  // Gönderim sırasında ekran yenilenmiş olabilir; güncel kutuyu temizle.
  const fresh = dlgForm.querySelector('textarea[name=ann]');
  if (fresh) fresh.value = '';
  toast('Duyuru yayınlandı');
  renderAnnouncements();
}

async function reactAnn(a, emoji) {
  const me = mePerson();
  if (!me) return;
  await run((st) => ({ state: reactAnnouncement(st, a.id, me.id, emoji) }));
  if (annOpen && dlg.open) renderAnnouncements();
}

// --- Kişisel profil kartı ---
function openProfile(personId) {
  const s = S();
  const p = personById(personId);
  if (!p) return;
  const month = monthKey(Date.now());
  const mine = data.assignments.filter((a) => a.personId === p.id && a.status !== 'iptal');
  const thisMonth = mine.filter((a) => monthKey(a.createdAt) === month);
  const doneMonth = (s.stats?.[month] || {})[p.id] || 0;
  const done = mine.filter((a) => a.status === 'tamamlandı').length;
  const open = mine.filter((a) => a.status === 'aktif');
  const late = open.filter((a) => a.dueDate && a.dueDate < dayKey()).length;
  const given = data.assignments.filter((a) => a.byId === p.id && a.status !== 'iptal' && monthKey(a.createdAt) === month).length;
  const cups = trophies(s, p.id);
  const rate = mine.length ? Math.round((done / mine.length) * 100) : null;
  const now = leaveOn(p);
  const nextLeave = cleanLeaves(p.leaves || []).find((l) => l.from > dayKey());
  const stat = (v, l, cls = '') => h('div', { class: `stat ${cls}` }, h('strong', {}, String(v)), h('span', {}, l));
  const leaveText = now ? `İzinde · ${fmtDay(now.to)}'e kadar` : p.active === false ? 'İzinli' : nextLeave ? `Planlı izin: ${fmtDay(nextLeave.from)} – ${fmtDay(nextLeave.to)}` : null;
  openDialog(null, [
    h('div', { class: 'profile-hero' },
      avatar(p, 96),
      h('h3', {}, p.name),
      h('span', { class: 'muted' }, senName(p.seniorityId)),
      cups.length ? h('span', { class: 'cups', title: cups.map(monthLabel).join(', ') }, icon('trophy', 18), `${cups.length} kez ayın elemanı`) : null,
      leaveText ? h('span', { class: 'muted small' }, leaveText) : null,
    ),
    h('h2', { class: 'group-title' }, 'Bu ay'),
    h('div', { class: 'stats' },
      stat(thisMonth.length, 'aldığı'),
      stat(doneMonth, 'tamamladığı'),
      stat(given, 'verdiği'),
      stat(open.length, 'açık görev', open.length ? 'warn' : ''),
      stat(late, 'geciken', late ? 'bad' : ''),
      stat(rate === null ? '—' : `%${rate}`, 'tamamlama'),
    ),
    mine.length ? section('Son görevleri', mine.slice(0, 5).map((a) => taskRow(a, { mode: 'compact', noTap: true }))) : null,
  ], {
    cancelText: 'Kapat',
    extra: [
      isAdmin() && bigBtn('Düzenle', () => editPerson(p)),
      mePerson()?.id === p.id && bigBtn('Hesabım', openAccount),
    ],
  });
}

// --- Görev satırları ---
async function react(a, emoji) {
  const me = mePerson();
  if (!me) return openLogin();
  await run((state, cur) => {
    if (!cur) throw new Error('Kayıt bulunamadı.');
    if (cur.status === 'iptal') throw new Error('İptal edilmiş göreve tepki verilemez.');
    return { patch: { reactions: setReaction(cur.reactions, me.id, emoji) } };
  }, { assignmentId: a.id });
}
function emojiRow(onPick, mine) {
  return h('div', { class: 'as-emojis' }, REACTIONS.map((e) => h('button', { type: 'button', class: mine === e ? 'mine' : '', 'aria-label': `${e} tepkisi`, onclick: async () => { await closeAct(); onPick(e); } }, e)));
}
function reactChips(a) {
  if (a.status === 'iptal') return null;
  const groups = groupReactions(a.reactions);
  if (!groups.length) return null;
  const me = mePerson();
  const nameOf = (id) => personById(id)?.name ?? 'Eski ekip üyesi';
  return h('span', { class: 'reacts' }, groups.map((g) => h('button', {
    type: 'button',
    class: `react-chip ${me && g.ids.includes(me.id) ? 'mine' : ''}`,
    title: g.ids.map(nameOf).join(', '),
    'aria-label': `${g.emoji} ${g.ids.length}: ${g.ids.map(nameOf).join(', ')}`,
    onclick: () => react(a, g.emoji),
  }, h('span', { class: 'e' }, g.emoji), g.ids.map((id) => firstName(nameOf(id))).slice(0, 2).join(', ') + (g.ids.length > 2 ? ` +${g.ids.length - 2}` : ''))));
}
/** Görevin ⋯ menüsü. */
function taskActions(a) {
  const me = mePerson();
  const open = a.status !== 'iptal';
  actionSheet(`${a.typeName} · ${a.personName}`, [
    open && canToggleDone(a) && { label: a.status === 'tamamlandı' ? 'Yeniden aç' : 'Tamamlandı olarak işaretle', onSelect: () => toggleDone(a) },
    a.status === 'aktif' && canPassOn(a) && { label: 'Sonrakine aktar', onSelect: () => doPassOn(a) },
    { label: 'Profili gör', onSelect: () => openProfile(a.personId) },
    open && isAdmin() && { label: 'Görevi iptal et', danger: true, onSelect: () => doCancel(a) },
  ], { emojis: open && me ? emojiRow((e) => react(a, e), a.reactions?.[me.id]) : null });
}
/** Tamamlama yuvarlağı: önce animasyon, sonra kayıt. */
const toggling = new Set();
function checkBtn(a) {
  const on = a.status === 'tamamlandı';
  const btn = h('button', {
    type: 'button', class: `check ${on ? 'on' : ''}`,
    'aria-label': on ? 'Yeniden aç' : 'Tamamlandı olarak işaretle', 'aria-pressed': String(on),
    onclick: () => {
      if (toggling.has(a.id)) return;
      toggling.add(a.id);
      btn.classList.add('anim');
      btn.classList.toggle('on');
      navigator.vibrate?.(8);
      if (!on) btn.closest('.cell')?.classList.add('leaving');
      setTimeout(async () => { await toggleDone(a); toggling.delete(a.id); render(); }, reducedMotion() ? 0 : 480);
    },
  }, icon('check', 15));
  return btn;
}
/**
 * mode: 'mine' (bana verilen), 'given' (verdiğim), 'history', 'compact' (özet; satır dokununca menü).
 */
function taskRow(a, { mode = 'history', noTap = false } = {}) {
  const cancelled = a.status === 'iptal';
  const done = a.status === 'tamamlandı';
  // Geçmiş zaten gün gün gruplu: orada yalnızca saat yazılır.
  const when = mode === 'history' ? fmtTime(a.createdAt) : fmtWhen(a.createdAt);
  const who = mode === 'mine' ? `${a.by || 'Bilinmiyor'} verdi · ${when}` : `${a.typeName} · ${when}`;
  const title = mode === 'mine' ? a.typeName : a.personName;
  const skipped = a.skipped?.length ? h('span', { class: 'cell-sub' }, `${a.skipped.map((x) => x.personName).join(', ')} yerine aktarıldı`) : null;
  const extra = [
    !done && !cancelled ? dueEl(a) : null,
    mode !== 'compact' ? skipped : null,
    a.note && mode !== 'compact' ? h('span', { class: 'note-text' }, a.note) : null,
    mode !== 'compact' ? reactChips(a) : null,
  ];
  const status = cancelled ? h('span', { class: 'status-tag' }, 'İptal')
    : done && (mode === 'compact' || !canToggleDone(a)) ? h('span', { class: 'status-tag done', 'aria-label': 'Tamamlandı' }, icon('check', 18)) : null;
  if (mode === 'compact') {
    return cell({
      av: avatar(a.personId, 36), title, sub: who,
      extra, trailing: status,
      titleCls: cancelled ? 'done-title' : '',
      onclick: noTap ? null : () => taskActions(a),
    });
  }
  const showCheck = !cancelled && canToggleDone(a);
  return cell({
    before: showCheck ? checkBtn(a) : null,
    av: mode === 'mine' ? h('span', { class: 'cell-icon' }, icon(typeIcon(a.typeName))) : avatar(a.personId, 34),
    title, sub: who,
    titleCls: cancelled || (done && mode === 'mine') ? 'done-title' : '',
    extra, cls: showCheck ? 'has-check' : '',
    trailing: h('span', { style: 'display:flex;align-items:center;gap:6px' }, status,
      h('button', { type: 'button', class: 'text-btn', 'aria-label': 'Diğer işlemler', style: 'padding:6px;color:var(--text-2)', onclick: () => taskActions(a) }, icon('more', 22))),
  });
}

// --- Görevlerim ---
function mineView() {
  const me = mePerson();
  if (!me) return [pageHead('Görevlerim'), emptyState('users', 'Henüz ekip yok', 'Önce Ekip sekmesinden asistanları ekle; sonra herkes kendi görevlerini burada görür.', 'Ekibe git', () => switchTab('team'))];
  const byDue = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.createdAt - b.createdAt;
  const open = data.assignments.filter((a) => a.status === 'aktif' && a.personId === me.id).sort(byDue);
  const done = data.assignments.filter((a) => a.status === 'tamamlandı' && a.personId === me.id).slice(0, 10);
  const given = data.assignments.filter((a) => a.status === 'aktif' && a.byId === me.id).sort(byDue);
  return [
    pageHead('Görevlerim'),
    open.length
      ? section(`Açık · ${open.length}`, open.map((a) => taskRow(a, { mode: 'mine' })), { foot: 'Bitirdiğin görevin yuvarlağına dokun; ayın elemanı sayımına eklenir.' })
      : [h('h2', { class: 'group-title' }, 'Açık'), h('div', { class: 'group' }, h('div', { class: 'inline-empty' }, 'Açık görevin yok. Keyfini çıkar.'))],
    given.length ? section(`Verdiklerim · ${given.length}`, given.map((a) => taskRow(a, { mode: 'given' }))) : null,
    done.length ? section('Tamamlanan', done.map((a) => taskRow(a, { mode: 'mine' }))) : null,
  ];
}

// --- Geçmiş ---
function historyView() {
  const s = S();
  const filters = [{ id: 'all', name: 'Tümü' }, ...s.taskTypes.map((t) => ({ id: t.id, name: firstName(t.name) }))];
  if (!filters.some((f) => f.id === historyFilter)) historyFilter = 'all';
  const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Görev türü' },
    filters.map((t) => h('button', { type: 'button', 'aria-pressed': String(historyFilter === t.id), onclick: () => { historyFilter = t.id; render(); } }, t.name)));
  const list = data.assignments.filter((a) => historyFilter === 'all' || a.typeId === historyFilter);
  const days = [];
  for (const a of list) {
    const label = dayGroupLabel(a.createdAt);
    if (days.at(-1)?.label !== label) days.push({ label, items: [] });
    days.at(-1).items.push(a);
  }
  return [
    pageHead('Geçmiş'),
    seg,
    days.length ? days.map((d) => section(d.label, d.items.map((a) => taskRow(a, { mode: 'history' }))))
      : emptyState('clock', 'Henüz görev yok', 'Verilen görevler burada gün gün listelenir.'),
  ];
}

// --- Ekip ---
function countsFor(personId) {
  const c = {};
  for (const a of data.assignments) if (a.personId === personId && a.status !== 'iptal') c[a.typeId] = (c[a.typeId] || 0) + 1;
  return c;
}
function teamView() {
  const s = S();
  const manage = canManage();
  if (!s.people.length) {
    return [pageHead('Ekip'), emptyState('userPlus', 'Ekibi kur', 'Asistanları kıdemleriyle ekle. Sonra başasistan giriş yapıp herkese PIN verir.', manage ? 'Asistan ekle' : null, addPersonSheet)];
  }
  return [
    pageHead('Ekip'),
    s.seniorities.map((x) => {
      const q = queueOf(s, x.id);
      if (!q.length && !manage) return null;
      return section(x.name, q.length ? q.map((p) => personCell(p, manage)) : h('div', { class: 'inline-empty' }, 'Bu kıdemde kimse yok.'),
        { action: q.length ? h('span', { class: 'small' }, String(q.length)) : null });
    }),
    manage ? section(null, cell({ icon: 'userPlus', title: 'Asistan ekle', cls: 'accent', onclick: addPersonSheet })) : null,
    h('p', { class: 'group-foot' }, manage
      ? 'Sıra yukarıdan aşağıya ilerler. Bir kişiyi düzenlemek, sırasını değiştirmek ya da izinli yapmak için üstüne dokun.'
      : 'Sıra yukarıdan aşağıya ilerler. Ekibi yalnızca başasistan düzenleyebilir.'),
  ];
}
function personCell(p, manage) {
  const c = countsFor(p.id);
  const summary = S().taskTypes.map((t) => (c[t.id] ? `${firstName(t.name)} ${c[t.id]}` : null)).filter(Boolean).join(' · ');
  const now = leaveOn(p);
  const next = cleanLeaves(p.leaves || []).find((l) => l.from > dayKey());
  const sub = now ? `İzinde · ${fmtDay(now.to)}'e kadar` : next ? `Planlı izin: ${fmtDay(next.from)} – ${fmtDay(next.to)}` : summary || 'Henüz görev yok';
  const won = lastMonthWinnerIds().includes(p.id);
  return cell({
    av: avatar(p, 40),
    title: h('span', { style: 'display:inline-flex;align-items:center;gap:6px' }, p.name, won ? h('span', { style: 'color:var(--gold);display:inline-flex', title: 'Geçen ayın elemanı' }, icon('trophy', 16)) : null),
    sub, subCls: now ? 'today' : '',
    cls: p.active === false ? 'dim' : '',
    detail: p.active === false ? 'İzinli' : manage && !p.pinHash ? 'PIN yok' : null,
    chev: true,
    onclick: () => (manage ? editPerson(p) : openProfile(p.id)),
  });
}

function addPersonSheet() {
  const s = S();
  const lastSen = s.seniorities[s.seniorities.length - 1]?.id;
  openDialog('Asistan ekle', section(null, [
    fieldCell('Ad soyad', h('input', { name: 'pname', required: true, maxlength: '60', placeholder: 'Ad Soyad', autocomplete: 'off' })),
    fieldCell('Kıdem', h('select', { name: 'psen' }, s.seniorities.map((x) => h('option', { value: x.id, selected: x.id === lastSen }, x.name)))),
  ], { foot: 'Yeni kişi seçtiğin kıdemin sırasının sonuna eklenir.' }), {
    submitText: 'Ekle',
    onSubmit: async (fd) => {
      const n = fd.get('pname').trim();
      if (!n) return false;
      await update((st) => addPerson(st, { id: uid(), name: n, seniorityId: fd.get('psen') }), `${n} eklendi`);
    },
  });
}

/** Tarihli izin için otomatik duyuru metni. */
function leaveAnnouncementText(name, l) {
  const when = l.from === l.to ? `${fmtDay(l.from)} tarihinde` : `${fmtDay(l.from)} – ${fmtDay(l.to)} tarihleri arasında`;
  return `🌴 ${name}, ${when} izinli. ${l.from === l.to ? 'O gün' : 'Bu günlerde'} görev sıralarında atlanacak.`;
}

/** Başasistan: kişinin tarihli izinleri. Değişiklik hemen kaydedilir. */
function leaveEditor(p) {
  const list = h('div');
  const draw = (leaves) => {
    list.replaceChildren(...(leaves.length ? leaves.map((l, i) => cell({
      icon: 'umbrella', tile: 'green', title: l.from === l.to ? fmtDay(l.from) : `${fmtDay(l.from)} – ${fmtDay(l.to)}`,
      trailing: h('button', { type: 'button', class: 'text-btn danger', 'aria-label': 'İzni sil', onclick: () => save(leaves.filter((_, j) => j !== i)) }, icon('trash', 20)),
    })) : [h('div', { class: 'inline-empty' }, 'Planlı izin yok.')]));
  };
  /** İzinleri kaydeder. Yeni izin eklendiyse aynı işlemde sistem duyurusu da yayınlar. */
  const save = async (leaves, added = null) => {
    const clean = cleanLeaves(leaves);
    const annId = added ? uid() : null;
    const r = await update((st) => {
      let next = { ...st, people: st.people.map((x) => (x.id === p.id ? { ...x, leaves: clean } : x)) };
      if (added) next = addAnnouncement(next, { id: annId, text: leaveAnnouncementText(p.name, added), by: '🤖 Sistem', byId: 'sistem' });
      return next;
    }, added ? 'İzin kaydedildi ve duyuruldu' : 'İzinler kaydedildi');
    if (added && r) notify('announcement', annId);
    draw(clean);
  };
  const from = h('input', { type: 'date', min: dayKey(), 'aria-label': 'İzin başlangıcı' });
  const to = h('input', { type: 'date', min: dayKey(), 'aria-label': 'İzin bitişi' });
  draw(cleanLeaves(p.leaves || []));
  return section('Tarihli izin', [
    list,
    fieldCell('Başlangıç', from),
    fieldCell('Bitiş', to),
    cell({ icon: 'plus', title: 'İzni ekle', cls: 'accent', onclick: () => {
      if (!from.value || !to.value) return toast('Başlangıç ve bitiş tarihini seç.');
      if (to.value < from.value) return toast('Bitiş, başlangıçtan önce olamaz.');
      const current = S().people.find((x) => x.id === p.id)?.leaves || [];
      const added = { from: from.value, to: to.value };
      save([...current, added], added);
      from.value = ''; to.value = '';
    } }),
  ], { foot: 'Kişi bu tarihlerde bütün sıralarda otomatik atlanır, izin bitince kendiliğinden sıraya döner.' });
}

function editPerson(p0) {
  const s = S();
  const p = personById(p0.id) || p0;
  const q = queueOf(s, p.seniorityId);
  const i = q.findIndex((x) => x.id === p.id);
  const move = async (dir) => { await update((st) => movePerson(st, p.id, dir)); editPerson(p); };
  openDialog('Asistan', [
    photoPicker(p),
    section(null, [
      fieldCell('Ad soyad', h('input', { name: 'name', required: true, maxlength: '60', value: p.name })),
      fieldCell('Kıdem', h('select', { name: 'sen' }, s.seniorities.map((x) => h('option', { value: x.id, selected: x.id === p.seniorityId }, x.name)))),
    ], { foot: 'Kıdemi değişen kişi yeni kıdeminin sırasının sonuna eklenir.' }),
    section('Sıra', [
      cell({ icon: 'up', tile: 'gray', title: 'Sırada yukarı al', disabled: i <= 0, cls: i <= 0 ? 'dim' : '', onclick: () => move(-1) }),
      cell({ icon: 'down', tile: 'gray', title: 'Sırada aşağı al', disabled: i === q.length - 1, cls: i === q.length - 1 ? 'dim' : '', onclick: () => move(1) }),
    ], { foot: `${senName(p.seniorityId)} sırasında ${i + 1}. sırada (${q.length} kişi).` }),
    section('Müsaitlik', h('label', { class: 'cell has-icon' },
      h('span', { class: 'cell-icon orange' }, icon('umbrella')),
      h('span', { class: 'cell-body' }, h('span', { class: 'cell-title' }, 'İzinli')),
      toggle({ checked: p.active === false, onchange: (e) => {
        const away = e.target.checked;
        update((st) => ({ ...st, people: st.people.map((x) => (x.id === p.id ? { ...x, active: !away } : x)) }), away ? `${p.name} izinli: sırada atlanacak` : `${p.name} yeniden sırada`);
      } })), { foot: 'İzinli kişi, anahtar kapatılana kadar tüm sıralarda atlanır.' }),
    leaveEditor(p),
    section('Güvenlik', cell({ icon: 'key', tile: 'gray', title: p.pinHash ? 'Yeni PIN ata' : 'PIN ata', detail: p.pinHash ? 'Var' : 'Yok', chev: true, onclick: () => setPinFor(p) })),
    section(null, [
      cell({ title: 'Profili gör', cls: 'accent', onclick: () => openProfile(p.id) }),
      cell({ title: 'Ekipten çıkar', cls: 'danger', onclick: async () => {
        if (!(await askConfirm(`${p.name} ekipten çıkarılsın mı? Geçmiş kayıtları silinmez.`, 'Çıkar'))) return;
        await update((st) => ({ ...st, people: st.people.filter((x) => x.id !== p.id) }), `${p.name} çıkarıldı`);
        closeDlg();
      } }),
    ]),
  ], {
    onSubmit: async (fd) => {
      const name = fd.get('name').trim();
      const senId = fd.get('sen');
      await update((st) => changeSeniority({ ...st, people: st.people.map((x) => (x.id === p.id ? { ...x, name } : x)) }, p.id, senId), 'Kaydedildi');
    },
  });
}

// --- Ayarlar ---
function openSettings() {
  if (tab !== 'settings') prevTab = tab;
  switchTab('settings');
}
/** Ad listesi düzenleme sayfası (görev türleri, kıdemler). */
function editListSheet(title, getItems, { onRename, onDelete, onAdd, addPlaceholder, foot }) {
  const reopen = () => editListSheet(title, getItems, { onRename, onDelete, onAdd, addPlaceholder, foot });
  const input = h('input', { placeholder: addPlaceholder, maxlength: '50', 'aria-label': 'Yeni ad' });
  openDialog(title, [
    section(null, getItems().map((it) => h('div', { class: 'cell' },
      h('input', { value: it.name, maxlength: '50', 'aria-label': 'Ad', onchange: async (e) => { const v = e.target.value.trim(); if (v) await onRename(it, v); } }),
      h('button', { type: 'button', class: 'text-btn danger', 'aria-label': `${it.name} sil`, onclick: async () => { await onDelete(it); reopen(); } }, icon('trash', 20)),
    )), { foot }),
    section('Yeni ekle', h('div', { class: 'cell' }, input, h('button', { type: 'button', class: 'pill-btn', onclick: async () => { const v = input.value.trim(); if (!v) return; await onAdd(v); reopen(); } }, 'Ekle'))),
  ], { cancelText: 'Bitti' });
}

const THEMES = [
  { id: 'sl', name: 'Sarı-Lacivert', swatch: 'linear-gradient(135deg,#0b2357 50%,#ffd100 50%)' },
  { id: 'kb', name: 'Kırmızı-Beyaz', swatch: 'linear-gradient(135deg,#c8102e 50%,#ffffff 50%)' },
  { id: 'klasik', name: 'Klasik mavi', swatch: 'linear-gradient(135deg,#0a6ed1 50%,#5ac8fa 50%)' },
];
function currentTheme() { return document.documentElement.dataset.theme || 'sl'; }
function setTheme(id) {
  document.documentElement.dataset.theme = id;
  try { localStorage.setItem('gorev-sirasi:theme', id); } catch { /* yoksay */ }
  render();
}

function settingsView() {
  const s = S();
  const mp = mePerson();
  const manage = canManage();
  return [
    pageHead('Ayarlar', { right: h('button', { class: 'text-btn bold', onclick: () => switchTab(prevTab === 'settings' ? 'give' : prevTab) }, 'Bitti') }),
    mp ? section(null, cell({ av: avatar(mp, 58), title: h('span', { style: 'font-size:20px;font-weight:600' }, mp.name), sub: `${senName(mp.seniorityId)} · Hesap, fotoğraf ve PIN`, chev: true, onclick: openAccount })) : null,
    mp ? notifSection() : null,
    section('Görünüm', THEMES.map((t) => cell({
      lead: h('span', { class: 'cell-icon', style: `background:${t.swatch};box-shadow:inset 0 0 0 0.5px rgb(0 0 0 / 0.12)` }),
      cls: 'has-icon', title: t.name,
      trailing: currentTheme() === t.id ? icon('check', 20, 'check-mark') : null,
      onclick: () => setTheme(t.id),
    })), { foot: 'Tema yalnızca bu cihazda geçerlidir. Koyu görünüm telefonun ayarını izler.' }),
    manage ? section('Yönetim', [
      cell({ icon: 'layers', title: 'Görev türleri', detail: String(s.taskTypes.length), chev: true, onclick: openTypesSheet }),
      cell({ icon: 'users', title: 'Kıdemler', detail: String(s.seniorities.length), chev: true, onclick: openSenSheet }),
      cell({ icon: 'repeat', title: 'Otomatik görevler', detail: String((s.recurring || []).length), chev: true, onclick: openRecurringList }),
      cell({ icon: 'promote', tile: 'orange', title: 'Yeni dönem', chev: true, onclick: async () => {
        if (!(await askConfirm('Herkes bir üst kıdeme geçirilsin mi? Başasistan kıdemindekiler ekipten çıkarılacak ve tüm sıralar baştan başlayacak.', 'Geçir'))) return;
        update(promoteAll, 'Kıdemler güncellendi');
      } }),
    ], { foot: 'Yeni dönem herkesi bir üst kıdeme geçirir (ör. 5. kıdem → 4. kıdem). Yeni gelenleri sonra eklersin.' }) : null,
    manage ? section('Yedek', [
      cell({ icon: 'download', tile: 'gray', title: 'Dışa aktar (JSON)', onclick: exportJson }),
      h('label', { class: 'cell has-icon tap' }, h('span', { class: 'cell-icon gray' }, icon('upload')), h('span', { class: 'cell-body' }, h('span', { class: 'cell-title' }, 'İçe aktar')),
        h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: importJson })),
    ]) : null,
    section('Hakkında', [
      cell({ icon: 'info', tile: 'gray', title: 'Sürüm', detail: APP_VERSION }),
      cell({ icon: 'link', tile: 'gray', title: 'Bağlantı', detail: connText }),
    ], { foot: manage ? null : 'Görev türleri, kıdemler ve ekip ayarlarını yalnızca başasistan değiştirebilir.' }),
    mp ? section(null, cell({ title: 'Çıkış yap', cls: 'danger center', onclick: logout })) : null,
  ];
}
function openTypesSheet() {
  editListSheet('Görev türleri', () => S().taskTypes, {
    addPlaceholder: 'Konsültasyon',
    foot: 'Adı değiştirmek için üstüne dokun. Silinen türün geçmiş kayıtları kalır.',
    onRename: (t, name) => update((st) => ({ ...st, taskTypes: st.taskTypes.map((x) => (x.id === t.id ? { ...x, name } : x)) }), 'Kaydedildi'),
    onDelete: async (t) => {
      if (!(await askConfirm(`"${t.name}" görev türü silinsin mi? Geçmiş kayıtlar kalır.`, 'Sil'))) return;
      await update((st) => ({ ...st, taskTypes: st.taskTypes.filter((x) => x.id !== t.id) }), 'Silindi');
    },
    onAdd: (name) => update((st) => ({ ...st, taskTypes: [...st.taskTypes, { id: uid(), name }] }), `${name} eklendi`),
  });
}
function openSenSheet() {
  editListSheet('Kıdemler', () => S().seniorities, {
    addPlaceholder: '6. kıdem',
    foot: 'En kıdemliden en yeniye sıralı. İlk sıradaki kıdem (başasistan) yöneticidir.',
    onRename: (x, name) => update((st) => ({ ...st, seniorities: st.seniorities.map((y) => (y.id === x.id ? { ...y, name } : y)) }), 'Kaydedildi'),
    onDelete: async (x) => {
      if (queueOf(S(), x.id).length) return toast('Bu kıdemde kişiler var; önce onları taşı.');
      if (!(await askConfirm(`"${x.name}" silinsin mi?`, 'Sil'))) return;
      await update((st) => ({ ...st, seniorities: st.seniorities.filter((y) => y.id !== x.id) }), 'Silindi');
    },
    onAdd: (name) => update((st) => ({ ...st, seniorities: [...st.seniorities, { id: uid(), name }] }), `${name} eklendi`),
  });
}

function exportJson() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `gorev-sirasi-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importJson(e) {
  if (!canManage()) return toast('İçe aktarmayı yalnızca başasistan yapabilir.');
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const ok = parsed?.state && Array.isArray(parsed.state.people) && Array.isArray(parsed.state.taskTypes) && Array.isArray(parsed.state.seniorities);
    if (!ok) throw new Error('Dosya bu uygulamaya ait görünmüyor.');
    if (!(await askConfirm('Mevcut verinin yerine dosyadaki veri yüklensin mi?', 'Yükle'))) return;
    const people = parsed.state.people.map((p) => ({ ...p, pinHash: p.pinHash ?? null }));
    await backend.replaceAll({ state: { ...defaultState(), ...parsed.state, people }, assignments: parsed.assignments || [] });
    toast('İçe aktarıldı');
    if (!mePerson() && S().people.length) setTimeout(openLogin, 300);
  } catch (err) {
    toast('Dosya okunamadı: ' + err.message);
  }
}

// ---------- Giriş ve PIN ----------
function loginView() {
  navTitle.textContent = '';
  return h('div', { class: 'empty-state', style: 'padding-top:18vh' },
    h('img', { src: 'icons/icon-192.png', alt: '' }),
    h('h2', {}, 'Görev Sırası'),
    h('p', {}, setupMode()
      ? 'İlk kurulum: başasistan adını seçip kendine bir PIN belirlemeli. Diğerlerinin PIN\'lerini sonra o verecek.'
      : 'Adını seç ve başasistanın sana verdiği PIN\'i gir.'),
    h('button', { class: 'btn-lg primary', onclick: openLogin }, 'Giriş yap'),
  );
}

function pinInput(name, placeholder, required = true) {
  return h('input', { name, type: 'password', inputmode: 'numeric', pattern: '[0-9]{4,6}', minlength: '4', maxlength: '6', placeholder, autocomplete: 'off', required, title: '4–6 rakam' });
}

/** Giriş: önce ad listesi, sonra PIN. */
function openLogin(personId = null) {
  const s = S();
  const p = typeof personId === 'string' ? s.people.find((x) => x.id === personId) : null;
  if (!p) {
    openDialog('Giriş', s.seniorities.map((x) => {
      const q = queueOf(s, x.id);
      return q.length ? section(x.name, q.map((pp) => cell({ av: avatar(pp, 36), title: pp.name, detail: pp.pinHash ? null : 'PIN yok', chev: true, onclick: () => openLogin(pp.id) }))) : null;
    }), { cancelText: 'Vazgeç' });
    return;
  }
  const bootstrap = !p.pinHash && p.seniorityId === adminSenId() && setupMode();
  const noPin = !p.pinHash && !bootstrap;
  const pin = pinInput('pin', bootstrap ? 'Yeni PIN' : 'PIN');
  pin.classList.add('pin-field');
  const pin2 = pinInput('pin2', 'PIN (tekrar)', bootstrap);
  pin2.classList.add('pin-field');
  openDialog(null, [
    h('input', { type: 'hidden', name: 'who', value: p.id }),
    h('div', { class: 'profile-hero' }, avatar(p, 80), h('h3', {}, p.name), h('span', { class: 'muted' }, senName(p.seniorityId))),
    noPin ? h('p', { class: 'group-foot', style: 'text-align:center;margin-top:20px' }, 'Henüz PIN\'in yok. Başasistandan PIN iste.')
      : section(null, [h('div', { class: 'cell' }, pin), bootstrap ? h('div', { class: 'cell' }, pin2) : null],
        { foot: bootstrap ? 'İlk kurulum: kendine 4–6 haneli bir PIN belirle. Diğerlerinin PIN\'lerini Ekip sekmesinden sen vereceksin.' : '4–6 haneli PIN\'ini gir.' }),
  ], {
    cancelText: 'Geri',
    submitText: 'Giriş',
    onSubmit: noPin ? null : async (fd) => {
      if (Date.now() < pinLockedUntil) {
        toast(`Çok fazla yanlış deneme. ${Math.ceil((pinLockedUntil - Date.now()) / 1000)} sn bekle.`);
        return false;
      }
      const pinV = fd.get('pin') || '';
      if (!PIN_RE.test(pinV)) { toast('PIN 4–6 rakamdan oluşmalı.'); return false; }
      const hash = await hashPin(p.id, pinV);
      const cur = S().people.find((x) => x.id === p.id);
      if (!cur) return false;
      if (!cur.pinHash) {
        if (!(cur.seniorityId === adminSenId() && setupMode())) { toast('Henüz PIN\'in yok; başasistandan iste.'); return false; }
        if (pinV !== fd.get('pin2')) { toast('PIN\'ler aynı değil.'); return false; }
        const r = await run((st) => {
          if (st.people.some((x) => x.seniorityId === st.seniorities[0]?.id && x.pinHash)) throw new Error('Başasistan PIN\'i zaten belirlenmiş.');
          return { state: { ...st, people: st.people.map((x) => (x.id === p.id ? { ...x, pinHash: hash } : x)) } };
        });
        if (!r) return false;
      } else if (hash !== cur.pinHash) {
        pinFails += 1;
        if (pinFails >= 5) { pinLockedUntil = Date.now() + 30000; pinFails = 0; }
        navigator.vibrate?.([30, 40, 30]);
        dlgForm.querySelector('.pin-field')?.animate?.([{ transform: 'translateX(0)' }, { transform: 'translateX(-10px)' }, { transform: 'translateX(10px)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(0)' }], { duration: 320, easing: 'ease-out' });
        toast('PIN yanlış.');
        return false;
      }
      pinFails = 0;
      saveSession({ personId: p.id, pinHash: hash });
      tab = 'give';
      render();
      toast(`Hoş geldin, ${firstName(p.name)}`);
      setTimeout(checkRecurring, 500);
    },
  });
  // "Geri" ad listesine döner.
  dlgForm.querySelector('.sheet-head .left .text-btn')?.addEventListener('click', (e) => { e.stopImmediatePropagation(); openLogin(); }, { capture: true });
  setTimeout(() => pin.focus?.(), 350);
}

/** Bu cihazdaki oturumu kapatır. Tekrar girmek için PIN gerekir. */
async function logout() {
  if (dlg.open) await closeDlg();
  const mp = mePerson();
  if (!(await askConfirm(`${mp ? mp.name + ' olarak açık oturum' : 'Oturum'} bu cihazda kapatılsın mı? Tekrar girmek için PIN gerekir.`, 'Çıkış yap'))) return;
  if (mp?.push?.[deviceId()]) { await removePushToken(mp.id); backend.deletePushToken(); }
  saveSession(null);
  tab = 'give';
  render();
  toast('Oturum kapatıldı');
}

/** Hesabım: fotoğraf, bildirim, PIN değiştirme. */
function openAccount() {
  const mp = mePerson();
  if (!mp) return openLogin();
  openDialog('Hesabım', [
    photoPicker(mp),
    h('p', { class: 'group-foot', style: 'text-align:center;margin-top:0' }, `${mp.name} · ${senName(mp.seniorityId)}`),
    notifSection(),
    section('PIN değiştir', [
      fieldCell('Mevcut', pinInput('old', '••••', false)),
      fieldCell('Yeni', pinInput('new1', '••••', false)),
      fieldCell('Yeni (tekrar)', pinInput('new2', '••••', false)),
    ], { foot: 'Değiştirmek istemiyorsan boş bırak.' }),
    section(null, [
      cell({ title: 'Profilim', cls: 'accent', onclick: () => openProfile(mp.id) }),
      cell({ title: 'Çıkış yap', cls: 'danger', onclick: logout }),
    ]),
  ], {
    kind: 'account',
    cancelText: 'Kapat',
    submitText: 'Kaydet',
    onSubmit: async (fd) => {
      const me = mePerson();
      if (!me) return;
      const [old, n1, n2] = ['old', 'new1', 'new2'].map((k) => fd.get(k) || '');
      if (!old && !n1 && !n2) return true;
      if (!PIN_RE.test(n1)) { toast('Yeni PIN 4–6 rakamdan oluşmalı.'); return false; }
      if ((await hashPin(me.id, old)) !== me.pinHash) { toast('Mevcut PIN yanlış.'); return false; }
      if (n1 !== n2) { toast('Yeni PIN\'ler aynı değil.'); return false; }
      const hash = await hashPin(me.id, n1);
      const prev = session;
      saveSession({ personId: me.id, pinHash: hash }); // ekran yenilenmeden önce yeni oturumu yaz
      const r = await run((st) => ({ state: { ...st, people: st.people.map((x) => (x.id === me.id ? { ...x, pinHash: hash } : x)) } }));
      if (!r) { saveSession(prev); render(); return false; }
      render();
      toast('PIN değiştirildi');
    },
  });
}

/** Başasistan: bir kişiye yeni PIN atar. Kişinin açık oturumları kapanır. */
function setPinFor(p) {
  if (!isAdmin()) return toast('PIN\'leri yalnızca başasistan atayabilir.');
  const suggested = String(Math.floor(1000 + Math.random() * 9000));
  const input = h('input', { name: 'pin', inputmode: 'numeric', pattern: '[0-9]{4,6}', minlength: '4', maxlength: '6', required: true, value: suggested, autocomplete: 'off', class: 'pin-field' });
  openDialog('PIN ata', [
    h('div', { class: 'profile-hero' }, avatar(p, 64), h('h3', {}, p.name)),
    section(null, h('div', { class: 'cell' }, input),
      { foot: `${p.pinHash ? 'Eski PIN geçersiz olur ve açık oturumu kapanır. ' : ''}Bu PIN'i kişiye kendin ilet; kaydettikten sonra bir daha gösterilmez.` }),
  ], {
    onSubmit: async (fd) => {
      const pin = fd.get('pin');
      if (!PIN_RE.test(pin)) { toast('PIN 4–6 rakamdan oluşmalı.'); return false; }
      const hash = await hashPin(p.id, pin);
      const self = p.id === mePerson()?.id;
      const prev = session;
      if (self) saveSession({ personId: p.id, pinHash: hash });
      const r = await run((st) => ({ state: { ...st, people: st.people.map((x) => (x.id === p.id ? { ...x, pinHash: hash } : x)) } }));
      if (!r) { if (self) saveSession(prev); render(); return false; }
      render();
      toast(`${p.name} için PIN kaydedildi: ${pin}`);
    },
  });
}

// ---------- Başlat ----------
// Sekme değişince (ya da açık sekmeye yeniden dokununca) sayfa en üste döner.
function switchTab(next, dir = 0) {
  const same = tab === next;
  tab = next;
  if (!same) {
    render();
    // Kaydırmayla geçişte içerik parmağın yönünden gelir; dokunarak geçişte yumuşakça belirir.
    view.classList.remove('enter-next', 'enter-prev', 'fade-in');
    void view.offsetWidth;
    view.classList.add(dir > 0 ? 'enter-next' : dir < 0 ? 'enter-prev' : 'fade-in');
  }
  window.scrollTo({ top: 0, behavior: same ? 'smooth' : 'instant' });
}
document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
view.addEventListener('animationend', (e) => { if (e.target === view) view.classList.remove('enter-next', 'enter-prev', 'fade-in'); });

// Parmakla sağa/sola kaydırarak sekme değiştirme.
// Kendi içinde kayan alanlar, yazı alanları ve açık pencerelerde çalışmaz.
// Ekran kenarından başlayan hareket telefonun "geri" hareketine bırakılır.
const SWIPE_SKIP = 'input, textarea, select, .segmented, .chips, .reacts, dialog';
const EDGE = 24;
let swipeStart = null;
document.addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  swipeStart = null;
  if (e.touches.length !== 1 || !data || document.querySelector('dialog[open]') || !TAB_ORDER.includes(tab)) return;
  if (t.clientX < EDGE || t.clientX > window.innerWidth - EDGE) return;
  if (e.target.closest?.(SWIPE_SKIP)) return;
  swipeStart = { x: t.clientX, y: t.clientY, t: Date.now() };
}, { passive: true });
document.addEventListener('touchcancel', () => { swipeStart = null; }, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!swipeStart) return;
  const t = e.changedTouches[0];
  const dir = swipeDirection({ dx: t.clientX - swipeStart.x, dy: t.clientY - swipeStart.y, dt: Date.now() - swipeStart.t });
  swipeStart = null;
  const next = neighborTab(TAB_ORDER, tab, dir);
  if (next) switchTab(next, dir);
}, { passive: true });

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((reg) => reg.update().catch(() => {}))
    .catch(() => { /* yoksay */ });
  // Yeni sürüm devreye girince sayfayı bir kez yenile (eski kodla devam edilmesin).
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
}

function applyHash() {
  if (location.hash === '#gorevlerim') tab = 'mine';
}
applyHash();
window.addEventListener('hashchange', () => { applyHash(); render(); });

(async function start() {
  try {
    backend = await createBackend(firebaseConfig, teamId);
  } catch (err) {
    console.error(err);
    connText = 'Bağlantı hatası';
    view.replaceChildren(navigator.onLine === false
      ? emptyState('link', 'İnternet yok', 'Bağlantı gelince sayfayı yenile.', 'Yenile', () => location.reload())
      : emptyState('link', 'Bağlanılamadı', `Sunucuya bağlanılamadı (${err.message}). İnternet bağlantını kontrol edip yenile.`, 'Yenile', () => location.reload()));
    return;
  }
  connText = backend.kind === 'firebase' ? 'Ortak (canlı)' : 'Yerel mod';
  let pending = false;
  let first = true;
  backend.subscribe((d) => {
    data = d;
    if (first) {
      first = false;
      if (!mePerson() && S().people.length) setTimeout(openLogin, 0);
    }
    // Kullanıcı sayfada bir alana yazarken başkasından gelen güncelleme yazdığını silmesin.
    const el = document.activeElement;
    if (el && view.contains(el) && el.tagName === 'INPUT' && el.value) {
      if (!pending) {
        pending = true;
        el.addEventListener('blur', () => { pending = false; render(); }, { once: true });
      }
      return;
    }
    render();
    if (annOpen && dlg.open) renderAnnouncements();
    checkRecurring();
    refreshPushToken();
  });
})();
