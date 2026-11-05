import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { toFields, fromFields } from '../worker/bildirim-worker.js';

// --- Sahte Google: OAuth, Firestore REST ve FCM ---
let keys, pem, docs, sent, patches, origFetch;

async function setupKeys() {
  keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
  pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`;
}
const b64urlDecode = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function installFetch() {
  origFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    url = String(url);
    if (url === 'https://oauth2.googleapis.com/token') {
      const jwt = new URLSearchParams(opts.body).get('assertion');
      const [h, c, s] = jwt.split('.');
      const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', keys.publicKey, b64urlDecode(s), new TextEncoder().encode(`${h}.${c}`));
      if (!ok) return new Response(JSON.stringify({ error: 'bad sig' }), { status: 400 });
      const claim = JSON.parse(b64urlDecode(c));
      assert.equal(claim.iss, 'bot@proj.iam.gserviceaccount.com');
      assert.match(claim.scope, /firebase\.messaging/);
      return new Response(JSON.stringify({ access_token: 'TOKEN123' }));
    }
    assert.equal(opts.headers?.authorization, 'Bearer TOKEN123');
    const fs = url.match(/^https:\/\/firestore\.googleapis\.com\/v1\/projects\/proj\/databases\/\(default\)\/documents\/([^?]+)(\?(.*))?$/);
    if (fs) {
      const path = decodeURIComponent(fs[1]);
      if ((opts.method || 'GET') === 'GET') {
        return docs[path] ? new Response(JSON.stringify({ fields: toFields(docs[path]) })) : new Response('{}', { status: 404 });
      }
      if (opts.method === 'PATCH') {
        const mask = new URLSearchParams(fs[3]).getAll('updateMask.fieldPaths');
        const upd = fromFields(JSON.parse(opts.body).fields);
        for (const k of mask) docs[path][k] = upd[k];
        patches.push({ path, mask });
        return new Response('{}');
      }
    }
    if (url === 'https://fcm.googleapis.com/v1/projects/proj/messages:send') {
      const m = JSON.parse(opts.body).message;
      sent.push(m);
      return m.token.startsWith('bad') ? new Response('{}', { status: 404 }) : new Response('{}');
    }
    throw new Error('beklenmeyen istek ' + url);
  };
}

const env = () => ({ FIREBASE_SA: JSON.stringify({ client_email: 'bot@proj.iam.gserviceaccount.com', private_key: pem, project_id: 'proj' }), APP_URL: 'https://x.github.io/app/' });
const call = (body, method = 'POST') => worker.fetch(new Request('https://w.dev/', { method, body: method === 'POST' ? JSON.stringify(body) : undefined, headers: { origin: 'https://x.github.io' } }), env());

beforeEach(async () => {
  if (!keys) await setupKeys();
  if (!origFetch) installFetch();
  sent = []; patches = [];
  docs = {
    'teams/ekip': {
      people: [
        { id: 'ali', name: 'Ali', push: { tel: 'tok-ali', eski: 'bad-ali' } },
        { id: 'ayse', name: 'Ayşe', push: { tel: 'tok-ayse' } },
        { id: 'hoca', name: 'Hüseyin', push: { tel: 'tok-hoca' } },
        { id: 'can', name: 'Can' },
      ],
      announcements: [{ id: 'd1', text: 'Cuma toplantı', by: 'Hüseyin', byId: 'hoca', createdAt: Date.now() }],
    },
    'teams/ekip/assignments/a1': { status: 'aktif', personId: 'ali', typeName: 'Patoloji yazmak', by: 'Hüseyin', dueDate: '2026-11-07', note: '', createdAt: Date.now() },
  };
});

test('görev bildirimi görevi alanın cihazlarına bir kez gider', async () => {
  let r = await (await call({ team: 'ekip', kind: 'assignment', id: 'a1' })).json();
  assert.equal(r.ok, true);
  assert.equal(r.tokens, 2);
  assert.equal(r.sent, 1); // bozuk anahtar sayılmaz
  assert.deepEqual(sent.map((m) => m.token).sort(), ['bad-ali', 'tok-ali']);
  assert.equal(sent[0].data.title, '📋 Yeni görev: Patoloji yazmak');
  assert.match(sent[0].data.body, /Veren: Hüseyin · Son gün: 7 Kas/);
  assert.equal(sent[0].data.url, 'https://x.github.io/app/#gorevlerim');
  assert.ok(docs['teams/ekip/assignments/a1'].notified.ali);
  sent = [];
  r = await (await call({ team: 'ekip', kind: 'assignment', id: 'a1' })).json();
  assert.equal(r.reason, 'zaten bildirildi');
  assert.equal(sent.length, 0);
});

test('aktarılan görevde yeni kişiye de bildirim gider', async () => {
  await call({ team: 'ekip', kind: 'assignment', id: 'a1' });
  docs['teams/ekip/assignments/a1'].personId = 'ayse';
  sent = [];
  const r = await (await call({ team: 'ekip', kind: 'assignment', id: 'a1' })).json();
  assert.equal(r.sent, 1);
  assert.deepEqual(sent.map((m) => m.token), ['tok-ayse']);
});

test('iptal, olmayan veya eski görev için bildirim gitmez', async () => {
  docs['teams/ekip/assignments/a1'].status = 'iptal';
  assert.equal((await (await call({ team: 'ekip', kind: 'assignment', id: 'a1' })).json()).sent, 0);
  assert.equal((await (await call({ team: 'ekip', kind: 'assignment', id: 'yok' })).json()).reason, 'kayıt yok');
  docs['teams/ekip/assignments/a1'] = { ...docs['teams/ekip/assignments/a1'], status: 'aktif', createdAt: Date.now() - 5 * 86400000 };
  assert.equal((await (await call({ team: 'ekip', kind: 'assignment', id: 'a1' })).json()).reason, 'eski görev');
  assert.equal(sent.length, 0);
});

test('duyuru yazan hariç herkese bir kez gider; diğer alanlar korunur', async () => {
  let r = await (await call({ team: 'ekip', kind: 'announcement', id: 'd1' })).json();
  assert.equal(r.sent, 2);
  assert.deepEqual(sent.map((m) => m.token).sort(), ['bad-ali', 'tok-ali', 'tok-ayse']);
  assert.equal(sent[0].data.title, '📢 Duyuru · Hüseyin');
  assert.deepEqual(patches.at(-1).mask, ['annNotified']);
  assert.equal(docs['teams/ekip'].people.length, 4); // ekip verisine dokunulmadı
  sent = [];
  r = await (await call({ team: 'ekip', kind: 'announcement', id: 'd1' })).json();
  assert.equal(r.reason, 'zaten bildirildi');
  assert.equal(sent.length, 0);
});

test('geçersiz istekler reddedilir, CORS ve GET çalışır', async () => {
  assert.equal((await call({ team: '../x', kind: 'assignment', id: 'a1' })).status, 400);
  assert.equal((await call({ team: 'ekip', kind: 'spam', id: 'a1' })).status, 400);
  const pre = await worker.fetch(new Request('https://w.dev/', { method: 'OPTIONS' }), env());
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  assert.equal((await (await call(null, 'GET')).json()).service, 'gorev-sirasi-bildirim');
  const noSa = await worker.fetch(new Request('https://w.dev/', { method: 'POST', body: JSON.stringify({ team: 'ekip', kind: 'assignment', id: 'a1' }) }), {});
  assert.equal(noSa.status, 500);
});
