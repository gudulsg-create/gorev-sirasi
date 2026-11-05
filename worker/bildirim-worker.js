// Görev Sırası — bildirim sunucusu (Cloudflare Worker, tek dosya, bağımlılık yok)
//
// Uygulama, bir görev verildiğinde/aktarıldığında veya duyuru yayınlandığında bu adrese
// { team, kind: "assignment" | "announcement", id } gönderir. Sunucu:
//   1) Firestore'dan kaydı kendisi okur (istemciden gelen metne güvenmez),
//   2) bildirimi yalnızca ilgili kişilere ve her kişiye BİR KEZ gönderir,
//   3) kime gönderdiğini Firestore'a not eder.
// Böylece adresi bilen biri sahte ya da tekrar tekrar bildirim gönderemez.
//
// Gerekli gizli değişken (Cloudflare → Worker → Settings → Variables and Secrets):
//   FIREBASE_SA  : Firebase hizmet hesabı anahtarı (JSON dosyasının tamamı)
// İsteğe bağlı düz değişken:
//   ALLOWED_ORIGIN : ör. https://gudulsg-create.github.io  (boşsa her kaynağa izin verilir)
//   APP_URL        : bildirime dokununca açılacak adres, ör. https://gudulsg-create.github.io/gorev-sirasi/

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ ok: true, service: 'gorev-sirasi-bildirim' }, 200, cors);
    try {
      const body = await request.json().catch(() => ({}));
      const team = String(body.team || '');
      const kind = String(body.kind || '');
      const id = String(body.id || '');
      if (!/^[\w-]{1,40}$/.test(team) || !/^[\w-]{1,64}$/.test(id) || !['assignment', 'announcement'].includes(kind)) {
        return json({ ok: false, error: 'geçersiz istek' }, 400, cors);
      }
      const sa = JSON.parse(env.FIREBASE_SA || '{}');
      if (!sa.client_email || !sa.private_key || !sa.project_id) return json({ ok: false, error: 'FIREBASE_SA eksik' }, 500, cors);
      const token = await accessToken(sa);
      const ctx = { sa, token, team, appUrl: env.APP_URL || '' };
      const result = kind === 'assignment' ? await notifyAssignment(ctx, id) : await notifyAnnouncement(ctx, id);
      return json({ ok: true, ...result }, 200, cors);
    } catch (err) {
      return json({ ok: false, error: String(err && err.message || err) }, 500, cors);
    }
  },
};

// ---------------- Bildirim mantığı ----------------
async function notifyAssignment(ctx, id) {
  const teamDoc = await getDoc(ctx, `teams/${ctx.team}`);
  const asg = await getDoc(ctx, `teams/${ctx.team}/assignments/${id}`);
  if (!teamDoc || !asg) return { sent: 0, reason: 'kayıt yok' };
  if (asg.status !== 'aktif') return { sent: 0, reason: 'görev aktif değil' };
  if (Date.now() - Number(asg.createdAt || 0) > 3 * 86400000) return { sent: 0, reason: 'eski görev' };
  const notified = asg.notified || {};
  const pid = asg.personId;
  if (notified[pid]) return { sent: 0, reason: 'zaten bildirildi' };
  const person = (teamDoc.people || []).find((p) => p.id === pid);
  const tokens = Object.values((person && person.push) || {}).filter(Boolean);
  const due = asg.dueDate ? ` · Son gün: ${fmtDay(asg.dueDate)}` : '';
  const sent = await sendAll(ctx, tokens, {
    title: `📋 Yeni görev: ${asg.typeName}`,
    body: `Veren: ${asg.by || '—'}${due}${asg.note ? ` · ${asg.note}` : ''}`,
    tag: `gorev-${id}`,
    url: ctx.appUrl ? `${ctx.appUrl}#gorevlerim` : '',
  });
  await patchDoc(ctx, `teams/${ctx.team}/assignments/${id}`, { notified: { ...notified, [pid]: Date.now() } });
  return { sent, tokens: tokens.length };
}

async function notifyAnnouncement(ctx, id) {
  const teamDoc = await getDoc(ctx, `teams/${ctx.team}`);
  if (!teamDoc) return { sent: 0, reason: 'ekip yok' };
  const ann = (teamDoc.announcements || []).find((a) => a.id === id);
  if (!ann) return { sent: 0, reason: 'duyuru yok' };
  const done = teamDoc.annNotified || {};
  if (done[id]) return { sent: 0, reason: 'zaten bildirildi' };
  if (Date.now() - Number(ann.createdAt || 0) > 86400000) return { sent: 0, reason: 'eski duyuru' };
  const tokens = (teamDoc.people || [])
    .filter((p) => p.id !== ann.byId)
    .flatMap((p) => Object.values(p.push || {}))
    .filter(Boolean);
  const text = String(ann.text || '');
  const sent = await sendAll(ctx, tokens, {
    title: `📢 Duyuru · ${ann.by || ''}`.trim(),
    body: text.length > 140 ? text.slice(0, 137) + '…' : text,
    tag: `duyuru-${id}`,
    url: ctx.appUrl || '',
  });
  // En son 50 duyuru kaydını tut.
  const keep = Object.entries({ ...done, [id]: Date.now() }).sort((a, b) => b[1] - a[1]).slice(0, 50);
  await patchDoc(ctx, `teams/${ctx.team}`, { annNotified: Object.fromEntries(keep) });
  return { sent, tokens: tokens.length };
}

async function sendAll(ctx, tokens, msg) {
  let sent = 0;
  for (const t of [...new Set(tokens)]) {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${ctx.sa.project_id}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: t,
          // Yalnızca veri: bildirimi uygulamanın service worker'ı gösterir (iOS ve Android'de aynı).
          data: { title: msg.title, body: msg.body, tag: msg.tag, url: msg.url },
          webpush: { headers: { Urgency: 'high', TTL: '86400' } },
        },
      }),
    });
    if (res.ok) sent += 1;
  }
  return sent;
}

const fmtDay = (day) => {
  const [y, m, d] = String(day).split('-').map(Number);
  const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  return y && m && d ? `${d} ${months[m - 1]}` : String(day);
};

// ---------------- Google kimlik doğrulama (hizmet hesabı → erişim anahtarı) ----------------
async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc(header)}.${enc(claim)}`;
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(new Uint8Array(sig))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Google erişim anahtarı alınamadı');
  return data.access_token;
}

function pemToDer(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------------- Firestore REST ----------------
const docUrl = (ctx, path) => `https://firestore.googleapis.com/v1/projects/${ctx.sa.project_id}/databases/(default)/documents/${path}`;

async function getDoc(ctx, path) {
  const res = await fetch(docUrl(ctx, path), { headers: { authorization: `Bearer ${ctx.token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore okuma hatası (${res.status})`);
  const doc = await res.json();
  return fromFields(doc.fields || {});
}

/** Yalnızca verilen üst düzey alanları günceller (diğer alanlara dokunmaz). */
async function patchDoc(ctx, path, obj) {
  const mask = Object.keys(obj).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const res = await fetch(`${docUrl(ctx, path)}?${mask}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${ctx.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: toFields(obj) }),
  });
  if (!res.ok) throw new Error(`Firestore yazma hatası (${res.status})`);
}

export function fromValue(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  return null;
}
export function fromFields(fields) {
  const o = {};
  for (const [k, v] of Object.entries(fields)) o[k] = fromValue(v);
  return o;
}
export function toValue(x) {
  if (x === null || x === undefined) return { nullValue: null };
  if (typeof x === 'boolean') return { booleanValue: x };
  if (typeof x === 'number') return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  if (typeof x === 'string') return { stringValue: x };
  if (Array.isArray(x)) return { arrayValue: { values: x.map(toValue) } };
  return { mapValue: { fields: toFields(x) } };
}
export function toFields(o) {
  const f = {};
  for (const [k, v] of Object.entries(o)) f[k] = toValue(v);
  return f;
}

// ---------------- Yardımcılar ----------------
function corsHeaders(request, env) {
  const origin = request.headers.get('origin') || '';
  const allowed = env.ALLOWED_ORIGIN || '*';
  return {
    'access-control-allow-origin': allowed === '*' ? '*' : (origin === allowed ? origin : allowed),
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  };
}
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, 'content-type': 'application/json; charset=utf-8' } });
}
