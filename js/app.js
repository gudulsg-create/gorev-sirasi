import { firebaseConfig, teamId } from './firebase-config.js';
import { createBackend } from './backend.js';
import { assign, cancel, passOn, nextPerson, queueOf, addPerson, movePerson, changeSeniority, promoteAll, defaultState, allowedSeniorities } from './rotation.js';

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
  return run((s) => ({ state: mutator(s) })).then((r) => r && msg && toast(msg));
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
  const views = { give: giveView, history: historyView, team: teamView, settings: settingsView };
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
    h('p', { class: 'lead' }, 'Vermek istediğin görevi seç:'),
    h('div', { class: 'type-grid' },
      s.taskTypes.map((t) => h('button', { class: 'type-btn', onclick: () => chooseSeniority(t) }, t.name)),
    ),
    h('h2', {}, 'Sıradakiler'),
    nextTable(),
    recent.length ? h('h2', {}, 'Son verilenler') : null,
    recent.length ? h('ul', { class: 'asg-list' }, recent.map((a) => assignmentItem(a, { compact: true }))) : null,
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
  const allowed = allowedSeniorities(s, mePerson()?.id);
  const list = h('div', { class: 'sen-list' },
    s.seniorities.map((x) => {
      const next = nextPerson(s, type.id, x.id);
      const ok = allowed.includes(x.id);
      return h('button', {
        type: 'button',
        class: 'sen-btn',
        disabled: !next || !ok,
        onclick: () => give(type, x, note.value.trim()),
      },
        h('strong', {}, x.name),
        h('span', { class: 'sen-next' }, ok && next ? avatar(next, 24) : null, !ok ? 'Üst / aynı kıdem' : next ? `Sıradaki: ${next.name}` : 'Müsait kimse yok'),
      );
    }),
  );
  openDialog(`${type.name}`, h('div', { class: 'form-grid' },
    h('p', { class: 'muted' }, allowed.length ? 'Hangi kıdeme verilsin?' : 'Senin altında görev verebileceğin bir kıdem yok.'),
    list,
    note,
    h('small', { class: 'muted' }, 'Kişisel sağlık verisi (hasta adı, TC no vb.) yazmayın.'),
  ));
}

async function give(type, sen, note) {
  const mp = mePerson();
  if (!mp) {
    dlg.close();
    return openLogin();
  }
  if (!allowedSeniorities(S(), mp.id).includes(sen.id)) return toast('Yalnızca alt kıdemlere görev verebilirsin.');
  const r = await run((state) => {
    const out = assign(state, type.id, sen.id, { id: uid(), by: mp.name, byId: mp.id, note });
    return { state: out.state, add: out.assignment };
  });
  if (!r) return;
  showResult(r.add);
}

function showResult(a) {
  const body = h('div', { class: 'result' },
    h('div', { class: 'result-photo' }, avatar(a.personId, 96), h('span', { class: 'result-check' }, '✓')),
    h('p', { class: 'result-name' }, a.personName),
    h('p', { class: 'muted' }, `${a.typeName} · ${a.seniorityName}`),
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
    return { state: out.state, patch: out.patch, restored: out.restored };
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
  if (fromResult) showResult(r.updated);
  else toast(`Görev ${r.updated.personName} kişisine aktarıldı.`);
}

async function toggleDone(a) {
  if (!canToggleDone(a)) return toast('Bunu yalnızca görevi alan, veren ya da başasistan değiştirebilir.');
  await run(() => ({ patch: { status: a.status === 'tamamlandı' ? 'aktif' : 'tamamlandı' } }), { assignmentId: a.id });
}

function assignmentItem(a, { compact = false } = {}) {
  const status = { aktif: 'Verildi', tamamlandı: 'Tamamlandı', iptal: 'İptal' }[a.status] ?? a.status;
  return h('li', { class: `asg ${a.status === 'iptal' ? 'cancelled' : ''}` },
    h('div', { class: 'asg-main' },
      h('div', { class: 'asg-title' }, h('span', { class: 'asg-who' }, avatar(a.personId, 28), h('strong', {}, a.personName)), h('span', { class: `badge s-${a.status}` }, status)),
      h('span', {}, `${a.typeName} · ${a.seniorityName}`),
      h('span', { class: 'muted small' }, `${fmtDate(a.createdAt)}${a.by ? ' · veren: ' + a.by : ''}`),
      a.skipped?.length ? h('span', { class: 'muted small' }, `↪ ${a.skipped.map((x) => x.personName).join(', ')} yerine aktarıldı`) : null,
      a.note ? h('span', { class: 'note' }, a.note) : null,
    ),
    !compact && a.status !== 'iptal' && (canToggleDone(a) || canPassOn(a) || isAdmin()) && h('div', { class: 'asg-actions' },
      canToggleDone(a) && h('button', { class: 'btn small', onclick: () => toggleDone(a) }, a.status === 'tamamlandı' ? 'Geri aç' : 'Tamamlandı'),
      a.status === 'aktif' && canPassOn(a) && h('button', { class: 'btn small', onclick: () => doPassOn(a) }, 'Aktar'),
      isAdmin() && h('button', { class: 'btn small danger-ghost', onclick: () => doCancel(a) }, 'İptal'),
    ),
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
    h('strong', {}, p.name, p.active === false ? h('span', { class: 'badge s-iptal', style: 'margin-left:6px' }, 'İzinli') : null),
    h('span', { class: 'muted small' }, summary || 'Henüz görev yok'),
  );
  if (!manage) return h('li', { class: `person ${p.active === false ? 'away' : ''}` }, avatar(p, 36), main);
  return h('li', { class: `person ${p.active === false ? 'away' : ''}` },
    avatar(p, 36),
    main,
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

function editPerson(p) {
  const s = S();
  const body = h('div', { class: 'form-grid' },
    photoPicker(p),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Ad soyad'), h('input', { name: 'name', required: true, maxlength: '60', value: p.name })),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Kıdem'),
      h('select', { name: 'sen' }, s.seniorities.map((x) => h('option', { value: x.id, selected: x.id === p.seniorityId }, x.name)))),
    h('small', { class: 'muted' }, 'Kıdemi değişen kişi yeni kıdeminin sırasının sonuna eklenir.'),
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
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn', onclick: openAccount }, "PIN'imi değiştir"),
      h('button', { class: 'btn danger-ghost', onclick: logout }, 'Çıkış yap'),
    ),
  );
  if (!canManage()) {
    return h('section', {}, accountBlock, h('p', { class: 'muted small' }, 'Görev türleri, kıdemler ve ekip ayarlarını yalnızca başasistan değiştirebilir.'), connBlock);
  }
  return h('section', {},
    accountBlock,
    editableList('Görev türleri', s.taskTypes, {
      addPlaceholder: 'ör. Konsültasyon',
      onRename: (t, name) => update((st) => ({ ...st, taskTypes: st.taskTypes.map((x) => (x.id === t.id ? { ...x, name } : x)) }), 'Kaydedildi'),
      onDelete: async (t) => {
        if (!(await askConfirm(`"${t.name}" görev türü silinsin mi? Geçmiş kayıtlar kalır.`, 'Sil'))) return;
        update((st) => ({ ...st, taskTypes: st.taskTypes.filter((x) => x.id !== t.id) }), 'Silindi');
      },
      onAdd: (name) => update((st) => ({ ...st, taskTypes: [...st.taskTypes, { id: uid(), name }] }), `${name} eklendi`),
    }),
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
    },
  });
}

/** Bu cihazdaki oturumu kapatır. Tekrar girmek için PIN gerekir. */
async function logout() {
  if (dlg.open) dlg.close();
  const mp = mePerson();
  if (!(await askConfirm(`${mp ? mp.name + ' olarak açık oturum' : 'Oturum'} bu cihazda kapatılsın mı? Tekrar girmek için PIN gerekir.`, 'Çıkış yap'))) return;
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
    h('p', { class: 'muted small' }, 'PIN\'ini değiştirmek için mevcut PIN\'ini gir.'),
    pinInput('old', 'Mevcut PIN'),
    pinInput('new1', 'Yeni PIN'),
    pinInput('new2', 'Yeni PIN (tekrar)'),
  );
  openDialog('Hesabım', body, {
    extra: [h('button', { type: 'button', class: 'btn danger-ghost', onclick: logout }, 'Çıkış yap')],
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

(async function start() {
  const conn = document.getElementById('conn');
  try {
    backend = await createBackend(firebaseConfig, teamId);
  } catch (err) {
    console.error(err);
    view.replaceChildren(empty('Firebase\'e bağlanılamadı: ' + err.message + ' — firebase-config.js ayarlarını ve internet bağlantısını kontrol edin.'));
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
  });
})();
