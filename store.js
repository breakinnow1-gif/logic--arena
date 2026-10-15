// 저장소 계층: Firebase(실제 운영)와 데모(이 브라우저에만 저장) 두 가지를 같은 방식으로 다룹니다.
// 경로는 'collection/docId' 형태만 씁니다.

const FB_VER = '10.12.2';
const EMAIL_DOMAIN = 'arena.class';
export const toEmail = (id) => `${String(id).trim().toLowerCase()}@${EMAIL_DOMAIN}`;

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

// 'a.b.c' 경로에 값 넣기 (Firestore update의 점 경로와 같은 동작)
function setPath(obj, path, val) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof cur[keys[i]] !== 'object' || cur[keys[i]] === null) cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  if (val && val.__inc !== undefined) cur[keys.at(-1)] = (Number(cur[keys.at(-1)]) || 0) + val.__inc;
  else if (val && val.__del) delete cur[keys.at(-1)];
  else cur[keys.at(-1)] = val;
}

/* ------------------------------------------------------------------ */
/* 데모 저장소: localStorage + storage 이벤트로 같은 브라우저의 다른 탭과 실시간 공유 */
/* ------------------------------------------------------------------ */
export function createDemoStore() {
  const KEY = 'logicArena.demo.db';
  const SESS = 'logicArena.demo.session';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { docs: {}, auth: {} }; } catch { return { docs: {}, auth: {} }; } };
  const save = (db) => { localStorage.setItem(KEY, JSON.stringify(db)); fire(); };
  const watchers = new Set();
  let authCb = null;
  const fire = () => watchers.forEach((w) => w());
  window.addEventListener('storage', (e) => { if (e.key === KEY) fire(); });

  const currentUid = () => sessionStorage.getItem(SESS);
  const uidGen = () => 'u' + Math.random().toString(36).slice(2, 12);

  const api = {
    mode: 'demo',
    inc: (n) => ({ __inc: n }),
    del: () => ({ __del: true }),
    now: () => Date.now(),
    uid: () => currentUid(),
    onAuth(cb) { authCb = cb; setTimeout(() => cb(currentUid() ? { uid: currentUid() } : null), 0); },
    async signIn(id, pw) {
      const db = load();
      const a = db.auth[toEmail(id)];
      if (!a || a.pw !== pw) throw new Error('auth/invalid-credential');
      sessionStorage.setItem(SESS, a.uid);
      authCb && authCb({ uid: a.uid });
      return { uid: a.uid };
    },
    async signOut() { sessionStorage.removeItem(SESS); authCb && authCb(null); },
    async createAccount(id, pw, { signInAfter = false } = {}) {
      const db = load();
      const email = toEmail(id);
      if (db.auth[email]) throw new Error('auth/email-already-in-use');
      if (String(pw).length < 6) throw new Error('auth/weak-password');
      const uid = uidGen();
      db.auth[email] = { uid, pw };
      save(db);
      if (signInAfter) { sessionStorage.setItem(SESS, uid); authCb && authCb({ uid }); }
      return uid;
    },
    async removeAccount(id) { const db = load(); delete db.auth[toEmail(id)]; save(db); },
    async get(path) { return clone(load().docs[path]) ?? null; },
    async set(path, data) { const db = load(); db.docs[path] = clone(data); save(db); },
    async update(path, data) {
      const db = load();
      if (!db.docs[path]) throw new Error('not-found: ' + path);
      for (const [k, v] of Object.entries(data)) setPath(db.docs[path], k, v);
      save(db);
    },
    async remove(path) { const db = load(); delete db.docs[path]; save(db); },
    async add(col, data) { const id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); await api.set(`${col}/${id}`, data); return id; },
    async list(col) {
      const docs = load().docs;
      return Object.keys(docs).filter((p) => p.startsWith(col + '/') && p.split('/').length === 2)
        .map((p) => ({ id: p.split('/')[1], ...clone(docs[p]) }));
    },
    watch(path, cb) {
      let last;
      const w = () => { const s = JSON.stringify(load().docs[path] ?? null); if (s !== last) { last = s; cb(JSON.parse(s)); } };
      watchers.add(w); w();
      return () => watchers.delete(w);
    },
    watchCol(col, cb) {
      let last;
      const w = async () => { const l = await api.list(col); const s = JSON.stringify(l); if (s !== last) { last = s; cb(l); } };
      watchers.add(w); w();
      return () => watchers.delete(w);
    },
    // 조건 하나로 거른 목록 구독 (op: '==', 'in', 'array-contains')
    watchWhere(col, field, op, value, cb) {
      let last;
      const ok = (d) => (op === '==' ? d[field] === value
        : op === 'in' ? value.includes(d[field])
        : op === 'array-contains' ? Array.isArray(d[field]) && d[field].includes(value) : false);
      const w = async () => { const l = (await api.list(col)).filter(ok); const s = JSON.stringify(l); if (s !== last) { last = s; cb(l); } };
      watchers.add(w); w();
      return () => watchers.delete(w);
    },
    // 문서 하나에 대한 트랜잭션: fn(현재값) → 업데이트할 객체(점 경로 가능) 또는 null(중단)
    async tx(path, fn) {
      const db = load();
      const cur = clone(db.docs[path]);
      if (!cur) return false;
      const upd = fn(cur);
      if (!upd) return false;
      for (const [k, v] of Object.entries(upd)) setPath(db.docs[path], k, v);
      save(db);
      return true;
    },
    resetDemo() { localStorage.removeItem(KEY); sessionStorage.removeItem(SESS); },
  };
  return api;
}

/* ------------------------------------------------------------------ */
/* Firebase 저장소 (선생님 본인의 Firebase 프로젝트)                    */
/* ------------------------------------------------------------------ */
export async function createFirebaseStore(config) {
  const base = `https://www.gstatic.com/firebasejs/${FB_VER}`;
  const [appMod, authMod, fsMod] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
  ]);
  const { initializeApp, getApps } = appMod;
  const A = authMod;
  const F = fsMod;

  const app = getApps().find((a) => a.name === '[DEFAULT]') || initializeApp(config);
  // 학생 계정을 만들 때 선생님 로그인이 풀리지 않도록 보조 앱을 따로 씁니다.
  const helper = getApps().find((a) => a.name === 'helper') || initializeApp(config, 'helper');
  const auth = A.getAuth(app);
  const helperAuth = A.getAuth(helper);
  const fs = F.getFirestore(app);
  const ref = (path) => F.doc(fs, ...path.split('/'));

  const conv = (v) => {
    if (v && v.__inc !== undefined) return F.increment(v.__inc);
    if (v && v.__del) return F.deleteField();
    return v;
  };
  const convAll = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, conv(v)]));

  const api = {
    mode: 'firebase',
    inc: (n) => ({ __inc: n }),
    del: () => ({ __del: true }),
    now: () => Date.now(),
    uid: () => auth.currentUser?.uid || null,
    onAuth(cb) { A.onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid } : null)); },
    async signIn(id, pw) {
      const c = await A.signInWithEmailAndPassword(auth, toEmail(id), pw);
      return { uid: c.user.uid };
    },
    async signOut() { await A.signOut(auth); },
    async createAccount(id, pw, { signInAfter = false } = {}) {
      if (signInAfter) {
        const c = await A.createUserWithEmailAndPassword(auth, toEmail(id), pw);
        return c.user.uid;
      }
      const c = await A.createUserWithEmailAndPassword(helperAuth, toEmail(id), pw);
      const uid = c.user.uid;
      await A.signOut(helperAuth);
      return uid;
    },
    async removeAccount() { /* 다른 사람의 로그인 계정은 Firebase 콘솔에서만 지울 수 있어요 */ },
    async get(path) { const s = await F.getDoc(ref(path)); return s.exists() ? s.data() : null; },
    async set(path, data) { await F.setDoc(ref(path), data); },
    async update(path, data) { await F.updateDoc(ref(path), convAll(data)); },
    async remove(path) { await F.deleteDoc(ref(path)); },
    async add(col, data) { const r = await F.addDoc(F.collection(fs, col), data); return r.id; },
    async list(col) {
      const s = await F.getDocs(F.collection(fs, col));
      return s.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    watch(path, cb) { return F.onSnapshot(ref(path), (s) => cb(s.exists() ? s.data() : null)); },
    watchCol(col, cb) {
      return F.onSnapshot(F.collection(fs, col), (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
    },
    watchWhere(col, field, op, value, cb) {
      const q = F.query(F.collection(fs, col), F.where(field, op, value));
      return F.onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (e) => console.warn('watchWhere', e));
    },
    async tx(path, fn) {
      try {
        return await F.runTransaction(fs, async (t) => {
          const s = await t.get(ref(path));
          if (!s.exists()) return false;
          const upd = fn(s.data());
          if (!upd) return false;
          t.update(ref(path), convAll(upd));
          return true;
        });
      } catch (e) { console.warn('tx', e); return false; }
    },
  };
  return api;
}

// 'const firebaseConfig = { apiKey: "...", ... };' 형태의 붙여넣은 글에서 설정값을 뽑아냅니다.
export function parseFirebaseConfig(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  try { const j = JSON.parse(t); if (j.apiKey && j.projectId) return j; } catch { /* 계속 */ }
  const out = {};
  const re = /["']?([A-Za-z]+)["']?\s*:\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(t))) out[m[1]] = m[2];
  return out.apiKey && out.projectId ? out : null;
}

export const encodeConfig = (c) => btoa(unescape(encodeURIComponent(JSON.stringify(c)))).replace(/=+$/, '');
export function decodeConfig(s) {
  try { return JSON.parse(decodeURIComponent(escape(atob(s)))); } catch { return null; }
}
