// Sıra (rotasyon) mantığı — saf fonksiyonlar; tarayıcıda ve Node testlerinde çalışır.
// Her (görev türü, kıdem) çifti için ayrı bir sıra tutulur. Sıra göstergesi (pointer),
// en son görev verilen kişinin "order" değerini saklar; sıradaki kişi, o kıdemde
// order değeri daha büyük olan ilk müsait kişidir (yoksa başa dönülür).

export function defaultState() {
  return {
    version: 1,
    // En kıdemliden en yeniye doğru sıralı. Görevler listede aşağıdaki kıdemlere verilir.
    seniorities: [
      { id: 'bas', name: 'Başasistan' },
      ...[2, 3, 4, 5].map((n) => ({ id: `k${n}`, name: `${n}. kıdem` })),
    ],
    taskTypes: [
      { id: 'patoloji', name: 'Patoloji yazmak' },
      { id: 'orneklem', name: 'Örneklem yazmak' },
      { id: 'kitap', name: 'Kitap uzatmak' },
    ],
    people: [],
    pointers: {},
  };
}

export const queueKey = (typeId, seniorityId) => `${typeId}|${seniorityId}`;

/** Bir kıdemdeki herkes (müsait olmayanlar dahil), sıra düzeninde. */
export function queueOf(state, seniorityId) {
  return state.people.filter((p) => p.seniorityId === seniorityId).sort((a, b) => a.order - b.order);
}

/** Sıradaki müsait kişi. `after` verilirse o göstergeden sonrakini döndürür. */
export function nextPerson(state, typeId, seniorityId, after) {
  const q = queueOf(state, seniorityId).filter((p) => p.active !== false);
  if (!q.length) return null;
  const ptr = after === undefined ? state.pointers[queueKey(typeId, seniorityId)] : after;
  if (!ptr) return q[0];
  return q.find((p) => p.order > ptr.order) ?? q[0];
}

const samePtr = (a, b) => !!a && !!b && a.personId === b.personId && a.order === b.order;

/** Görevi sıradaki kişiye verir. Yeni durum ve kayıt döner; girdi değiştirilmez. */
export function assign(state, typeId, seniorityId, { id, by = '', byId = null, note = '', now = Date.now() } = {}) {
  const type = state.taskTypes.find((t) => t.id === typeId);
  const sen = state.seniorities.find((s) => s.id === seniorityId);
  if (!type || !sen) throw new Error('Görev türü veya kıdem bulunamadı.');
  const person = nextPerson(state, typeId, seniorityId);
  if (!person) throw new Error(`${sen.name} için müsait kimse yok.`);
  const key = queueKey(typeId, seniorityId);
  const pointer = { personId: person.id, order: person.order };
  return {
    state: { ...state, pointers: { ...state.pointers, [key]: pointer } },
    assignment: {
      id: id ?? `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      typeId,
      typeName: type.name,
      seniorityId,
      seniorityName: sen.name,
      personId: person.id,
      personName: person.name,
      by,
      byId,
      note,
      createdAt: now,
      status: 'aktif',
      skipped: [],
      prevPointer: state.pointers[key] ?? null,
      pointer,
    },
  };
}

/**
 * Görevi iptal eder. Bu sırada daha sonra başka görev verilmediyse sıra göstergesi
 * geri alınır, yani aynı kişi yine sıradaki olur.
 */
export function cancel(state, a) {
  if (a.status === 'iptal') throw new Error('Bu görev zaten iptal edilmiş.');
  const key = queueKey(a.typeId, a.seniorityId);
  const restore = a.status === 'aktif' && samePtr(state.pointers[key], a.pointer);
  let pointers = state.pointers;
  if (restore) {
    pointers = { ...state.pointers };
    if (a.prevPointer) pointers[key] = a.prevPointer;
    else delete pointers[key];
  }
  return { state: { ...state, pointers }, patch: { status: 'iptal' }, restored: restore };
}

/**
 * Görevi alan kişi müsait değilse görevi sıradaki kişiye aktarır.
 * Yalnızca bu sırada verilen en son görev için yapılabilir.
 */
export function passOn(state, a) {
  if (a.status !== 'aktif') throw new Error('Yalnızca aktif görevler aktarılabilir.');
  const key = queueKey(a.typeId, a.seniorityId);
  if (!samePtr(state.pointers[key], a.pointer)) {
    throw new Error('Bu sırada daha sonra başka görev verilmiş; aktarma yapılamaz. Görevi iptal edip yeniden verebilirsiniz.');
  }
  const next = nextPerson(state, a.typeId, a.seniorityId, a.pointer);
  if (!next || next.id === a.personId) throw new Error('Sırada başka müsait kişi yok.');
  const pointer = { personId: next.id, order: next.order };
  return {
    state: { ...state, pointers: { ...state.pointers, [key]: pointer } },
    patch: {
      personId: next.id,
      personName: next.name,
      pointer,
      skipped: [...(a.skipped || []), { personId: a.personId, personName: a.personName }],
    },
    person: next,
  };
}

/** Yeni kişi ekler; kişi kendi kıdeminin sırasının sonuna girer. */
export function addPerson(state, { id, name, seniorityId }) {
  const order = state.people.reduce((m, p) => Math.max(m, p.order), 0) + 1;
  return { ...state, people: [...state.people, { id, name, seniorityId, order, active: true, pinHash: null, photo: null }] };
}

/** Kişiyi kendi kıdem sırasında bir yukarı (-1) veya aşağı (+1) taşır. */
export function movePerson(state, personId, dir) {
  const p = state.people.find((x) => x.id === personId);
  if (!p) return state;
  const q = queueOf(state, p.seniorityId);
  const i = q.findIndex((x) => x.id === personId);
  const other = q[i + dir];
  if (!other) return state;
  return {
    ...state,
    people: state.people.map((x) =>
      x.id === p.id ? { ...x, order: other.order } : x.id === other.id ? { ...x, order: p.order } : x,
    ),
  };
}

/** Kişinin kıdemini değiştirir; yeni kıdem sırasının sonuna girer. */
export function changeSeniority(state, personId, seniorityId) {
  const order = state.people.reduce((m, p) => Math.max(m, p.order), 0) + 1;
  return { ...state, people: state.people.map((p) => (p.id === personId && p.seniorityId !== seniorityId ? { ...p, seniorityId, order } : p)) };
}

/** Bir kişinin görev verebileceği kıdemler: kendi kıdeminin altındakiler. Kişi ekipte değilse hepsi. */
export function allowedSeniorities(state, giverId) {
  const giver = giverId && state.people.find((p) => p.id === giverId);
  if (!giver) return state.seniorities.map((s) => s.id);
  const idx = state.seniorities.findIndex((s) => s.id === giver.seniorityId);
  return state.seniorities.slice(idx + 1).map((s) => s.id);
}

/**
 * Yeni dönem: herkes bir üst kıdeme geçer (listede bir yukarı).
 * Listenin en üstündekiler (ör. başasistan) ekipten çıkar; tüm sıralar baştan başlar.
 */
export function promoteAll(state) {
  const ids = state.seniorities.map((s) => s.id);
  const people = state.people
    .map((p) => ({ ...p, seniorityId: ids[ids.indexOf(p.seniorityId) - 1] }))
    .filter((p) => p.seniorityId);
  return { ...state, people, pointers: {} };
}
