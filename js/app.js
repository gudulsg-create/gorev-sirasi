import * as cfg from './firebase-config.js';
const { firebaseConfig, teamId } = cfg;
const vapidKey = cfg.vapidKey || '';
const notifyUrl = cfg.notifyUrl || '';
import { createBackend } from './backend.js';
import { assign, cancel, passOn, nextPerson, queueOf, addPerson, movePerson, changeSeniority, promoteAll, defaultState, allowedSeniorities, monthKey, bumpStat, ranking, winners, prevMonth, dayKey, leaveOn, cleanLeaves, REACTIONS, setReaction, groupReactions, dueRecurring, runRecurring, issueDay, occurrenceKind, addAnnouncement, removeAnnouncement, markAnnouncementsRead, reactAnnouncement, unreadCount, trophies, MAX_ANNOUNCEMENT_LEN } from './rotation.js';

// ---------- Durum ----------
let backend;
let data = null; // { state, assignments }
let tab = 'give';
let historyFilter = 'all';
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
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const S = () => data.state;
const typeName = (id) => S().taskTypes.find((t) => t.id === id)?.name ?? 'Silinmiş görev türü';
const senName = (id) => S().seniorities.find((s) => s.id === id)?.name ?? '—';
const fmtDay = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' }).format(new Date(y, m - 1, d));
};
const addDays = (n) => dayKey(Date.now() + n * 86400000);
/** Teslim tarihi etiketi: geçti / bugün / tarih. */
function dueBadge(a) {
  if (!a.dueDate) return null;
  const today = dayKey();
  const open = a.status === 'aktif';
  if (open && a.dueDate < today) return h('span', { class: 'due late' }, `⚠️ Gecikti · son gün ${fmtDay(a.dueDate)}`);
  if (open && a.dueDate === today) return h('span', { class: 'due today' }, '⏰ Son gün bugün');
  return h('span', { class: 'due' }, `📅 Son gün: ${fmtDay(a.dueDate)}`);
}
const fmtDate = (ms) => new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ms);

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
  const preview = h('span', { class: 'photo-preview' }, avatar(p, 72));
  const savePhoto = async (photo) => {
    if (!canEditPhoto(p.id)) return toast('Bu kişinin fotoğrafını değiştiremezsin.');
    const r = await run((st) => ({ state: { ...st, people: st.people.map((x) => (x.id === p.id ? { ...x, photo } : x)) } }));
    if (!r) return;
    preview.replaceChildren(avatar({ ...p, photo }, 72));
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
  const removeBtn = h('button', { type: 'button', class: 'btn small danger-ghost', hidden: !p.photo, onclick: () => savePhoto(null) }, 'Kaldır');
  const pickLabel = h('label', { class: 'btn small' }, p.photo ? 'Fotoğrafı değiştir' : 'Fotoğraf ekle', input);
  return h('div', { class: 'photo-picker' },
    preview,
    h('div', { class: 'row wrap' }, pickLabel, removeBtn),
  );
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

function askConfirm(message, yesText = 'Evet') {
  const d = document.getElementById('confirm-dlg');
  document.getElementById('confirm-msg').textContent = message;
  document.getElementById('confirm-yes').textContent = yesText;
  d.returnValue = '';
  d.showModal();
  return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue === 'yes'), { once: true }));
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

function openDialog(title, body, { onSubmit, submitText = 'Kaydet', extra = [], cancelText = 'Vazgeç', cancelPrimary = false } = {}) {
  dlgForm.replaceChildren(...[
    title && h('h2', {}, title),
    body,
    h('div', { class: 'dlg-actions' },
      extra,
      h('span', { class: 'spacer' }),
      cancelText && h('button', { type: 'button', class: cancelPrimary ? 'btn primary' : 'btn', onclick: () => dlg.close() }, cancelText),
      onSubmit && h('button', { type: 'submit', class: 'btn primary' }, submitText),
    ),
  ].filter(Boolean));
  dlgForm.onsubmit = async (e) => {
    e.preventDefault();
    if (!onSubmit || !dlgForm.reportValidity()) return;
    if ((await onSubmit(new FormData(dlgForm))) !== false) dlg.close();
  };
  if (!dlg.open) dlg.showModal();
  dlgForm.querySelector('input:not([type=checkbox])')?.focus();
}
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

// ---------- Görünümler ----------
function render() {
  document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  const mp = data ? mePerson() : null;
  const meBtn = document.getElementById('me-btn');
  if (mp) meBtn.replaceChildren(avatar(mp, 24), h('span', { class: 'me-text' }, `${mp.name} · ${senName(mp.seniorityId)}`));
  else meBtn.textContent = '🔒 Giriş yap';
  if (!data) return;
  if (S().people.length && !mp) {
    view.replaceChildren(loginView());
    return;
  }
  const views = { give: giveView, mine: mineView, history: historyView, team: teamView, settings: settingsView };
  const openMine = data.assignments.filter((a) => a.status === 'aktif' && a.personId === mp?.id).length;
  const badge = document.getElementById('mine-count');
  badge.hidden = !openMine;
  badge.textContent = String(openMine);
  view.replaceChildren(views[tab]());
}

function empty(text, btn, onclick) {
  return h('div', { class: 'empty' }, h('p', {}, text), btn && h('button', { class: 'btn primary', onclick }, btn));
}

// --- Görev ver ---
function giveView() {
  const s = S();
  if (!s.people.length) {
    return empty('Önce ekibe asistanları ve kıdemlerini ekleyin.', 'Ekibi düzenle', () => { tab = 'team'; render(); });
  }
  const recent = data.assignments.filter((a) => a.status !== 'iptal').slice(0, 5);
  return h('section', {},
    installHint(),
    announcementCard(),
    monthCard(),
    h('p', { class: 'lead' }, 'Vermek istediğin görevi seç:'),
    h('div', { class: 'type-grid' },
      s.taskTypes.map((t) => h('button', { class: 'type-btn', onclick: () => chooseSeniority(t) }, t.name)),
    ),
    h('h2', {}, 'Sıradakiler'),
    nextTable(),
    upcomingRecurring(),
    recent.length ? h('h2', {}, 'Son verilenler') : null,
    recent.length ? h('ul', { class: 'asg-list' }, recent.map((a) => assignmentItem(a, { compact: true }))) : null,
  );
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
  const close = h('button', { class: 'icon-btn hint-close', 'aria-label': 'Kapat', onclick: () => {
    try { localStorage.setItem('gorev-sirasi:install-hint', 'kapali'); } catch { /* yoksay */ }
    render();
  } }, '✕');
  const body = deferredInstall
    ? h('button', { class: 'btn primary small', onclick: async () => { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; render(); } }, 'Ana ekrana ekle')
    : isIOS()
      ? h('span', { class: 'small' }, 'Safari\'de alttaki ', h('strong', {}, 'Paylaş (□↑)'), ' → ', h('strong', {}, 'Ana Ekrana Ekle'), '.', pushConfigured() ? ' Bildirim almak için de gerekli.' : '')
      : h('span', { class: 'small' }, 'Tarayıcı menüsünden (⋮) ', h('strong', {}, 'Ana ekrana ekle'), '.');
  return h('div', { class: 'install-hint' },
    h('img', { src: 'icons/icon-192.png', alt: '', width: 40, height: 40 }),
    h('div', { class: 'hint-text' }, h('strong', {}, '📲 Uygulama gibi kullan'), body),
    close,
  );
}

// --- Ayın elemanı ---
const monthLabel = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(new Date(y, mo - 1, 1));
};
const personById = (id) => S().people.find((p) => p.id === id);
/** Geçen ayın kazananları (ekipte olmayanlar dahil isimleri kayıtlardan bulunur). */
function lastMonthWinnerIds() {
  return winners(S(), prevMonth(monthKey(Date.now()))).map((w) => w.personId);
}

function monthCard() {
  const s = S();
  const cur = monthKey(Date.now());
  const prev = prevMonth(cur);
  const won = winners(s, prev);
  const top = ranking(s, cur).slice(0, 3);
  if (!won.length && !top.length) {
    return h('div', { class: 'month-card empty-card' },
      h('span', { class: 'trophy' }, '🏆'),
      h('div', {}, h('strong', {}, 'Ayın elemanı'), h('p', { class: 'muted small' }, 'Ay boyunca "Tamamlandı" işaretlenen görevler sayılır; en çok tamamlayan ayın elemanı olur.')),
    );
  }
  return h('button', { class: 'month-card', onclick: () => openLeaderboard(won.length ? prev : cur) },
    won.length
      ? h('div', { class: 'winner' },
        h('div', { class: 'winner-photos' }, won.map((w) => avatar(personById(w.personId) || { id: w.personId, name: '?' }, 52))),
        h('div', {},
          h('span', { class: 'month-tag' }, `🏆 ${monthLabel(prev)} ayının elemanı`),
          h('strong', { class: 'winner-name' }, won.map((w) => personById(w.personId)?.name ?? 'Eski ekip üyesi').join(', ')),
          h('span', { class: 'muted small' }, `${won[0].count} görev tamamladı`),
        ),
      )
      : h('div', { class: 'winner' }, h('span', { class: 'trophy' }, '🏆'), h('div', {}, h('span', { class: 'month-tag' }, 'Ayın elemanı'), h('strong', {}, `${monthLabel(cur)} yarışı sürüyor`))),
    top.length ? h('div', { class: 'race' },
      h('span', { class: 'muted small' }, `Bu ay (${monthLabel(cur)}):`),
      top.map((x, i) => h('span', { class: 'race-item' }, `${['🥇', '🥈', '🥉'][i]} `, avatar(personById(x.personId) || { id: x.personId, name: '?' }, 20), ` ${personById(x.personId)?.name.split(' ')[0] ?? '?'} ${x.count}`)),
    ) : null,
  );
}

function openLeaderboard(month) {
  const s = S();
  const months = Object.keys(s.stats || {}).filter((m) => ranking(s, m).length);
  const cur = monthKey(Date.now());
  if (!months.includes(cur)) months.push(cur);
  months.sort().reverse();
  const list = h('ol', { class: 'leader-list' });
  const select = h('select', { 'aria-label': 'Ay', onchange: () => fill(select.value) },
    months.map((m) => h('option', { value: m, selected: m === month }, monthLabel(m) + (m === cur ? ' (bu ay)' : ''))));
  function fill(m) {
    const r = ranking(s, m);
    const topCount = r[0]?.count;
    list.replaceChildren(...(r.length ? r.map((x, i) => {
      const p = personById(x.personId);
      return h('li', { class: x.count === topCount ? 'top' : '', onclick: () => p && openProfile(p.id), style: p ? 'cursor:pointer' : '' },
        h('span', { class: 'rank' }, x.count === topCount ? '🏆' : String(i + 1)),
        avatar(p || { id: x.personId, name: '?' }, 36),
        h('span', { class: 'leader-name' }, p?.name ?? 'Eski ekip üyesi', p ? h('small', { class: 'muted' }, senName(p.seniorityId)) : null),
        h('strong', {}, String(x.count)),
      );
    }) : [h('li', { class: 'muted' }, 'Bu ay henüz tamamlanan görev yok.')]));
  }
  fill(month);
  openDialog('Ayın elemanı', h('div', { class: 'form-grid' },
    select,
    list,
    h('small', { class: 'muted' }, '"Tamamlandı" olarak işaretlenen görevler, görevin verildiği aya sayılır. Eşitlikte birden fazla kişi ayın elemanı olur.'),
  ), { cancelText: 'Kapat' });
}

// --- Tekrarlayan görevler ---
const freqLabel = (r) => (r.unit === 'day' ? (r.every === 1 ? 'her gün' : `${r.every} günde bir`) : `${r.every} ${r.unit === 'week' ? 'haftada' : 'ayda'} bir`) + (r.skipWeekends ? ' (hafta sonu hariç)' : '');
const recurLabel = (r) => freqLabel(r) + (r.altEvery > 1 ? ` · her ${r.altEvery}. seferde: ${typeName(r.altTypeId || r.typeId)}${r.altNote ? ' (' + r.altNote + ')' : ''}` : '');
function upcomingRecurring() {
  const s = S();
  const list = (s.recurring || []).filter((r) => r.active !== false).sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  if (!list.length) return null;
  return h('div', {},
    h('h2', {}, '🔁 Yaklaşan otomatik görevler'),
    h('ul', { class: 'recur-list' }, list.map((r) => {
      const kind = occurrenceKind(r);
      const n = nextPerson(s, kind.typeId, r.seniorityId);
      return h('li', { class: kind.alt ? 'alt' : '' },
        h('div', { class: 'recur-main' },
          h('strong', {}, `${kind.alt ? '🏛 ' : ''}${typeName(kind.typeId)} · ${senName(r.seniorityId)}`),
          kind.note ? h('span', { class: 'small' }, kind.note) : null,
          h('span', { class: 'muted small' }, `${fmtDay(issueDay(r))} günü verilecek · son gün ${fmtDay(r.nextDate)} · ${recurLabel(r)}`),
        ),
        n ? h('span', { class: 'cell-who small' }, avatar(n, 22), n.name.split(' ')[0]) : h('span', { class: 'muted small' }, 'Müsait yok'),
      );
    })),
  );
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
          toast(`🔁 Otomatik görev: ${out.add.typeName} → ${out.add.personName}`);
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
  const on = h('input', { type: 'checkbox', name: 'altOn', checked: r.altEvery > 1, onchange: () => { inner.hidden = !on.checked; } });
  const typeSel = h('select', { name: 'altTypeId' },
    h('option', { value: '' }, 'Aynı görev (sadece not farklı)'),
    s.taskTypes.map((t) => h('option', { value: t.id, selected: t.id === r.altTypeId }, t.name)));
  const makeType = h('button', { type: 'button', class: 'btn small', onclick: async () => {
    const base = typeName(dlgForm.querySelector('select[name=typeId]')?.value) || 'Görev';
    const name = `${base} (yüz yüze)`;
    const existing = S().taskTypes.find((t) => t.name === name);
    const id = existing?.id || uid();
    if (!existing) await update((st) => ({ ...st, taskTypes: [...st.taskTypes, { id, name }] }), `"${name}" görev türü eklendi`);
    if (![...typeSel.options].some((o) => o.value === id)) typeSel.append(h('option', { value: id }, name));
    typeSel.value = id;
  } }, '+ Ayrı “yüz yüze” görev türü oluştur');
  const inner = h('div', { class: 'form-grid', hidden: !(r.altEvery > 1) },
    h('div', { class: 'row' }, h('span', {}, 'Her'), h('input', { name: 'altEvery', type: 'number', min: '2', max: '12', value: String(r.altEvery > 1 ? r.altEvery : 3), style: 'width:70px' }), h('span', {}, '. seferde şu görev verilsin:')),
    typeSel,
    makeType,
    h('small', { class: 'muted' }, 'Ayrı görev türü seçilirse onun sırası da ayrı döner; böylece kütüphaneye gitme işi de ekipte adil dağılır.'),
    h('input', { name: 'altNote', maxlength: '80', value: r.altNote || '', placeholder: 'ör. Yüz yüze: kütüphaneye gidilecek' }),
  );
  return h('fieldset', { class: 'leave-box' },
    h('legend', {}, 'Dönüşümlü görev'),
    h('label', { class: 'lock' }, on, 'Belirli aralıklarla farklı görev ver (ör. her 3. ay yüz yüze)'),
    inner,
  );
}

function editRecurring(r) {
  const s = S();
  const isNew = !r;
  const kitap = s.taskTypes.find((t) => /kitap/i.test(t.name) && !/yüz/i.test(t.name));
  const yuzyuze = s.taskTypes.find((t) => /yüz yüze/i.test(t.name));
  r = r ?? { typeId: kitap?.id ?? s.taskTypes[0]?.id, seniorityId: s.seniorities[s.seniorities.length - 1]?.id, every: 1, unit: 'month', nextDate: '', leadDays: 3, note: 'İnternetten uzatma', active: true,
    altEvery: 3, altTypeId: yuzyuze?.id || '', altNote: 'Yüz yüze: kütüphaneye gidilecek' };
  const sel = (name, items, val) => h('select', { name }, items.map((x) => h('option', { value: x.id, selected: x.id === val }, x.name)));
  const field = (label, el, help) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), el, help ? h('small', { class: 'muted' }, help) : null);
  const body = h('div', { class: 'form-grid' },
    field('Görev', sel('typeId', s.taskTypes, r.typeId)),
    field('Hangi kıdeme', sel('seniorityId', s.seniorities, r.seniorityId), 'Görev bu kıdemde sırası gelen kişiye verilir.'),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Ne sıklıkla'),
      h('div', { class: 'row' },
        h('input', { name: 'every', type: 'number', min: '1', max: '24', required: true, value: String(r.every), style: 'width:80px' }),
        h('select', { name: 'unit', onchange: (e) => { const lead = dlgForm.querySelector('input[name=leadDays]'); if (e.target.value === 'day' && lead && Number(lead.value) > 0) lead.value = '0'; } },
          h('option', { value: 'day', selected: r.unit === 'day' }, 'günde bir'),
          h('option', { value: 'week', selected: r.unit === 'week' }, 'haftada bir'),
          h('option', { value: 'month', selected: !r.unit || r.unit === 'month' }, 'ayda bir')),
      ),
      h('label', { class: 'lock', style: 'margin-top:6px' }, h('input', { type: 'checkbox', name: 'skipWeekends', checked: !!r.skipWeekends }), 'Hafta sonları verme (cumartesi/pazar atlanır)')),
    field('Sıradaki tarih (son gün)', h('input', { name: 'nextDate', type: 'date', required: true, value: r.nextDate }), 'Örn. kütüphaneye gidilmesi gereken gün.'),
    field('Kaç gün önce verilsin', h('input', { name: 'leadDays', type: 'number', min: '0', max: '60', required: true, value: String(r.leadDays) }), 'Günlük görevlerde 0 (o gün verilir) önerilir.'),
    field('Not (isteğe bağlı)', h('input', { name: 'note', maxlength: '80', value: r.note || '', placeholder: 'ör. İnternetten uzatma' })),
    altBox(r),
    !isNew ? h('label', { class: 'lock' }, h('input', { type: 'checkbox', name: 'active', checked: r.active !== false }), 'Etkin') : null,
  );
  openDialog(isNew ? 'Tekrarlayan görev ekle' : 'Tekrarlayan görevi düzenle', body, {
    extra: !isNew ? [h('button', { type: 'button', class: 'btn danger-ghost', onclick: async () => {
      dlg.close();
      if (!(await askConfirm('Bu tekrarlayan görev silinsin mi? Daha önce verilen görevler kalır.', 'Sil'))) return;
      update((st) => ({ ...st, recurring: (st.recurring || []).filter((x) => x.id !== r.id) }), 'Silindi');
    } }, 'Sil')] : [],
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
        nextDate: fd.get('nextDate'),
        leadDays: Math.max(0, Math.min(60, Number(fd.get('leadDays')) || 0)),
        note: (fd.get('note') || '').trim(),
        active: isNew ? true : fd.get('active') === 'on',
        lastRun: r.lastRun || null,
      };
      await update((st) => ({ ...st, recurring: isNew ? [...(st.recurring || []), item] : (st.recurring || []).map((x) => (x.id === item.id ? item : x)) }), 'Kaydedildi');
      setTimeout(checkRecurring, 300);
    },
  });
}

function recurringBlock() {
  const list = S().recurring || [];
  return h('div', { class: 'settings-block' },
    h('h2', {}, '🔁 Tekrarlayan görevler'),
    h('p', { class: 'muted small' }, 'Belirli aralıklarla yapılan işler (ör. 3 ayda bir kütüphanede kitap uzatma). Tarih yaklaşınca görev sıradaki kişiye kendiliğinden verilir.'),
    list.length ? h('ul', { class: 'recur-list' }, list.map((r) => h('li', {},
      h('div', { class: 'recur-main' },
        h('strong', {}, `${typeName(r.typeId)} · ${senName(r.seniorityId)}`, r.active === false ? h('span', { class: 'badge s-iptal', style: 'margin-left:6px' }, 'Kapalı') : null),
        h('span', { class: 'muted small' }, `${recurLabel(r)} · sıradaki: ${fmtDay(r.nextDate)} (${r.leadDays} gün önce verilir)`),
      ),
      h('button', { class: 'icon-btn', 'aria-label': 'Düzenle', onclick: () => editRecurring(r) }, '✎'),
    ))) : null,
    h('button', { class: 'btn', onclick: () => editRecurring() }, '+ Tekrarlayan görev ekle'),
  );
}

function nextTable() {
  const s = S();
  const allowed = allowedSeniorities(s, mePerson()?.id);
  const sens = s.seniorities.filter((x) => allowed.includes(x.id) && queueOf(s, x.id).length);
  if (!sens.length) return null;
  return h('div', { class: 'table-wrap' },
    h('table', { class: 'next-table' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), sens.map((x) => h('th', {}, x.name)))),
      h('tbody', {}, s.taskTypes.map((t) => h('tr', {},
        h('th', { scope: 'row' }, t.name),
        sens.map((x) => {
          const n = nextPerson(s, t.id, x.id);
          return h('td', {}, n ? h('span', { class: 'cell-who' }, avatar(n, 22), n.name) : h('span', { class: 'muted' }, '—'));
        }),
      ))),
    ),
  );
}

function chooseSeniority(type) {
  const s = S();
  const note = h('input', { name: 'note', maxlength: '120', placeholder: 'Not (isteğe bağlı)', autocomplete: 'off' });
  const due = h('input', { type: 'date', name: 'due', min: dayKey(), 'aria-label': 'Son gün' });
  const quick = (label, n) => h('button', { type: 'button', class: 'chip-btn', onclick: () => { due.value = n === null ? '' : addDays(n); } }, label);
  const dueRow = h('div', { class: 'due-row' },
    h('span', { class: 'field-label' }, 'Son gün'),
    h('div', { class: 'chips' }, quick('Yok', null), quick('Bugün', 0), quick('Yarın', 1), quick('3 gün', 3), quick('1 hafta', 7)),
    due,
  );
  const allowed = allowedSeniorities(s, mePerson()?.id);
  const list = h('div', { class: 'sen-list' },
    s.seniorities.map((x) => {
      const next = nextPerson(s, type.id, x.id);
      const ok = allowed.includes(x.id);
      return h('button', {
        type: 'button',
        class: 'sen-btn',
        disabled: !next || !ok,
        onclick: () => give(type, x, note.value.trim(), due.value || null),
      },
        h('strong', {}, x.name),
        h('span', { class: 'sen-next' }, ok && next ? avatar(next, 24) : null, !ok ? 'Üst / aynı kıdem' : next ? `Sıradaki: ${next.name}` : 'Müsait kimse yok'),
      );
    }),
  );
  openDialog(`${type.name}`, h('div', { class: 'form-grid' },
    h('p', { class: 'muted' }, allowed.length ? 'Hangi kıdeme verilsin?' : 'Senin altında görev verebileceğin bir kıdem yok.'),
    dueRow,
    note,
    h('small', { class: 'muted' }, 'Kişisel sağlık verisi (hasta adı, TC no vb.) yazmayın. Son gün ve notu doldurduktan sonra kıdemi seç.'),
    list,
  ));
}

async function give(type, sen, note, dueDate = null) {
  const mp = mePerson();
  if (!mp) {
    dlg.close();
    return openLogin();
  }
  if (!allowedSeniorities(S(), mp.id).includes(sen.id)) return toast('Yalnızca alt kıdemlere görev verebilirsin.');
  const r = await run((state) => {
    const out = assign(state, type.id, sen.id, { id: uid(), by: mp.name, byId: mp.id, note, dueDate });
    return { state: out.state, add: out.assignment };
  });
  if (!r) return;
  notify('assignment', r.add.id);
  showResult(r.add);
}

function showResult(a) {
  const body = h('div', { class: 'result' },
    h('div', { class: 'result-photo' }, avatar(a.personId, 96), h('span', { class: 'result-check' }, '✓')),
    h('p', { class: 'result-name' }, a.personName),
    h('p', { class: 'muted' }, `${a.typeName} · ${a.seniorityName}`),
    a.dueDate ? h('p', {}, dueBadge(a)) : null,
    a.skipped?.length ? h('p', { class: 'muted small' }, `Aktarıldı: ${a.skipped.map((x) => x.personName).join(', ')} yerine`) : null,
  );
  openDialog(null, body, {
    cancelText: 'Tamam',
    cancelPrimary: true,
    extra: [
      isAdmin() && h('button', { type: 'button', class: 'btn danger-ghost', onclick: () => doCancel(a, true) }, 'Geri al'),
      canPassOn(a) && h('button', { type: 'button', class: 'btn', onclick: () => doPassOn(a, true) }, 'Sonrakine aktar'),
    ].filter(Boolean),
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
  if (dlg.open) dlg.close();
  toast(r.restored ? `İptal edildi. Sıra yine ${a.personName}'da.` : 'İptal edildi.');
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
  else toast(`Görev ${r.updated.personName} kişisine aktarıldı.`);
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
  if (r) toast(r.done ? 'Tamamlandı olarak işaretlendi' : 'Yeniden açıldı');
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
  const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register('sw.js'));
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
  if (state === 'ana-ekran') return toast('iPhone\'da bildirim için önce uygulamayı ana ekrana ekleyip oradan açın.');
  if (state === 'desteklenmiyor') return toast('Bu tarayıcı bildirimleri desteklemiyor.');
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return toast('Bildirim izni verilmedi. Telefon ayarlarından izin verebilirsin.');
    const token = await backend.getPushToken(await swReady(), vapidKey);
    if (!token) throw new Error('Bildirim anahtarı alınamadı.');
    if (await savePushToken(token)) toast('🔔 Bildirimler açıldı');
    refreshOpenDialogs();
  } catch (err) {
    toast('Bildirim açılamadı: ' + (err.message || err));
  }
}
async function disablePush() {
  const me = mePerson();
  if (!me) return;
  await removePushToken(me.id);
  await backend.deletePushToken();
  toast('🔕 Bildirimler bu cihazda kapatıldı');
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
function notifBlock() {
  const st = pushState();
  if (st === 'yok') return null;
  const msg = {
    'ana-ekran': 'iPhone\'da bildirim almak için uygulamayı ana ekrana ekleyip simgeden açman gerekiyor.',
    desteklenmiyor: 'Bu tarayıcı bildirimleri desteklemiyor.',
    engelli: 'Bildirimler bu cihazda engellenmiş. Telefonun Ayarlar → Bildirimler bölümünden Görev Sırası\'na izin ver.',
    acik: 'Sana görev verildiğinde ve yeni duyuru geldiğinde bu cihaza bildirim gelir.',
    kapali: 'Sana görev verildiğinde ve yeni duyuru geldiğinde telefonuna bildirim gelsin.',
  }[st];
  return h('div', { class: 'notif-box' },
    h('div', { class: 'notif-text' }, h('strong', {}, st === 'acik' ? '🔔 Bildirimler açık' : '🔕 Bildirimler kapalı'), h('span', { class: 'muted small' }, msg)),
    st === 'kapali' ? h('button', { type: 'button', class: 'btn primary small', onclick: enablePush }, 'Aç') : null,
    st === 'acik' ? h('button', { type: 'button', class: 'btn small', onclick: disablePush }, 'Kapat') : null,
  );
}
function refreshOpenDialogs() {
  render();
  if (dlg.open && dlgForm.querySelector('.notif-box')) {
    const box = dlgForm.querySelector('.notif-box');
    const fresh = notifBlock();
    if (fresh) box.replaceWith(fresh);
  }
}

// --- Duyuru panosu ---
let annOpen = false;
let annNamesFor = null; // okuyan listesi açık duyuru
function announcementCard() {
  const s = S();
  const me = mePerson();
  const list = s.announcements || [];
  if (!list.length) {
    return me ? h('button', { class: 'btn ann-empty', onclick: openAnnouncements }, '📢 Duyuru yayınla') : null;
  }
  const a = list[0];
  const unread = unreadCount(s, me?.id);
  return h('button', { class: `ann-card ${unread ? 'unread' : ''}`, onclick: openAnnouncements },
    h('div', { class: 'ann-head' },
      h('span', { class: 'ann-title' }, '📢 Duyuru'),
      unread ? h('span', { class: 'ann-new' }, unread === 1 ? 'Yeni' : `${unread} yeni`) : null,
      h('span', { class: 'muted small ann-all' }, list.length > 1 ? `Tümü (${list.length}) ›` : 'Aç ›'),
    ),
    h('p', { class: 'ann-text clamp' }, a.text),
    h('span', { class: 'muted small' }, `${a.by} · ${fmtDate(a.createdAt)}`),
  );
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
    return h('li', { class: 'ann-item' },
      h('p', { class: 'ann-text' }, a.text),
      h('span', { class: 'muted small' }, `${a.by} · ${fmtDate(a.createdAt)}`),
      h('div', { class: 'react-bar' },
        groupReactions(a.reactions).map((g) => h('button', { type: 'button', class: `react-chip ${me && g.ids.includes(me.id) ? 'mine' : ''}`, onclick: () => reactAnn(a, g.emoji) },
          h('span', { class: 'react-emoji' }, g.emoji), h('span', { class: 'react-avs' }, g.ids.slice(0, 3).map((id) => avatar(id, 16))), g.ids.length > 3 ? h('span', { class: 'react-n' }, `+${g.ids.length - 3}`) : null)),
        h('button', { type: 'button', class: 'react-add', 'aria-label': 'Emoji ile tepki ver', onclick: (e) => { const pk = e.currentTarget.closest('.ann-item').querySelector('.react-picker'); pk.hidden = !pk.hidden; } }, '☺︎+'),
        h('button', { type: 'button', class: 'react-add', onclick: () => { annNamesFor = showNames ? null : a.id; renderAnnouncements(); } }, `👁 ${readIds.length}/${total}`),
      ),
      h('div', { class: 'react-picker', hidden: true }, REACTIONS.map((e) => h('button', { type: 'button', class: `react-pick ${me && a.reactions?.[me.id] === e ? 'mine' : ''}`, onclick: () => reactAnn(a, e) }, e))),
      showNames ? h('div', { class: 'ann-reads small' },
        h('div', {}, h('strong', {}, 'Okudu: '), readIds.map(nameOf).join(', ') || '—'),
        h('div', { class: 'muted' }, h('strong', {}, 'Henüz okumadı: '), unreadPeople.map((p) => p.name).join(', ') || '—'),
      ) : null,
      isAdmin() || (me && a.byId === me.id) ? h('button', { type: 'button', class: 'btn small danger-ghost', style: 'align-self:flex-start', onclick: async () => {
        dlg.close();
        if (!(await askConfirm('Bu duyuru silinsin mi?', 'Sil'))) return;
        const r = await run((st) => {
          const cur = (st.announcements || []).find((x) => x.id === a.id);
          const meNow = mePerson();
          if (cur && !(isAdmin() || cur.byId === meNow?.id)) throw new Error('Yalnızca kendi duyurunu silebilirsin.');
          return { state: removeAnnouncement(st, a.id) };
        });
        if (r) toast('Duyuru silindi');
      } }, 'Sil') : null,
    );
  });
  const composer = me ? h('div', { class: 'ann-compose' },
    h('textarea', { name: 'ann', rows: '3', maxlength: String(MAX_ANNOUNCEMENT_LEN), placeholder: 'Ekibe duyuru yaz… (hasta bilgisi yazmayın)' }),
    h('button', { type: 'button', class: 'btn primary', onclick: postAnnouncement }, 'Yayınla'),
  ) : null;
  openDialog('📢 Duyurular', h('div', { class: 'form-grid' },
    composer,
    items.length ? h('ul', { class: 'ann-list' }, items) : h('p', { class: 'muted' }, 'Henüz duyuru yok.'),
    h('small', { class: 'muted' }, 'Herkes duyuru yazabilir; duyurulara yalnızca emojiyle tepki verilir. Kendi duyurunu silebilirsin, başasistan tüm duyuruları silebilir.'),
  ), { cancelText: 'Kapat' });
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
  const stat = (v, l, cls = '') => h('div', { class: `pstat ${cls}` }, h('strong', {}, String(v)), h('span', {}, l));
  const body = h('div', { class: 'profile' },
    h('div', { class: 'profile-head' },
      avatar(p, 96),
      h('div', {},
        h('h3', {}, p.name),
        h('span', { class: 'muted' }, senName(p.seniorityId)),
        cups.length ? h('span', { class: 'cups', title: cups.map(monthLabel).join(', ') }, '🏆'.repeat(Math.min(cups.length, 5)), ` ${cups.length} kez ayın elemanı`) : null,
        now ? h('span', { class: 'leave-tag' }, `🌴 İzinde · ${fmtDay(now.to)}'e kadar`)
          : p.active === false ? h('span', { class: 'leave-tag' }, '🌴 İzinli')
          : nextLeave ? h('span', { class: 'muted small' }, `🌴 Planlı izin: ${fmtDay(nextLeave.from)} – ${fmtDay(nextLeave.to)}`) : null,
      ),
    ),
    h('div', { class: 'pstats' },
      stat(thisMonth.length, 'bu ay aldığı'),
      stat(doneMonth, 'bu ay tamamladığı'),
      stat(rate === null ? '—' : `%${rate}`, 'tamamlama oranı'),
      stat(open.length, 'açık görev', open.length ? 'warn' : ''),
      stat(late, 'geciken', late ? 'bad' : ''),
      stat(given, 'bu ay verdiği'),
    ),
    cups.length ? h('p', { class: 'muted small' }, `🏆 ${cups.map(monthLabel).join(', ')}`) : null,
    mine.length ? h('h3', { class: 'p-sub' }, 'Son görevleri') : null,
    mine.length ? h('ul', { class: 'asg-list' }, mine.slice(0, 5).map((a) => assignmentItem(a, { compact: true }))) : h('p', { class: 'muted' }, 'Henüz görevi yok.'),
  );
  openDialog(null, body, {
    cancelText: 'Kapat',
    extra: [
      isAdmin() && h('button', { type: 'button', class: 'btn', onclick: () => editPerson(p) }, 'Düzenle'),
      mePerson()?.id === p.id && h('button', { type: 'button', class: 'btn', onclick: openAccount }, 'Hesabım'),
    ].filter(Boolean),
  });
}

// --- Emoji tepkileri ---
let reactOpenFor = null; // tepki seçicisi açık olan görev
async function react(a, emoji) {
  const me = mePerson();
  if (!me) return openLogin();
  reactOpenFor = null;
  await run((state, cur) => {
    if (!cur) throw new Error('Kayıt bulunamadı.');
    if (cur.status === 'iptal') throw new Error('İptal edilmiş göreve tepki verilemez.');
    return { patch: { reactions: setReaction(cur.reactions, me.id, emoji) } };
  }, { assignmentId: a.id });
}
function reactionBar(a) {
  if (a.status === 'iptal') return null;
  const me = mePerson();
  const groups = groupReactions(a.reactions);
  const nameOf = (id) => personById(id)?.name ?? 'Eski ekip üyesi';
  const chips = groups.map((g) => h('button', {
    class: `react-chip ${me && g.ids.includes(me.id) ? 'mine' : ''}`,
    title: g.ids.map(nameOf).join(', '),
    'aria-label': `${g.emoji} ${g.ids.length}: ${g.ids.map(nameOf).join(', ')}`,
    onclick: () => react(a, g.emoji),
  }, h('span', { class: 'react-emoji' }, g.emoji), h('span', { class: 'react-avs' }, g.ids.slice(0, 3).map((id) => avatar(id, 16))), g.ids.length > 3 ? h('span', { class: 'react-n' }, `+${g.ids.length - 3}`) : null));
  const open = reactOpenFor === a.id;
  const toggle = h('button', { class: `react-add ${open ? 'open' : ''}`, 'aria-label': 'Emoji ile tepki ver', 'aria-expanded': String(open), onclick: () => { reactOpenFor = open ? null : a.id; render(); } }, open ? '✕' : '☺︎+');
  const who = groups.length ? h('span', { class: 'react-who muted' }, groups.map((g) => `${g.emoji} ${g.ids.map((id) => nameOf(id).split(' ')[0]).join(', ')}`).join(' · ')) : null;
  return h('div', { class: 'react-wrap' },
    h('div', { class: 'react-bar' }, chips, toggle),
    open ? h('div', { class: 'react-picker', role: 'group', 'aria-label': 'Emoji seç' },
      REACTIONS.map((e) => h('button', { class: `react-pick ${me && a.reactions?.[me.id] === e ? 'mine' : ''}`, onclick: () => react(a, e) }, e))) : null,
    who,
  );
}

function assignmentItem(a, { compact = false } = {}) {
  const status = { aktif: 'Verildi', tamamlandı: 'Tamamlandı', iptal: 'İptal' }[a.status] ?? a.status;
  const late = a.status === 'aktif' && a.dueDate && a.dueDate < dayKey();
  return h('li', { class: `asg ${a.status === 'iptal' ? 'cancelled' : ''} ${late ? 'late' : ''}` },
    h('div', { class: 'asg-main' },
      h('div', { class: 'asg-title' }, h('button', { class: 'asg-who linkish', onclick: () => openProfile(a.personId), 'aria-label': `${a.personName} profili` }, avatar(a.personId, 28), h('strong', {}, a.personName)), h('span', { class: `badge s-${a.status}` }, status)),
      h('span', {}, `${a.typeName} · ${a.seniorityName}`),
      h('span', { class: 'muted small' }, `${fmtDate(a.createdAt)}${a.by ? ' · veren: ' + a.by : ''}`),
      a.skipped?.length ? h('span', { class: 'muted small' }, `↪ ${a.skipped.map((x) => x.personName).join(', ')} yerine aktarıldı`) : null,
      dueBadge(a),
      a.note ? h('span', { class: 'note' }, a.note) : null,
    ),
    reactionBar(a),
    !compact && a.status !== 'iptal' && (canToggleDone(a) || canPassOn(a) || isAdmin()) && h('div', { class: 'asg-actions' },
      canToggleDone(a) && h('button', { class: 'btn small', onclick: () => toggleDone(a) }, a.status === 'tamamlandı' ? 'Geri aç' : 'Tamamlandı'),
      a.status === 'aktif' && canPassOn(a) && h('button', { class: 'btn small', onclick: () => doPassOn(a) }, 'Aktar'),
      isAdmin() && h('button', { class: 'btn small danger-ghost', onclick: () => doCancel(a) }, 'İptal'),
    ),
  );
}

// --- Görevlerim ---
function mineView() {
  const me = mePerson();
  const byDue = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.createdAt - b.createdAt;
  const open = data.assignments.filter((a) => a.status === 'aktif' && a.personId === me.id).sort(byDue);
  const done = data.assignments.filter((a) => a.status === 'tamamlandı' && a.personId === me.id).slice(0, 10);
  const given = data.assignments.filter((a) => a.status === 'aktif' && a.byId === me.id).sort(byDue);
  const late = open.filter((a) => a.dueDate && a.dueDate < dayKey()).length;
  return h('section', {},
    h('h2', { style: 'margin-top:0' }, `Bana verilen açık görevler (${open.length})`),
    late ? h('p', { class: 'late-note' }, `⚠️ ${late} görevin son günü geçti.`) : null,
    open.length ? h('ul', { class: 'asg-list' }, open.map((a) => assignmentItem(a))) : h('p', { class: 'muted' }, '🎉 Açık görevin yok.'),
    h('p', { class: 'hint' }, 'Bitirdiğin görevi "Tamamlandı" olarak işaretle; ayın elemanı sayımına eklenir.'),
    given.length ? h('h2', {}, `Verdiğim, henüz bitmemiş görevler (${given.length})`) : null,
    given.length ? h('ul', { class: 'asg-list' }, given.map((a) => assignmentItem(a))) : null,
    done.length ? h('h2', {}, 'Son tamamladıklarım') : null,
    done.length ? h('ul', { class: 'asg-list' }, done.map((a) => assignmentItem(a))) : null,
  );
}

// --- Geçmiş ---
function historyView() {
  const s = S();
  const chips = h('div', { class: 'chips' },
    [{ id: 'all', name: 'Tümü' }, ...s.taskTypes].map((t) => h('button', {
      class: 'chip-btn', 'aria-pressed': String(historyFilter === t.id), onclick: () => { historyFilter = t.id; render(); },
    }, t.name)),
  );
  const list = data.assignments.filter((a) => historyFilter === 'all' || a.typeId === historyFilter);
  return h('section', {},
    chips,
    list.length ? h('ul', { class: 'asg-list' }, list.map((a) => assignmentItem(a))) : empty('Henüz görev verilmedi.'),
  );
}

// --- Ekip ---
function countsFor(personId) {
  const c = {};
  for (const a of data.assignments) if (a.personId === personId && a.status !== 'iptal') c[a.typeId] = (c[a.typeId] || 0) + 1;
  return c;
}

function teamView() {
  const s = S();
  const name = h('input', { name: 'pname', required: true, maxlength: '60', placeholder: 'Ad soyad', autocomplete: 'off' });
  const lastSen = s.seniorities[s.seniorities.length - 1]?.id;
  const sen = h('select', { name: 'psen', 'aria-label': 'Kıdem' }, s.seniorities.map((x) => h('option', { value: x.id, selected: x.id === lastSen }, x.name)));
  const form = h('form', {
    class: 'add-form',
    onsubmit: async (e) => {
      e.preventDefault();
      const n = name.value.trim();
      if (!n) return;
      const senId = sen.value;
      await update((st) => addPerson(st, { id: uid(), name: n, seniorityId: senId }), `${n} eklendi`);
    },
  }, name, sen, h('button', { class: 'btn primary' }, 'Ekle'));

  const manage = canManage();
  return h('section', {},
    manage ? h('h2', {}, 'Asistan ekle') : null,
    manage ? form : h('p', { class: 'muted small' }, 'Ekibi yalnızca başasistan düzenleyebilir.'),
    s.seniorities.map((x) => {
      const q = queueOf(s, x.id);
      return h('div', { class: 'sen-group' },
        h('h2', {}, `${x.name} `, h('span', { class: 'muted' }, `(${q.length})`)),
        q.length ? h('ul', { class: 'people' }, q.map((p, i) => personRow(p, i, q.length, manage))) : h('p', { class: 'muted small' }, 'Bu kıdemde kimse yok.'),
      );
    }),
    h('p', { class: 'hint' }, 'Sıra yukarıdan aşağıya ilerler. "İzinli" işaretlenen kişi, işaret kaldırılana kadar tüm sıralarda atlanır.'),
  );
}

function personRow(p, i, n, manage) {
  const c = countsFor(p.id);
  const summary = S().taskTypes.map((t) => c[t.id] ? `${t.name.split(' ')[0]} ${c[t.id]}` : null).filter(Boolean).join(' · ');
  const main = h('div', { class: 'person-main' },
    h('strong', {}, p.name, lastMonthWinnerIds().includes(p.id) ? h('span', { title: 'Geçen ayın elemanı' }, ' 🏆') : null, p.active === false ? h('span', { class: 'badge s-iptal', style: 'margin-left:6px' }, 'İzinli') : null),
    (() => {
      const now = leaveOn(p);
      const next = cleanLeaves(p.leaves || []).find((l) => l.from > dayKey());
      if (now) return h('span', { class: 'leave-tag' }, `🌴 İzinde · ${fmtDay(now.to)}'e kadar`);
      if (next) return h('span', { class: 'muted small' }, `🌴 Planlı izin: ${fmtDay(next.from)} – ${fmtDay(next.to)}`);
      return null;
    })(),
    h('span', { class: 'muted small' }, summary || 'Henüz görev yok'),
  );
  const who = h('button', { class: 'person-open', 'aria-label': `${p.name} profili`, onclick: () => openProfile(p.id) }, avatar(p, 36), main);
  if (!manage) return h('li', { class: `person ${p.active === false ? 'away' : ''}` }, who);
  return h('li', { class: `person ${p.active === false ? 'away' : ''}` },
    who,
    h('button', { class: `pin-btn ${p.pinHash ? 'has' : ''}`, title: p.pinHash ? 'PIN var · yenisini ata' : 'PIN yok · ata', onclick: () => setPinFor(p) }, p.pinHash ? '🔑' : '🔑?'),
    h('label', { class: 'switch', title: 'İzinli / müsait değil' },
      h('input', { type: 'checkbox', checked: p.active === false, onchange: (e) => {
        const away = e.target.checked;
        update((st) => ({ ...st, people: st.people.map((x) => (x.id === p.id ? { ...x, active: !away } : x)) }), away ? `${p.name} izinli: sırada atlanacak` : `${p.name} yeniden sırada`);
      } }),
      h('span', {}, 'İzinli'),
    ),
    h('div', { class: 'person-actions' },
      h('button', { class: 'icon-btn', 'aria-label': 'Yukarı taşı', disabled: i === 0, onclick: () => update((st) => movePerson(st, p.id, -1)) }, '↑'),
      h('button', { class: 'icon-btn', 'aria-label': 'Aşağı taşı', disabled: i === n - 1, onclick: () => update((st) => movePerson(st, p.id, 1)) }, '↓'),
      h('button', { class: 'icon-btn', 'aria-label': 'Düzenle', onclick: () => editPerson(p) }, '✎'),
    ),
  );
}

/** Başasistan: kişinin tarihli izinleri. Değişiklik hemen kaydedilir. */
/** Tarihli izin için otomatik duyuru metni. */
function leaveAnnouncementText(name, l) {
  const when = l.from === l.to ? `${fmtDay(l.from)} tarihinde` : `${fmtDay(l.from)} – ${fmtDay(l.to)} tarihleri arasında`;
  return `🌴 ${name}, ${when} izinli. ${l.from === l.to ? 'O gün' : 'Bu günlerde'} görev sıralarında atlanacak.`;
}

function leaveEditor(p) {
  const list = h('ul', { class: 'leave-list' });
  const draw = (leaves) => {
    list.replaceChildren(...(leaves.length ? leaves.map((l, i) => h('li', {},
      h('span', {}, `${fmtDay(l.from)} – ${fmtDay(l.to)}`),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'İzni sil', onclick: () => save(leaves.filter((_, j) => j !== i)) }, '🗑'),
    )) : [h('li', { class: 'muted small' }, 'Planlı izin yok.')]));
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
  return h('fieldset', { class: 'leave-box' },
    h('legend', {}, 'Tarihli izin'),
    list,
    h('div', { class: 'leave-add' }, from, h('span', {}, '–'), to,
      h('button', { type: 'button', class: 'btn small', onclick: () => {
        if (!from.value || !to.value) return toast('Başlangıç ve bitiş tarihini seç.');
        if (to.value < from.value) return toast('Bitiş, başlangıçtan önce olamaz.');
        const current = S().people.find((x) => x.id === p.id)?.leaves || [];
        const added = { from: from.value, to: to.value };
        save([...current, added], added);
        from.value = ''; to.value = '';
      } }, 'Ekle')),
    h('small', { class: 'muted' }, 'Kişi bu tarihlerde bütün sıralarda otomatik atlanır, izin bitince kendiliğinden sıraya döner.'),
  );
}

function editPerson(p) {
  const s = S();
  const body = h('div', { class: 'form-grid' },
    photoPicker(p),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Ad soyad'), h('input', { name: 'name', required: true, maxlength: '60', value: p.name })),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Kıdem'),
      h('select', { name: 'sen' }, s.seniorities.map((x) => h('option', { value: x.id, selected: x.id === p.seniorityId }, x.name)))),
    h('small', { class: 'muted' }, 'Kıdemi değişen kişi yeni kıdeminin sırasının sonuna eklenir.'),
    leaveEditor(p),
  );
  openDialog('Asistanı düzenle', body, {
    extra: [h('button', { type: 'button', class: 'btn danger-ghost', onclick: async () => {
      dlg.close();
      if (!(await askConfirm(`${p.name} ekipten çıkarılsın mı? Geçmiş kayıtları silinmez.`, 'Çıkar'))) return;
      update((st) => ({ ...st, people: st.people.filter((x) => x.id !== p.id) }), `${p.name} çıkarıldı`);
    } }, 'Çıkar')],
    onSubmit: async (fd) => {
      const name = fd.get('name').trim();
      const senId = fd.get('sen');
      await update((st) => changeSeniority({ ...st, people: st.people.map((x) => (x.id === p.id ? { ...x, name } : x)) }, p.id, senId), 'Kaydedildi');
    },
  });
}

// --- Ayarlar ---
function editableList(title, items, { onRename, onDelete, onAdd, addPlaceholder }) {
  const input = h('input', { placeholder: addPlaceholder, maxlength: '50' });
  return h('div', { class: 'settings-block' },
    h('h2', {}, title),
    h('ul', { class: 'edit-list' }, items.map((it) => h('li', {},
      h('input', { value: it.name, maxlength: '50', 'aria-label': 'Ad', onchange: (e) => { const v = e.target.value.trim(); if (v) onRename(it, v); } }),
      h('button', { class: 'icon-btn', 'aria-label': 'Sil', onclick: () => onDelete(it) }, '🗑'),
    ))),
    h('form', { class: 'add-form', onsubmit: (e) => { e.preventDefault(); const v = input.value.trim(); if (v) onAdd(v); } },
      input, h('button', { class: 'btn' }, 'Ekle')),
  );
}

// --- Tema ---
const THEMES = [
  { id: 'sl', name: 'Sarı-Lacivert', swatch: 'linear-gradient(90deg,#0b2357 50%,#ffd100 50%)', color: '#0b2357' },
  { id: 'klasik', name: 'Klasik mavi', swatch: 'linear-gradient(90deg,#1f4e79 50%,#2c6aa3 50%)', color: '#1f4e79' },
];
function currentTheme() { return document.documentElement.dataset.theme || 'sl'; }
function setTheme(id) {
  document.documentElement.dataset.theme = id;
  try { localStorage.setItem('gorev-sirasi:theme', id); } catch { /* yoksay */ }
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', THEMES.find((t) => t.id === id)?.color || '#0b2357');
  render();
}
function themeBlock() {
  return h('div', { class: 'settings-block' },
    h('h2', {}, '🎨 Tema'),
    h('div', { class: 'theme-pick' }, THEMES.map((t) => h('button', { class: 'theme-opt', 'aria-pressed': String(currentTheme() === t.id), onclick: () => setTheme(t.id) },
      h('span', { class: 'theme-swatch', style: `background:${t.swatch}` }), t.name))),
    h('p', { class: 'muted small', style: 'margin-top:8px' }, 'Seçim yalnızca bu cihazda geçerlidir. Koyu tema telefonun ayarına göre otomatik açılır.'),
  );
}

function settingsView() {
  const s = S();
  const connBlock = h('div', { class: 'settings-block' },
    h('h2', {}, 'Bağlantı'),
    backend.kind === 'firebase'
      ? h('p', {}, `✅ Firebase'e bağlı (ekip: ${teamId}). Değişiklikler herkese anında yansır.`)
      : h('p', {}, '📱 Yerel mod: veriler yalnızca bu cihazda. Ekipçe ortak sıra için README\'deki Firebase kurulumunu yapın.'),
  );
  const accountBlock = mePerson() && h('div', { class: 'settings-block' },
    h('h2', {}, 'Hesabım'),
    h('p', {}, `${mePerson().name} · ${senName(mePerson().seniorityId)}`),
    photoPicker(mePerson()),
    notifBlock(),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn', onclick: openAccount }, "PIN'imi değiştir"),
      h('button', { class: 'btn danger-ghost', onclick: logout }, 'Çıkış yap'),
    ),
  );
  if (!canManage()) {
    return h('section', {}, accountBlock, themeBlock(), h('p', { class: 'muted small' }, 'Görev türleri, kıdemler ve ekip ayarlarını yalnızca başasistan değiştirebilir.'), connBlock);
  }
  return h('section', {},
    accountBlock,
    themeBlock(),
    editableList('Görev türleri', s.taskTypes, {
      addPlaceholder: 'ör. Konsültasyon',
      onRename: (t, name) => update((st) => ({ ...st, taskTypes: st.taskTypes.map((x) => (x.id === t.id ? { ...x, name } : x)) }), 'Kaydedildi'),
      onDelete: async (t) => {
        if (!(await askConfirm(`"${t.name}" görev türü silinsin mi? Geçmiş kayıtlar kalır.`, 'Sil'))) return;
        update((st) => ({ ...st, taskTypes: st.taskTypes.filter((x) => x.id !== t.id) }), 'Silindi');
      },
      onAdd: (name) => update((st) => ({ ...st, taskTypes: [...st.taskTypes, { id: uid(), name }] }), `${name} eklendi`),
    }),
    recurringBlock(),
    editableList('Kıdemler (en kıdemliden en yeniye)', s.seniorities, {
      addPlaceholder: 'ör. 6. kıdem',
      onRename: (x, name) => update((st) => ({ ...st, seniorities: st.seniorities.map((y) => (y.id === x.id ? { ...y, name } : y)) }), 'Kaydedildi'),
      onDelete: async (x) => {
        if (queueOf(s, x.id).length) return toast('Bu kıdemde kişiler var; önce onları taşıyın.');
        if (!(await askConfirm(`"${x.name}" silinsin mi?`, 'Sil'))) return;
        update((st) => ({ ...st, seniorities: st.seniorities.filter((y) => y.id !== x.id) }), 'Silindi');
      },
      onAdd: (name) => update((st) => ({ ...st, seniorities: [...st.seniorities, { id: uid(), name }] }), `${name} eklendi`),
    }),
    h('div', { class: 'settings-block' },
      h('h2', {}, 'Yeni dönem'),
      h('p', { class: 'muted small' }, 'Herkesi bir üst kıdeme geçirir (ör. 5. kıdem → 4. kıdem). Listenin en üstündekiler (başasistan) ekipten çıkar ve tüm sıralar baştan başlar. Yeni gelenleri sonra ekleyin.'),
      h('button', { class: 'btn', onclick: async () => {
        if (!(await askConfirm('Herkes bir üst kıdeme geçirilsin mi? Başasistan kıdemindekiler ekipten çıkarılacak.', 'Geçir'))) return;
        update(promoteAll, 'Kıdemler güncellendi');
      } }, 'Herkesi bir üst kıdeme geçir'),
    ),
    h('div', { class: 'settings-block' },
      h('h2', {}, 'Yedek'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn', onclick: exportJson }, 'Dışa aktar (JSON)'),
        h('label', { class: 'btn' }, 'İçe aktar', h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: importJson })),
      ),
    ),
    connBlock,
  );
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
  return h('div', { class: 'empty' },
    h('p', { class: 'lead' }, '🔒 Devam etmek için giriş yap.'),
    h('p', {}, setupMode()
      ? 'İlk kurulum: başasistan adını seçip kendine bir PIN belirlemeli. Diğerlerinin PIN\'lerini sonra o atayacak.'
      : 'Adını seç ve başasistanın sana verdiği PIN\'i gir.'),
    h('button', { class: 'btn primary', onclick: openLogin }, 'Giriş yap'),
  );
}

function pinInput(name, placeholder, required = true) {
  return h('input', { name, type: 'password', inputmode: 'numeric', pattern: '[0-9]{4,6}', minlength: '4', maxlength: '6', placeholder, autocomplete: 'off', required, title: '4–6 rakam' });
}

function openLogin() {
  const s = S();
  const info = h('p', { class: 'muted small' });
  const pin = pinInput('pin', 'PIN');
  const pin2 = pinInput('pin2', 'PIN (tekrar)', false);
  const pin2Wrap = h('div', { class: 'field' }, pin2);
  const select = h('select', { name: 'who', required: true, 'aria-label': 'Adın', onchange: () => sync() },
    h('option', { value: '' }, '— Adını seç —'),
    s.seniorities.map((x) => {
      const q = queueOf(s, x.id);
      return q.length ? h('optgroup', { label: x.name }, q.map((p) => h('option', { value: p.id }, p.name))) : null;
    }),
  );
  function sync() {
    const p = S().people.find((x) => x.id === select.value);
    const bootstrap = !!p && !p.pinHash && p.seniorityId === adminSenId() && setupMode();
    pin2Wrap.hidden = !bootstrap;
    pin2.required = bootstrap;
    pin.disabled = !!p && !p.pinHash && !bootstrap;
    info.textContent = !p ? 'Adını seç ve PIN\'ini gir.'
      : bootstrap ? 'İlk kurulum: kendine 4–6 haneli bir PIN belirle. Diğerlerinin PIN\'lerini Ekip sekmesinden sen atayacaksın.'
      : !p.pinHash ? 'Henüz PIN\'in yok. Başasistandan PIN iste.'
      : 'PIN\'ini gir.';
  }
  sync();
  openDialog('Giriş', h('div', { class: 'form-grid' }, select, pin, pin2Wrap, info), {
    submitText: 'Giriş',
    onSubmit: async (fd) => {
      const p = S().people.find((x) => x.id === fd.get('who'));
      if (!p) return false;
      if (Date.now() < pinLockedUntil) {
        toast(`Çok fazla yanlış deneme. ${Math.ceil((pinLockedUntil - Date.now()) / 1000)} sn bekle.`);
        return false;
      }
      const pinV = fd.get('pin') || '';
      if (!PIN_RE.test(pinV)) { toast('PIN 4–6 rakamdan oluşmalı.'); return false; }
      const hash = await hashPin(p.id, pinV);
      if (!p.pinHash) {
        if (!(p.seniorityId === adminSenId() && setupMode())) { toast('Henüz PIN\'in yok; başasistandan iste.'); return false; }
        if (pinV !== fd.get('pin2')) { toast('PIN\'ler aynı değil.'); return false; }
        const r = await run((st) => {
          if (st.people.some((x) => x.seniorityId === st.seniorities[0]?.id && x.pinHash)) throw new Error('Başasistan PIN\'i zaten belirlenmiş.');
          return { state: { ...st, people: st.people.map((x) => (x.id === p.id ? { ...x, pinHash: hash } : x)) } };
        });
        if (!r) return false;
      } else if (hash !== p.pinHash) {
        pinFails += 1;
        if (pinFails >= 5) { pinLockedUntil = Date.now() + 30000; pinFails = 0; }
        toast('PIN yanlış.');
        return false;
      }
      pinFails = 0;
      saveSession({ personId: p.id, pinHash: hash });
      render();
      toast(`Hoş geldin, ${p.name}`);
      setTimeout(checkRecurring, 500);
    },
  });
}

/** Bu cihazdaki oturumu kapatır. Tekrar girmek için PIN gerekir. */
async function logout() {
  if (dlg.open) dlg.close();
  const mp = mePerson();
  if (!(await askConfirm(`${mp ? mp.name + ' olarak açık oturum' : 'Oturum'} bu cihazda kapatılsın mı? Tekrar girmek için PIN gerekir.`, 'Çıkış yap'))) return;
  if (mp?.push?.[deviceId()]) { await removePushToken(mp.id); backend.deletePushToken(); }
  saveSession(null);
  tab = 'give';
  render();
  toast('Oturum kapatıldı');
}

/** Kendi PIN'ini değiştirme. Başka biri olarak işlem yapmak mümkün değil; oturum bu kişiye bağlı. */
function openAccount() {
  const mp = mePerson();
  if (!mp) return openLogin();
  const body = h('div', { class: 'form-grid' },
    h('p', {}, h('strong', {}, mp.name), ` · ${senName(mp.seniorityId)}`),
    photoPicker(mp),
    notifBlock(),
    h('p', { class: 'muted small' }, 'PIN\'ini değiştirmek için mevcut PIN\'ini gir.'),
    pinInput('old', 'Mevcut PIN'),
    pinInput('new1', 'Yeni PIN'),
    pinInput('new2', 'Yeni PIN (tekrar)'),
  );
  openDialog('Hesabım', body, {
    extra: [h('button', { type: 'button', class: 'btn danger-ghost', onclick: logout }, 'Çıkış yap'), h('button', { type: 'button', class: 'btn', onclick: () => openProfile(mp.id) }, 'Profilim')],
    submitText: 'PIN\'i değiştir',
    onSubmit: async (fd) => {
      const me = mePerson();
      if (!me) return;
      if ((await hashPin(me.id, fd.get('old'))) !== me.pinHash) { toast('Mevcut PIN yanlış.'); return false; }
      if (fd.get('new1') !== fd.get('new2')) { toast('Yeni PIN\'ler aynı değil.'); return false; }
      const hash = await hashPin(me.id, fd.get('new1'));
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
  const input = h('input', { name: 'pin', inputmode: 'numeric', pattern: '[0-9]{4,6}', minlength: '4', maxlength: '6', required: true, value: suggested, autocomplete: 'off', class: 'pin-show' });
  const body = h('div', { class: 'form-grid' },
    h('p', {}, h('strong', {}, p.name), p.pinHash ? ' için yeni PIN. Eski PIN geçersiz olur ve açık oturumu kapanır.' : ' için PIN.'),
    input,
    h('small', { class: 'muted' }, 'Bu PIN\'i kişiye kendin ilet. Kaydettikten sonra bir daha gösterilmez.'),
  );
  openDialog('PIN ata', body, {
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
document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
document.getElementById('me-btn').addEventListener('click', () => (data && mePerson() ? openAccount() : data && S().people.length ? openLogin() : null));

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* yoksay */ });
}

function applyHash() {
  if (location.hash === '#gorevlerim') tab = 'mine';
}
applyHash();
window.addEventListener('hashchange', () => { applyHash(); render(); });

(async function start() {
  const conn = document.getElementById('conn');
  try {
    backend = await createBackend(firebaseConfig, teamId);
  } catch (err) {
    console.error(err);
    view.replaceChildren(navigator.onLine === false
      ? empty('📡 İnternet bağlantısı yok. Bağlantı gelince sayfayı yenileyin.', 'Yenile', () => location.reload())
      : empty('Firebase\'e bağlanılamadı: ' + err.message + ' — internet bağlantısını kontrol edip sayfayı yenileyin.', 'Yenile', () => location.reload()));
    conn.textContent = '⚠️ Bağlantı hatası';
    return;
  }
  conn.textContent = backend.kind === 'firebase' ? '● Ortak (canlı)' : '● Yerel mod';
  conn.classList.toggle('live', backend.kind === 'firebase');
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
