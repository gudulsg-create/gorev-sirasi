// Veri katmanı: aynı arayüzle iki uygulama.
//  - Yerel: localStorage (tek cihaz, Firebase ayarlanmadıysa)
//  - Firebase: Firestore (ekipçe ortak, gerçek zamanlı; sıra işlemleri transaction ile atomik)
//
// Arayüz:
//   subscribe(cb)  -> cb({ state, assignments }) her değişiklikte çağrılır
//   transact(fn, { assignmentId }) -> fn(state, assignment|null) => { state?, add?, patch? }
//      fn bir işlem (transaction) içinde en güncel veriyle çalışır; iki kişi aynı anda
//      görev verirse Firestore işlemi yeniden dener, böylece aynı kişiye iki kez düşmez.

import { defaultState } from './rotation.js';

const MAX_HISTORY = 300;

export async function createBackend(firebaseConfig, teamId) {
  if (firebaseConfig && firebaseConfig.projectId) return createFirebaseBackend(firebaseConfig, teamId);
  return createLocalBackend(teamId);
}

// ---------------- Yerel ----------------
function createLocalBackend(teamId) {
  const key = `gorev-sirasi:${teamId}`;
  let data = { state: defaultState(), assignments: [] };
  try {
    const raw = localStorage.getItem(key);
    if (raw) data = JSON.parse(raw);
  } catch {
    /* depolama kapalı: bellekte çalış */
  }
  const listeners = new Set();
  const emit = () => listeners.forEach((cb) => cb(structuredClone(data)));
  const persist = () => {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch {
      /* yoksay */
    }
  };
  return {
    kind: 'local',
    async getPushToken() { return null; },
    async deletePushToken() {},
    subscribe(cb) {
      listeners.add(cb);
      cb(structuredClone(data));
      return () => listeners.delete(cb);
    },
    async transact(fn, { assignmentId } = {}) {
      const current = assignmentId ? data.assignments.find((a) => a.id === assignmentId) ?? null : null;
      const out = fn(structuredClone(data.state), current && structuredClone(current)) || {};
      if (out.state) data.state = out.state;
      if (out.add) data.assignments = [out.add, ...data.assignments].slice(0, MAX_HISTORY);
      if (out.patch && assignmentId) {
        data.assignments = data.assignments.map((a) => (a.id === assignmentId ? { ...a, ...out.patch } : a));
      }
      persist();
      emit();
      return out;
    },
    async replaceAll(next) {
      data = { state: next.state, assignments: (next.assignments || []).slice(0, MAX_HISTORY) };
      persist();
      emit();
    },
  };
}

// ---------------- Firebase ----------------
const CDN = 'https://www.gstatic.com/firebasejs/10.12.2';

async function createFirebaseBackend(config, teamId) {
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-firestore.js`),
  ]);
  const app = initializeApp(config);
  await auth.signInAnonymously(auth.getAuth(app));
  const db = fs.getFirestore(app);
  const teamRef = fs.doc(db, 'teams', teamId);
  const asgCol = fs.collection(teamRef, 'assignments');

  // Ekip belgesi yoksa varsayılanla oluştur.
  await fs.runTransaction(db, async (tx) => {
    const snap = await tx.get(teamRef);
    if (!snap.exists()) tx.set(teamRef, defaultState());
  });

  let messaging = null;
  async function getMessagingMod() {
    const m = await import(`${CDN}/firebase-messaging.js`);
    if (!(await m.isSupported())) throw new Error('Bu tarayıcı bildirimleri desteklemiyor.');
    messaging = messaging || m.getMessaging(app);
    return m;
  }
  return {
    kind: 'firebase',
    async getPushToken(serviceWorkerRegistration, vapidKey) {
      const m = await getMessagingMod();
      return m.getToken(messaging, { vapidKey, serviceWorkerRegistration });
    },
    async deletePushToken() {
      try {
        const m = await getMessagingMod();
        await m.deleteToken(messaging);
      } catch { /* yoksay */ }
    },
    subscribe(cb) {
      let state = null;
      let assignments = null;
      const emit = () => state && assignments && cb({ state, assignments });
      const u1 = fs.onSnapshot(teamRef, (snap) => {
        state = snap.exists() ? snap.data() : defaultState();
        emit();
      });
      const q = fs.query(asgCol, fs.orderBy('createdAt', 'desc'), fs.limit(MAX_HISTORY));
      const u2 = fs.onSnapshot(q, (snap) => {
        assignments = snap.docs.map((d) => d.data());
        emit();
      });
      return () => {
        u1();
        u2();
      };
    },
    async transact(fn, { assignmentId } = {}) {
      return fs.runTransaction(db, async (tx) => {
        const snap = await tx.get(teamRef);
        const state = snap.exists() ? snap.data() : defaultState();
        let current = null;
        if (assignmentId) {
          const aSnap = await tx.get(fs.doc(asgCol, assignmentId));
          current = aSnap.exists() ? aSnap.data() : null;
        }
        const out = fn(state, current) || {};
        if (out.state) tx.set(teamRef, out.state);
        if (out.add) tx.set(fs.doc(asgCol, out.add.id), out.add);
        if (out.patch && assignmentId) tx.update(fs.doc(asgCol, assignmentId), out.patch);
        return out;
      });
    },
    async replaceAll(next) {
      const batch = fs.writeBatch(db);
      batch.set(teamRef, next.state);
      for (const a of (next.assignments || []).slice(0, 400)) batch.set(fs.doc(asgCol, a.id), a);
      await batch.commit();
    },
  };
}
