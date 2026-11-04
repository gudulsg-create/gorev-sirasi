import { firebaseConfig, teamId } from './firebase-config.js';
import { createBackend } from './backend.js';
import { assign, cancel, passOn, nextPerson, queueOf, addPerson, movePerson, changeSeniority, promoteAll, defaultState, allowedSeniorities } from './rotation.js';

// ---------- Durum ----------
let backend;
let data = null; // { state, assignments }
let tab = 'give';
let historyFilter = 'all';
const ME_KEY = 'gorev-sirasi:me';
const ME_ID_KEY = 'gorev-sirasi:me-id';
let me = '';
let meId = '';
try {
  me = localStorage.getItem(ME_KEY) || '';
  meId = localStorage.getItem(ME_ID_KEY) || '';
} catch { /* yoksay */ }
/** Ekipteki kaydım (varsa). */
const mePerson = () => (data && meId ? S().people.find((p) => p.id === meId) : null);

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
const update = (mutator, msg) => run((s) => ({ state: mutator(s) })).then((r) => r && msg && toast(msg));

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
  const mp = mePerson();
  document.getElementById('me-btn').textContent = mp ? `👤 ${mp.name} · ${senName(mp.seniorityId)}` : me ? `👤 ${me}` : '👤 Ben kimim?';
  if (!data) return;
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
        sens.map((x) => h('td', {}, nextPerson(s, t.id, x.id)?.name ?? h('span', { class: 'muted' }, '—'))),
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
        h('span', {}, !ok ? 'Üst / aynı kıdem' : next ? `Sıradaki: ${next.name}` : 'Müsait kimse yok'),
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
  if (!me) {
    dlg.close();
    await askName();
    if (!me) return;
  }
  if (!allowedSeniorities(S(), mePerson()?.id).includes(sen.id)) return toast('Yalnızca alt kıdemlere görev verebilirsin.');
  const r = await run((state) => {
    const out = assign(state, type.id, sen.id, { id: uid(), by: mePerson()?.name ?? me, note });
    return { state: out.state, add: out.assignment };
  });
  if (!r) return;
  showResult(r.add);
}

function showResult(a) {
  const body = h('div', { class: 'result' },
    h('div', { class: 'result-icon' }, '✓'),
    h('p', { class: 'result-name' }, a.personName),
    h('p', { class: 'muted' }, `${a.typeName} · ${a.seniorityName}`),
    a.skipped?.length ? h('p', { class: 'muted small' }, `Aktarıldı: ${a.skipped.map((x) => x.personName).join(', ')} yerine`) : null,
  );
  openDialog(null, body, {
    cancelText: 'Tamam',
    cancelPrimary: true,
    extra: [
      h('button', { type: 'button', class: 'btn danger-ghost', onclick: () => doCancel(a, true) }, 'Geri al'),
      h('button', { type: 'button', class: 'btn', onclick: () => doPassOn(a, true) }, 'Sonrakine aktar'),
    ],
  });
}

async function doCancel(a, fromResult = false) {
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
  await run(() => ({ patch: { status: a.status === 'tamamlandı' ? 'aktif' : 'tamamlandı' } }), { assignmentId: a.id });
}

function assignmentItem(a, { compact = false } = {}) {
  const status = { aktif: 'Verildi', tamamlandı: 'Tamamlandı', iptal: 'İptal' }[a.status] ?? a.status;
  return h('li', { class: `asg ${a.status === 'iptal' ? 'cancelled' : ''}` },
    h('div', { class: 'asg-main' },
      h('div', { class: 'asg-title' }, h('strong', {}, a.personName), h('span', { class: `badge s-${a.status}` }, status)),
      h('span', {}, `${a.typeName} · ${a.seniorityName}`),
      h('span', { class: 'muted small' }, `${fmtDate(a.createdAt)}${a.by ? ' · veren: ' + a.by : ''}`),
      a.skipped?.length ? h('span', { class: 'muted small' }, `↪ ${a.skipped.map((x) => x.personName).join(', ')} yerine aktarıldı`) : null,
      a.note ? h('span', { class: 'note' }, a.note) : null,
    ),
    !compact && a.status !== 'iptal' && h('div', { class: 'asg-actions' },
      h('button', { class: 'btn small', onclick: () => toggleDone(a) }, a.status === 'tamamlandı' ? 'Geri aç' : 'Tamamlandı'),
      a.status === 'aktif' && h('button', { class: 'btn small', onclick: () => doPassOn(a) }, 'Aktar'),
      h('button', { class: 'btn small danger-ghost', onclick: () => doCancel(a) }, 'İptal'),
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

  return h('section', {},
    h('h2', {}, 'Asistan ekle'),
    form,
    s.seniorities.map((x) => {
      const q = queueOf(s, x.id);
      return h('div', { class: 'sen-group' },
        h('h2', {}, `${x.name} `, h('span', { class: 'muted' }, `(${q.length})`)),
        q.length ? h('ul', { class: 'people' }, q.map((p, i) => personRow(p, i, q.length))) : h('p', { class: 'muted small' }, 'Bu kıdemde kimse yok.'),
      );
    }),
    h('p', { class: 'hint' }, 'Sıra yukarıdan aşağıya ilerler. "İzinli" işaretlenen kişi, işaret kaldırılana kadar tüm sıralarda atlanır.'),
  );
}

function personRow(p, i, n) {
  const c = countsFor(p.id);
  const summary = S().taskTypes.map((t) => c[t.id] ? `${t.name.split(' ')[0]} ${c[t.id]}` : null).filter(Boolean).join(' · ');
  return h('li', { class: `person ${p.active === false ? 'away' : ''}` },
    h('div', { class: 'person-main' },
      h('strong', {}, p.name),
      h('span', { class: 'muted small' }, summary || 'Henüz görev yok'),
    ),
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
  return h('section', {},
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
    h('div', { class: 'settings-block' },
      h('h2', {}, 'Bağlantı'),
      backend.kind === 'firebase'
        ? h('p', {}, `✅ Firebase'e bağlı (ekip: ${teamId}). Değişiklikler herkese anında yansır.`)
        : h('p', {}, '📱 Yerel mod: veriler yalnızca bu cihazda. Ekipçe ortak sıra için README\'deki Firebase kurulumunu yapın.'),
    ),
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
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const ok = parsed?.state && Array.isArray(parsed.state.people) && Array.isArray(parsed.state.taskTypes) && Array.isArray(parsed.state.seniorities);
    if (!ok) throw new Error('Dosya bu uygulamaya ait görünmüyor.');
    if (!(await askConfirm('Mevcut verinin yerine dosyadaki veri yüklensin mi?', 'Yükle'))) return;
    await backend.replaceAll({ state: { ...defaultState(), ...parsed.state }, assignments: parsed.assignments || [] });
    toast('İçe aktarıldı');
    if (!mePerson() && S().people.length) setTimeout(askName, 300);
  } catch (err) {
    toast('Dosya okunamadı: ' + err.message);
  }
}

// ---------- Ben kimim ----------
function askName() {
  return new Promise((resolve) => {
    const people = data ? S().people : [];
    const custom = h('input', { name: 'me', maxlength: '40', value: mePerson() ? '' : me, placeholder: 'Adın (ör. Dr. Elif K.)', autocomplete: 'name' });
    const customWrap = h('div', { class: 'field' }, custom);
    const select = people.length && h('select', { name: 'who', 'aria-label': 'Ekipteki adın', onchange: () => {
      customWrap.hidden = select.value !== '__other';
      custom.required = select.value === '__other';
    } },
      h('option', { value: '' }, '— Seç —'),
      S().seniorities.map((x) => {
        const q = queueOf(S(), x.id);
        return q.length ? h('optgroup', { label: x.name }, q.map((p) => h('option', { value: p.id, selected: p.id === meId }, p.name))) : null;
      }),
      h('option', { value: '__other', selected: !!me && !mePerson() }, 'Listede yokum (hoca vb.)'),
    );
    if (select) {
      select.required = true;
      customWrap.hidden = select.value !== '__other';
      custom.required = select.value === '__other';
    } else custom.required = true;
    const body = h('div', { class: 'form-grid' },
      h('p', { class: 'muted' }, 'Verdiğin görevlerde "veren" olarak görünür ve yalnızca senin altındaki kıdemlere görev verebilmeni sağlar. Bu cihazda saklanır.'),
      select || null,
      customWrap,
    );
    openDialog('Ben kimim?', body, {
      onSubmit: (fd) => {
        const who = fd.get('who');
        const person = who && who !== '__other' ? S().people.find((p) => p.id === who) : null;
        meId = person ? person.id : '';
        me = person ? person.name : (fd.get('me') || '').trim();
        if (!me) return false;
        try {
          localStorage.setItem(ME_KEY, me);
          localStorage.setItem(ME_ID_KEY, meId);
        } catch { /* yoksay */ }
        render();
      },
    });
    dlg.addEventListener('close', () => resolve(me), { once: true });
  });
}

// ---------- Başlat ----------
document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
document.getElementById('me-btn').addEventListener('click', askName);

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
      if (!me && S().people.length) setTimeout(askName, 0);
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
