import { createDemoStore, createFirebaseStore, parseFirebaseConfig, encodeConfig, decodeConfig } from './store.js';
import { DEFAULT_QUESTIONS } from './questions.js';
import { RULES } from './rules.js';

/* ============================== 공통 ============================== */
const $app = document.getElementById('app');
const CFG_KEY = 'logicArena.config';
const MODE_KEY = 'logicArena.mode';
const REVEAL_MS = 9000;
const START_RATING = 1000;
const MARKS = ['①', '②', '③', '④', '⑤'];
const ID_RE = /^[a-z0-9_.-]{2,20}$/;

const S = { api: null, uid: null, me: null, settings: null, subs: [], timers: [], settingUp: false };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const track = (u) => { if (typeof u === 'function') S.subs.push(u); };
const trackTimer = (t) => S.timers.push(t);
function leave() {
  S.subs.forEach((u) => { try { u(); } catch { /* 무시 */ } });
  S.timers.forEach((t) => clearInterval(t));
  S.subs = []; S.timers = [];
  window.scrollTo(0, 0);
}
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const fmtDate = (ms) => { if (!ms) return ''; const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3100);
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('복사했어요'); }
  catch { prompt('아래 내용을 복사하세요', t); }
}

const TIERS = [
  { min: 1250, name: '로고스 마스터', icon: '👑', cls: 't5' },
  { min: 1150, name: '논증 대가', icon: '🏛️', cls: 't4' },
  { min: 1050, name: '추리 기사', icon: '⚔️', cls: 't3' },
  { min: 950, name: '논리 탐정', icon: '🔍', cls: 't2' },
  { min: -Infinity, name: '견습 논리가', icon: '🌱', cls: 't1' },
];
const tierOf = (r) => TIERS.find((t) => (r ?? START_RATING) >= t.min);
const tierBadge = (r) => { const t = tierOf(r); return `<span class="tier ${t.cls}">${t.icon}<span class="tn"> ${t.name}</span></span>`; };

const errMsg = (e) => {
  const c = String(e?.code || e?.message || e);
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found') || c.includes('invalid-login')) return '아이디 또는 비밀번호가 맞지 않아요.';
  if (c.includes('email-already-in-use')) return '이미 쓰고 있는 아이디예요.';
  if (c.includes('weak-password')) return '비밀번호는 6자 이상이어야 해요.';
  if (c.includes('permission-denied') || c.includes('insufficient permissions')) return '권한이 없어요. Firestore 규칙을 게시했는지 확인하세요.';
  if (c.includes('operation-not-allowed')) return 'Firebase에서 「이메일/비밀번호」 로그인을 사용 설정하지 않았어요.';
  if (c.includes('too-many-requests')) return '시도가 너무 많아요. 잠시 뒤 다시 해 보세요.';
  if (c.includes('offline')) return 'Firestore 데이터베이스에 닿지 못했어요. 데이터베이스를 만들었는지(3단계)와 인터넷 연결을 확인하세요.';
  if (c.includes('network')) return '인터넷 연결을 확인하세요.';
  if (c.includes('does not exist') || c.includes('not-found')) return 'Firestore 데이터베이스를 아직 만들지 않은 것 같아요.';
  return c;
};

/* ============================== 시작 ============================== */
async function boot() {
  const params = new URLSearchParams(location.search);
  if (params.get('c')) {
    const c = decodeConfig(params.get('c'));
    if (c) { localStorage.setItem(CFG_KEY, JSON.stringify(c)); localStorage.removeItem(MODE_KEY); }
    history.replaceState(null, '', location.pathname);
  }
  const mode = localStorage.getItem(MODE_KEY);
  let cfg = null;
  try { cfg = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch { /* 무시 */ }

  if (mode === 'demo') {
    S.api = createDemoStore();
    await seedDemo();
  } else if (cfg) {
    try { S.api = await createFirebaseStore(cfg); }
    catch (e) { return renderFatal('Firebase를 불러오지 못했어요. 인터넷 연결을 확인하세요.', e); }
  } else {
    return renderWelcome();
  }
  S.api.onAuth(onAuthChange);
}

async function onAuthChange(user) {
  if (S.settingUp) return;
  leave();
  S.uid = user?.uid || null;
  S.me = null;
  try { S.settings = await S.api.get('meta/settings'); }
  catch (e) { return renderFatal('반 정보를 읽지 못했어요.', e); }
  if (!user) return renderLogin();
  const me = await S.api.get(`users/${user.uid}`).catch(() => null);
  if (!me) {
    $app.innerHTML = `<div class="center"><div class="card narrow"><h2>등록되지 않은 계정</h2>
      <p>이 계정은 반 명단에 없어요. 선생님께 문의하세요.</p>
      <button class="btn" data-a="logout">로그아웃</button></div></div>`;
    $app.querySelector('[data-a=logout]').onclick = () => S.api.signOut();
    return;
  }
  S.me = me;
  track(S.api.watch(`users/${user.uid}`, (d) => { if (d) S.me = d; }));
  if (me.role === 'teacher') renderTeacher('live');
  else renderStudentHome();
}

function renderFatal(msg, e) {
  $app.innerHTML = `<div class="center"><div class="card narrow"><h2>문제가 생겼어요</h2><p>${esc(msg)}</p>
    <p class="muted small">${esc(errMsg(e))}</p>
    <div class="row"><button class="btn" onclick="location.reload()">다시 시도</button>
    <button class="btn ghost" id="reset">연결 바꾸기</button></div></div></div>`;
  $app.querySelector('#reset').onclick = resetConnection;
}
function resetConnection() {
  if (!confirm('이 기기에 저장된 연결 정보를 지울까요? (반 데이터는 지워지지 않아요)')) return;
  localStorage.removeItem(CFG_KEY); localStorage.removeItem(MODE_KEY);
  location.href = location.pathname;
}

/* ============================== 첫 화면 · 설정 안내 ============================== */
function renderWelcome() {
  $app.innerHTML = `
  <div class="center"><div class="hero">
    <div class="brand"><span class="logo">∴</span><div><h1>논리 아레나</h1><p class="sub">수능형 논리 문항 · 1:1 클래스 랭크 리그</p></div></div>
    <p class="lead"><b>학생</b>은 선생님이 알려 준 <b>접속 링크</b>나 <b>QR 코드</b>로 들어오세요. 한 번 들어오면 이 기기가 기억해요.</p>
    <div class="stack">
      <button class="btn big" data-a="setup">선생님: 우리 반 처음 설정하기 <small>약 10분 · 무료 · 처음 한 번만</small></button>
      <button class="btn ghost" data-a="link">접속 링크가 있어요</button>
      <button class="btn ghost" data-a="demo">설정 없이 데모로 체험하기</button>
    </div>
    <div id="linkBox" class="hidden">
      <label>접속 링크 붙여넣기</label>
      <input id="linkIn" placeholder="https://...?c=...">
      <button class="btn" data-a="useLink">이 링크로 연결</button>
    </div>
    <p class="muted small">선생님 본인의 Firebase(구글의 무료 저장소)에 연결합니다. 학생 정보와 기록은 선생님 계정에만 저장돼요.</p>
  </div></div>`;
  $app.querySelector('[data-a=setup]').onclick = () => renderWizard(0);
  $app.querySelector('[data-a=demo]').onclick = () => { localStorage.setItem(MODE_KEY, 'demo'); location.reload(); };
  $app.querySelector('[data-a=link]').onclick = () => $app.querySelector('#linkBox').classList.remove('hidden');
  $app.querySelector('[data-a=useLink]').onclick = () => {
    const v = $app.querySelector('#linkIn').value.trim();
    try {
      const c = new URL(v).searchParams.get('c');
      const cfg = c && decodeConfig(c);
      if (!cfg) throw new Error();
      localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
      location.href = location.pathname;
    } catch { toast('올바른 접속 링크가 아니에요.', 'bad'); }
  };
}

const WIZARD = [
  {
    t: 'Firebase 프로젝트 만들기',
    b: `<ol>
      <li><a href="https://console.firebase.google.com/" target="_blank" rel="noopener">Firebase 콘솔</a>에 구글 계정으로 들어갑니다.</li>
      <li><b>프로젝트 만들기</b>(또는 「Firebase 프로젝트 시작하기」)를 누르고 이름을 정합니다. 예: <code>logic-arena-6-3</code></li>
      <li>Google 애널리틱스는 <b>사용 안 함</b>으로 꺼도 됩니다.</li>
    </ol>`,
  },
  {
    t: '로그인 방식 켜기',
    b: `<ol>
      <li>왼쪽 메뉴 <b>빌드 → Authentication</b>을 열고 <b>시작하기</b>를 누릅니다.</li>
      <li><b>로그인 방법</b> 탭에서 <b>이메일/비밀번호</b>를 고르고, 첫 번째 스위치를 <b>사용 설정</b>한 뒤 저장합니다.</li>
    </ol>
    <p class="muted small">학생은 이메일 없이 아이디로 로그인해요. 앱이 내부에서 <code>아이디@arena.class</code> 형태로 바꿔 씁니다.</p>`,
  },
  {
    t: '데이터베이스 만들기',
    b: `<ol>
      <li>왼쪽 메뉴 <b>빌드 → Firestore Database</b>를 열고 <b>데이터베이스 만들기</b>를 누릅니다.</li>
      <li>위치는 <b>asia-northeast3 (서울)</b>을 고릅니다.</li>
      <li><b>프로덕션 모드</b>로 시작합니다.</li>
    </ol>`,
  },
  {
    t: '보안 규칙 붙여 넣기',
    b: `<p>Firestore Database의 <b>규칙</b> 탭에 있는 내용을 모두 지우고, 아래 규칙을 붙여 넣은 뒤 <b>게시</b>를 누르세요.</p>
    <textarea class="code" readonly rows="10">${esc(RULES)}</textarea>
    <button class="btn" data-a="copyRules">규칙 복사</button>
    <p class="muted small">학생이 다른 학생의 정보를 바꾸거나 문항을 고치지 못하게 막는 규칙이에요.</p>`,
  },
  {
    t: '웹 앱 등록하고 연결하기',
    b: `<ol>
      <li>왼쪽 위 톱니바퀴 <b>프로젝트 설정 → 일반</b>에서 맨 아래 「내 앱」의 <b>&lt;/&gt;</b>(웹) 아이콘을 누릅니다.</li>
      <li>앱 닉네임을 적고 <b>앱 등록</b>을 누릅니다. 호스팅 설정은 체크하지 않아도 됩니다.</li>
      <li>화면에 나온 <code>const firebaseConfig = { … };</code> 부분을 복사해 아래에 붙여 넣으세요.</li>
    </ol>
    <textarea id="cfgIn" rows="8" placeholder="const firebaseConfig = {\n  apiKey: &quot;...&quot;,\n  authDomain: &quot;...&quot;,\n  projectId: &quot;...&quot;,\n  ...\n};"></textarea>
    <button class="btn big" data-a="connect">연결하기</button>
    <p id="cfgMsg" class="small"></p>`,
  },
];

function renderWizard(i) {
  const step = WIZARD[i];
  $app.innerHTML = `
  <div class="center"><div class="card wide wizard">
    <div class="steps">${WIZARD.map((s, k) => `<span class="${k === i ? 'on' : k < i ? 'done' : ''}">${k + 1}</span>`).join('')}</div>
    <h2>${i + 1}. ${step.t}</h2>
    <div class="wbody">${step.b}</div>
    <div class="row between">
      <button class="btn ghost" data-a="prev">${i === 0 ? '← 처음으로' : '← 이전'}</button>
      ${i < WIZARD.length - 1 ? '<button class="btn" data-a="next">다음 →</button>' : ''}
    </div>
  </div></div>`;
  $app.querySelector('[data-a=prev]').onclick = () => (i === 0 ? renderWelcome() : renderWizard(i - 1));
  const nx = $app.querySelector('[data-a=next]');
  if (nx) nx.onclick = () => renderWizard(i + 1);
  const cr = $app.querySelector('[data-a=copyRules]');
  if (cr) cr.onclick = () => copyText(RULES);
  const cn = $app.querySelector('[data-a=connect]');
  if (cn) cn.onclick = async () => {
    const msg = $app.querySelector('#cfgMsg');
    const cfg = parseFirebaseConfig($app.querySelector('#cfgIn').value);
    if (!cfg) { msg.textContent = 'apiKey와 projectId가 들어 있는 설정 코드를 붙여 넣어 주세요.'; msg.className = 'small bad'; return; }
    cn.disabled = true; msg.textContent = '연결을 확인하는 중…'; msg.className = 'small';
    try {
      const api = await createFirebaseStore(cfg);
      await api.get('meta/settings');
      localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
      localStorage.removeItem(MODE_KEY);
      location.href = location.pathname;
    } catch (e) {
      cn.disabled = false;
      msg.textContent = '연결하지 못했어요: ' + errMsg(e);
      msg.className = 'small bad';
    }
  };
}

/* ============================== 로그인 ============================== */
function renderLogin() {
  const demo = S.api.mode === 'demo';
  const noTeacher = !S.settings;
  $app.innerHTML = `
  <div class="center"><div class="card narrow login">
    <div class="brand"><span class="logo">∴</span><div><h1>논리 아레나</h1><p class="sub">${esc(S.settings?.className || '수능형 논리 문항 · 1:1 랭크 리그')}</p></div></div>
    ${noTeacher ? `
      <div class="notice">
        <b>선생님 계정을 만들 차례예요.</b> 아이디는 <code>master</code>로 정해져요.
      </div>
      <label>반 이름</label><input id="cn" placeholder="예: 6학년 3반">
      <label>선생님 표시 이름</label><input id="tn" placeholder="예: 김선생님">
      <label>비밀번호 (6자 이상)</label><input id="p1" type="password">
      <label>비밀번호 확인</label><input id="p2" type="password">
      <label class="check"><input type="checkbox" id="seed" checked> 기본 논리 문항 ${DEFAULT_QUESTIONS.length}개 넣기</label>
      <button class="btn big" data-a="createMaster">선생님 계정 만들기</button>
    ` : `
      <label>아이디</label><input id="id" autocomplete="username" autocapitalize="off">
      <label>비밀번호</label><input id="pw" type="password" autocomplete="current-password">
      <button class="btn big" data-a="login">입장하기</button>
    `}
    <p id="msg" class="small bad"></p>
    ${demo ? `<div class="notice demo"><b>데모 모드</b> — 이 브라우저에만 저장돼요.<br>
      선생님 <code>master</code> / <code>123456</code> · 학생 <code>s1</code>~<code>s6</code> / <code>123456</code><br>
      새 탭을 열어 다른 학생으로 로그인하면 1:1 대결을 시험할 수 있어요.</div>` : ''}
    <div class="row between foot">
      <button class="link" data-a="reset">${demo ? '데모 끝내기' : '연결 바꾸기'}</button>
      ${demo ? '<button class="link" data-a="resetDemo">데모 데이터 초기화</button>' : ''}
    </div>
  </div></div>`;
  const msg = $app.querySelector('#msg');
  $app.querySelector('[data-a=reset]').onclick = resetConnection;
  const rd = $app.querySelector('[data-a=resetDemo]');
  if (rd) rd.onclick = () => { if (confirm('데모 데이터를 모두 지울까요?')) { S.api.resetDemo(); location.reload(); } };

  const lg = $app.querySelector('[data-a=login]');
  if (lg) {
    const go = async () => {
      const id = $app.querySelector('#id').value.trim().toLowerCase();
      const pw = $app.querySelector('#pw').value;
      if (!id || !pw) { msg.textContent = '아이디와 비밀번호를 입력하세요.'; return; }
      lg.disabled = true; msg.textContent = '';
      try { await S.api.signIn(id, pw); }
      catch (e) { msg.textContent = errMsg(e); lg.disabled = false; }
    };
    lg.onclick = go;
    $app.querySelector('#pw').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  }
  const cm = $app.querySelector('[data-a=createMaster]');
  if (cm) cm.onclick = async () => {
    const cn = $app.querySelector('#cn').value.trim() || '우리 반';
    const tn = $app.querySelector('#tn').value.trim() || '선생님';
    const p1 = $app.querySelector('#p1').value, p2 = $app.querySelector('#p2').value;
    if (p1.length < 6) { msg.textContent = '비밀번호는 6자 이상이어야 해요.'; return; }
    if (p1 !== p2) { msg.textContent = '비밀번호 확인이 다릅니다.'; return; }
    cm.disabled = true; msg.textContent = '';
    S.settingUp = true;
    try {
      const uid = await S.api.createAccount('master', p1, { signInAfter: true });
      await S.api.set('meta/settings', { teacherUid: uid, className: cn, createdAt: S.api.now() });
      await S.api.set(`users/${uid}`, { role: 'teacher', loginId: 'master', name: tn, createdAt: S.api.now() });
      if ($app.querySelector('#seed').checked) await seedQuestions();
      S.settingUp = false;
      onAuthChange({ uid });
    } catch (e) {
      S.settingUp = false;
      cm.disabled = false;
      msg.textContent = errMsg(e) + (String(e).includes('email-already-in-use') ? ' (master 계정이 이미 있어요. Firebase 콘솔 Authentication에서 지우고 다시 하세요.)' : '');
    }
  };
}

async function seedQuestions() {
  const have = new Set((await S.api.list('questions')).map((q) => q.key).filter(Boolean));
  let n = 0;
  for (const q of DEFAULT_QUESTIONS) {
    if (have.has(q.key)) continue;
    await S.api.add('questions', { ...q, createdAt: S.api.now() });
    n++;
  }
  return n;
}

async function seedDemo() {
  if (await S.api.get('meta/settings')) return;
  const tuid = await S.api.createAccount('master', '123456');
  await S.api.set('meta/settings', { teacherUid: tuid, className: '데모 6학년 1반', createdAt: Date.now() });
  await S.api.set(`users/${tuid}`, { role: 'teacher', loginId: 'master', name: '데모 선생님', createdAt: Date.now() });
  const names = ['김하늘', '이준서', '박서연', '최도윤', '정지아', '강민재'];
  for (let i = 0; i < names.length; i++) {
    const uid = await S.api.createAccount(`s${i + 1}`, '123456');
    await S.api.set(`users/${uid}`, { role: 'student', loginId: `s${i + 1}`, name: names[i], number: i + 1, rating: START_RATING, wins: 0, losses: 0, draws: 0, createdAt: Date.now() });
  }
  await seedQuestions();
}

/* ============================== 문항 그리기 ============================== */
function questionHTML(q, idx, total) {
  return `
    <div class="qhead"><span class="qno">${idx + 1}${total ? `<small>/${total}</small>` : ''}</span>
      <span class="qtag">${esc(q.tag || '논리')}</span><span class="lv">${'★'.repeat(q.level || 1)}${'☆'.repeat(3 - (q.level || 1))}</span></div>
    ${q.passage ? `<div class="passage">${esc(q.passage)}</div>` : ''}
    <p class="prompt">${esc(q.prompt)}</p>
    ${q.box ? `<div class="bogi"><span>&lt;보기&gt;</span>${esc(q.box)}</div>` : ''}`;
}

/* ============================== 선생님 ============================== */
const T_TABS = [
  ['live', '실시간 경기'], ['assign', '매치 배정'], ['students', '학생 관리'], ['questions', '문제 관리'],
  ['rank', '순위표'], ['history', '경기 기록'], ['settings', '설정'],
];

function teacherShell(tab) {
  leave();
  track(S.api.watch(`users/${S.uid}`, (d) => { if (d) S.me = d; }));
  $app.innerHTML = `
  <header class="top">
    <div class="brand sm"><span class="logo">∴</span><div><b>논리 아레나</b><small>${esc(S.settings?.className || '')} · 관리자</small></div></div>
    <button class="btn ghost sm" data-a="logout">로그아웃</button>
  </header>
  ${S.api.mode === 'demo' ? '<div class="demo-strip">데모 모드 — 이 브라우저에만 저장됩니다</div>' : ''}
  <nav class="tabs">${T_TABS.map(([k, v]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${v}</button>`).join('')}</nav>
  <main id="main"></main>`;
  $app.querySelector('[data-a=logout]').onclick = () => S.api.signOut();
  $app.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => renderTeacher(b.dataset.tab)));
  return $app.querySelector('#main');
}

function renderTeacher(tab) {
  const main = teacherShell(tab);
  ({ live: tLive, assign: tAssign, students: tStudents, questions: tQuestions, rank: tRank, history: tHistory, settings: tSettings })[tab](main);
}

/* ---- 실시간 경기 ---- */
function tLive(main) {
  main.innerHTML = '<h2>진행 중인 경기</h2><div id="list" class="grid"></div>';
  const list = main.querySelector('#list');
  track(S.api.watchWhere('matches', 'status', 'in', ['ready', 'playing'], (ms) => {
    ms.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    if (!ms.length) { list.innerHTML = '<p class="empty">진행 중인 경기가 없어요. 「매치 배정」에서 대결을 만들어 보세요.</p>'; return; }
    list.innerHTML = ms.map((m) => {
      const [a, b] = m.players;
      const st = m.status === 'ready'
        ? `입장 대기 · ${m.players.map((p) => (m.ready?.[p] ? '✓' : '…')).join(' ')}`
        : `${m.round + 1}/${m.questions.length}번 ${m.phase === 'reveal' ? '채점 중' : '풀이 중'}`;
      return `<div class="mcard">
        <div class="vs"><span>${esc(m.names[a])}</span><b>${m.scores?.[a] || 0} : ${m.scores?.[b] || 0}</b><span>${esc(m.names[b])}</span></div>
        <p class="muted small">${st}</p>
        <div class="row">
          <button class="btn sm" data-watch="${m.id}">관전</button>
          ${m.status === 'ready' ? `<button class="btn ghost sm" data-start="${m.id}">바로 시작</button>` : ''}
          <button class="btn ghost sm danger" data-cancel="${m.id}">취소</button>
        </div></div>`;
    }).join('');
    list.querySelectorAll('[data-watch]').forEach((b) => (b.onclick = () => renderMatch(b.dataset.watch, { spectator: true })));
    list.querySelectorAll('[data-start]').forEach((b) => (b.onclick = () => {
      const m = ms.find((x) => x.id === b.dataset.start);
      S.api.update(`matches/${m.id}`, { status: 'playing', round: 0, phase: 'question', startedAt: S.api.now(), ...Object.fromEntries(m.players.map((p) => [`ready.${p}`, true])) });
    }));
    list.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = () => {
      if (confirm('이 경기를 취소할까요? 점수에 반영되지 않아요.')) S.api.update(`matches/${b.dataset.cancel}`, { status: 'cancelled', endedAt: S.api.now() });
    }));
  }));
}

/* ---- 매치 배정 ---- */
async function tAssign(main) {
  main.innerHTML = '<p class="muted">불러오는 중…</p>';
  let students = [], questions = [], busy = new Set();
  const draw = () => {
    const tags = [...new Set(questions.map((q) => q.tag).filter(Boolean))];
    const opt = (s) => `<option value="${s.uid}" ${busy.has(s.uid) ? 'disabled' : ''}>${s.number ?? ''} ${esc(s.name)} (${s.rating ?? START_RATING})${busy.has(s.uid) ? ' · 경기 중' : ''}</option>`;
    main.innerHTML = `
    <h2>매치 배정</h2>
    <div class="card">
      <h3>대결 설정</h3>
      <div class="row wrap">
        <label class="inline">문항 수 <select id="n">${[3, 5, 7, 10].map((n) => `<option ${n === 5 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="inline">문항당 제한 시간 <select id="lim">${[45, 60, 90, 120, 180].map((n) => `<option value="${n}" ${n === 90 ? 'selected' : ''}>${n}초</option>`).join('')}</select></label>
        <label class="inline">유형 <select id="tag"><option value="">전체</option>${tags.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label>
        <label class="inline">난이도 <select id="lv"><option value="">전체</option><option value="1">★</option><option value="2">★★</option><option value="3">★★★</option></select></label>
      </div>
      <p class="muted small">문제 은행에 ${questions.length}문항이 있어요. 두 학생은 같은 문항을 같은 순서로 풀어요.</p>
    </div>
    <div class="card">
      <h3>직접 짝 정하기</h3>
      <div class="row wrap">
        <select id="pa"><option value="">학생 1</option>${students.map(opt).join('')}</select>
        <span class="vs-mark">VS</span>
        <select id="pb"><option value="">학생 2</option>${students.map(opt).join('')}</select>
        <button class="btn" data-a="one">배정</button>
      </div>
    </div>
    <div class="card">
      <h3>여러 명 한꺼번에 짝짓기</h3>
      <p class="muted small">오늘 참여하는 학생을 고르세요. 경기 중인 학생은 빠져요.</p>
      <div class="checks">${students.map((s) => `<label class="chip ${busy.has(s.uid) ? 'off' : ''}"><input type="checkbox" value="${s.uid}" ${busy.has(s.uid) ? 'disabled' : 'checked'}> ${s.number ?? ''} ${esc(s.name)}</label>`).join('')}</div>
      <div class="row wrap">
        <button class="btn" data-a="similar">실력 비슷한 친구끼리</button>
        <button class="btn ghost" data-a="random">무작위로</button>
        <button class="link" data-a="all">전체 선택/해제</button>
      </div>
      <p id="pairMsg" class="small"></p>
    </div>`;

    const opts = () => ({
      n: +main.querySelector('#n').value, lim: +main.querySelector('#lim').value,
      tag: main.querySelector('#tag').value, lv: main.querySelector('#lv').value,
    });
    main.querySelector('[data-a=one]').onclick = async () => {
      const a = main.querySelector('#pa').value, b = main.querySelector('#pb').value;
      if (!a || !b) return toast('두 학생을 고르세요.', 'bad');
      if (a === b) return toast('서로 다른 학생을 고르세요.', 'bad');
      const ok = await createMatches([[a, b]], opts(), students, questions);
      if (ok) toast('대결을 배정했어요!');
    };
    const pick = () => [...main.querySelectorAll('.checks input:checked')].map((i) => i.value);
    const pairUp = async (mode) => {
      let ids = pick();
      if (ids.length < 2) return toast('두 명 이상 고르세요.', 'bad');
      const byId = Object.fromEntries(students.map((s) => [s.uid, s]));
      if (mode === 'similar') {
        // 점수 순으로 줄 세운 뒤 옆 사람과 짝 (같은 점수 안에서는 섞기)
        ids = shuffle(ids).sort((x, y) => (byId[y].rating ?? START_RATING) - (byId[x].rating ?? START_RATING));
      } else ids = shuffle(ids);
      const pairs = [];
      for (let i = 0; i + 1 < ids.length; i += 2) pairs.push([ids[i], ids[i + 1]]);
      const left = ids.length % 2 ? byId[ids.at(-1)] : null;
      const ok = await createMatches(pairs, opts(), students, questions);
      if (ok) main.querySelector('#pairMsg').innerHTML = `${pairs.length}개의 대결을 배정했어요.` + (left ? ` <b>${esc(left.name)}</b> 학생은 짝이 없어 남았어요.` : '');
    };
    main.querySelector('[data-a=similar]').onclick = () => pairUp('similar');
    main.querySelector('[data-a=random]').onclick = () => pairUp('random');
    main.querySelector('[data-a=all]').onclick = () => {
      const boxes = [...main.querySelectorAll('.checks input:not(:disabled)')];
      const on = boxes.some((b) => !b.checked);
      boxes.forEach((b) => (b.checked = on));
    };
  };
  questions = await S.api.list('questions');
  let firstU = true, firstM = true;
  track(S.api.watchCol('users', (us) => {
    students = us.filter((u) => u.role === 'student').map((u) => ({ uid: u.id, ...u })).sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
    if (!firstM) draw();
    firstU = false;
  }));
  track(S.api.watchWhere('matches', 'status', 'in', ['ready', 'playing'], (ms) => {
    busy = new Set(ms.flatMap((m) => m.players));
    if (!firstU) draw();
    firstM = false;
  }));
  // 두 구독이 모두 처음 값을 받은 뒤 그리기
  const wait = setInterval(() => { if (!firstU && !firstM) { clearInterval(wait); draw(); } }, 50);
  trackTimer(wait);
}

async function createMatches(pairs, o, students, questions) {
  let pool = questions.filter((q) => (!o.tag || q.tag === o.tag) && (!o.lv || String(q.level) === o.lv));
  if (pool.length < o.n) { toast(`조건에 맞는 문항이 ${pool.length}개뿐이에요. 문항 수나 조건을 바꿔 주세요.`, 'bad'); return false; }
  const byId = Object.fromEntries(students.map((s) => [s.uid, s]));
  for (const [a, b] of pairs) {
    const qs = shuffle(pool).slice(0, o.n).map(({ passage, box, prompt, choices, answer, explanation, tag, level }) =>
      ({ passage: passage || '', box: box || '', prompt, choices, answer, explanation: explanation || '', tag: tag || '', level: level || 1 }));
    await S.api.add('matches', {
      players: [a, b],
      names: { [a]: byId[a].name, [b]: byId[b].name },
      status: 'ready', round: 0, phase: 'question',
      questions: qs, timeLimit: o.lim,
      ready: {}, answers: {}, pts: {}, scores: { [a]: 0, [b]: 0 }, correct: { [a]: 0, [b]: 0 },
      createdAt: S.api.now(),
    });
  }
  return true;
}

/* ---- 학생 관리 ---- */
function tStudents(main) {
  main.innerHTML = `
  <h2>학생 관리</h2>
  <div class="card">
    <h3>학생 추가</h3>
    <div class="row wrap">
      <input id="num" type="number" placeholder="번호" class="w-num">
      <input id="name" placeholder="이름" class="w-name">
      <input id="lid" placeholder="아이디 (영문·숫자)" class="w-id" autocapitalize="off">
      <input id="pw" placeholder="비밀번호 (6자 이상)" class="w-id">
      <button class="btn" data-a="add">추가</button>
    </div>
    <details><summary>여러 명 한꺼번에 추가</summary>
      <p class="muted small">한 줄에 한 명씩 <code>번호 이름 아이디 비밀번호</code> 순서로 적으세요. 띄어쓰기, 쉼표, 탭(엑셀에서 복사) 모두 됩니다.</p>
      <textarea id="bulk" rows="6" placeholder="1 김하늘 s0301 sky1234\n2 이준서 s0302 jun5678"></textarea>
      <button class="btn" data-a="bulk">모두 추가</button>
      <p id="bulkMsg" class="small"></p>
    </details>
  </div>
  <div class="card"><div id="tbl"></div>
    <p class="muted small">학생을 지워도 Firebase의 로그인 계정은 남아요. 같은 아이디를 다시 쓰거나 비밀번호를 바꾸려면 Firebase 콘솔 → Authentication에서 해당 계정(<code>아이디@arena.class</code>)을 지운 뒤 다시 추가하세요.</p>
  </div>`;
  let users = [];
  const addOne = async (number, name, lid, pw) => {
    lid = String(lid || '').trim().toLowerCase();
    if (!name || !lid || !pw) throw new Error('이름, 아이디, 비밀번호를 모두 적어 주세요.');
    if (!ID_RE.test(lid)) throw new Error(`아이디 「${lid}」는 영문 소문자·숫자 2~20자로 정해 주세요.`);
    if (lid === 'master') throw new Error('master는 선생님 아이디예요.');
    if (String(pw).length < 6) throw new Error('비밀번호는 6자 이상이어야 해요.');
    if (users.some((u) => u.loginId === lid)) throw new Error(`아이디 「${lid}」는 이미 있어요.`);
    const uid = await S.api.createAccount(lid, String(pw));
    await S.api.set(`users/${uid}`, { role: 'student', loginId: lid, name: String(name).trim(), number: number === '' || number == null ? null : Number(number), rating: START_RATING, wins: 0, losses: 0, draws: 0, createdAt: S.api.now() });
  };
  main.querySelector('[data-a=add]').onclick = async (ev) => {
    const g = (s) => main.querySelector(s).value;
    ev.target.disabled = true;
    try { await addOne(g('#num'), g('#name'), g('#lid'), g('#pw')); toast('추가했어요'); ['#num', '#name', '#lid', '#pw'].forEach((s) => (main.querySelector(s).value = '')); }
    catch (e) { toast(e.message.startsWith('auth/') ? errMsg(e) : errMsg(e), 'bad'); }
    ev.target.disabled = false;
  };
  main.querySelector('[data-a=bulk]').onclick = async (ev) => {
    const lines = main.querySelector('#bulk').value.split('\n').map((l) => l.trim()).filter(Boolean);
    const out = main.querySelector('#bulkMsg');
    ev.target.disabled = true;
    let ok = 0; const fails = [];
    for (const line of lines) {
      const p = line.split(/[\t,]+|\s+/).filter(Boolean);
      const [num, name, lid, pw] = /^\d+$/.test(p[0]) ? p : [null, ...p];
      out.textContent = `추가하는 중… (${ok + fails.length + 1}/${lines.length})`;
      try { await addOne(num, name, lid, pw); ok++; } catch (e) { fails.push(`${line} → ${errMsg(e)}`); }
    }
    out.innerHTML = `${ok}명 추가했어요.` + (fails.length ? `<br><span class="bad">${fails.map(esc).join('<br>')}</span>` : '');
    ev.target.disabled = false;
  };
  track(S.api.watchCol('users', (us) => {
    users = us.filter((u) => u.role === 'student').sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
    const tbl = main.querySelector('#tbl');
    if (!users.length) { tbl.innerHTML = '<p class="empty">아직 학생이 없어요.</p>'; return; }
    tbl.innerHTML = `<table><thead><tr><th>번호</th><th>이름</th><th>아이디</th><th>점수</th><th>전적</th><th></th></tr></thead><tbody>
      ${users.map((u) => `<tr><td>${u.number ?? ''}</td><td>${esc(u.name)}</td><td><code>${esc(u.loginId)}</code></td><td>${u.rating ?? START_RATING}</td>
        <td>${u.wins || 0}승 ${u.losses || 0}패 ${u.draws || 0}무</td>
        <td class="right"><button class="link" data-edit="${u.id}">수정</button> <button class="link danger" data-del="${u.id}">삭제</button></td></tr>`).join('')}
    </tbody></table>`;
    tbl.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = async () => {
      const u = users.find((x) => x.id === b.dataset.edit);
      const name = prompt('이름', u.name); if (name == null) return;
      const num = prompt('번호', u.number ?? ''); if (num == null) return;
      await S.api.update(`users/${u.id}`, { name: name.trim() || u.name, number: num === '' ? null : Number(num) });
    }));
    tbl.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
      const u = users.find((x) => x.id === b.dataset.del);
      if (!confirm(`${u.name} 학생을 명단에서 지울까요? 경기 기록은 남아요.`)) return;
      await S.api.remove(`users/${u.id}`);
      if (S.api.mode === 'demo') await S.api.removeAccount(u.loginId);
    }));
  }));
}

/* ---- 문제 관리 ---- */
function tQuestions(main) {
  let qs = [];
  main.innerHTML = `
  <h2>문제 관리</h2>
  <div class="row wrap">
    <button class="btn" data-a="new">＋ 새 문항</button>
    <button class="btn ghost" data-a="seed">기본 문항 세트 넣기</button>
    <button class="btn ghost" data-a="export">내보내기(JSON)</button>
    <button class="btn ghost" data-a="import">가져오기(JSON)</button>
  </div>
  <div id="editor"></div>
  <div id="qlist"></div>`;
  const editor = main.querySelector('#editor');
  main.querySelector('[data-a=new]').onclick = () => openEditor(null);
  main.querySelector('[data-a=seed]').onclick = async () => { const n = await seedQuestions(); toast(n ? `${n}문항을 넣었어요.` : '기본 문항이 이미 모두 있어요.'); };
  main.querySelector('[data-a=export]').onclick = () => {
    const data = qs.map(({ id, createdAt, ...q }) => q);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'logic-arena-questions.json'; a.click();
  };
  main.querySelector('[data-a=import]').onclick = () => {
    editor.innerHTML = `<div class="card"><h3>JSON 가져오기</h3>
      <p class="muted small">내보내기로 받은 파일 내용을 붙여 넣으세요. 다른 반 선생님과 문항을 나눌 때 쓰면 좋아요.</p>
      <textarea id="js" rows="8"></textarea><div class="row"><button class="btn" data-a="doImport">가져오기</button><button class="btn ghost" data-a="close">닫기</button></div></div>`;
    editor.querySelector('[data-a=close]').onclick = () => (editor.innerHTML = '');
    editor.querySelector('[data-a=doImport]').onclick = async () => {
      let arr;
      try { arr = JSON.parse(editor.querySelector('#js').value); if (!Array.isArray(arr)) throw 0; } catch { return toast('JSON 형식이 올바르지 않아요.', 'bad'); }
      let n = 0;
      for (const q of arr) {
        if (!q.prompt || !Array.isArray(q.choices) || q.choices.length !== 5 || !(q.answer >= 0 && q.answer <= 4)) continue;
        await S.api.add('questions', { key: q.key || '', tag: q.tag || '', level: q.level || 1, passage: q.passage || '', box: q.box || '', prompt: q.prompt, choices: q.choices.map(String), answer: Number(q.answer), explanation: q.explanation || '', createdAt: S.api.now() });
        n++;
      }
      toast(`${n}문항을 가져왔어요.`); editor.innerHTML = '';
    };
  };

  function openEditor(q) {
    const v = q || { tag: '', level: 2, passage: '', box: '', prompt: '', choices: ['', '', '', '', ''], answer: 0, explanation: '' };
    editor.innerHTML = `<div class="card editor">
      <h3>${q ? '문항 고치기' : '새 문항'}</h3>
      <div class="row wrap">
        <label class="inline">유형 <input id="e-tag" value="${esc(v.tag)}" placeholder="예: 조건 추론" list="tags"></label>
        <datalist id="tags">${[...new Set(qs.map((x) => x.tag).filter(Boolean))].map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
        <label class="inline">난이도 <select id="e-lv">${[1, 2, 3].map((n) => `<option value="${n}" ${v.level == n ? 'selected' : ''}>${'★'.repeat(n)}</option>`).join('')}</select></label>
      </div>
      <label>지문 (없으면 비워 두기)</label><textarea id="e-passage" rows="4">${esc(v.passage)}</textarea>
      <label>발문 (묻는 말)</label><input id="e-prompt" value="${esc(v.prompt)}" placeholder="예: 위 글의 내용이 참일 때, 반드시 참인 것은?">
      <label>&lt;보기&gt; (없으면 비워 두기)</label><textarea id="e-box" rows="3">${esc(v.box)}</textarea>
      <label>선지 — 정답에 ● 표시</label>
      ${v.choices.map((c, i) => `<div class="choice-edit"><label class="radio"><input type="radio" name="e-ans" value="${i}" ${v.answer === i ? 'checked' : ''}> ${MARKS[i]}</label><input class="e-ch" value="${esc(c)}"></div>`).join('')}
      <label>해설 (대결이 끝난 뒤 학생에게 보여요)</label><textarea id="e-exp" rows="4">${esc(v.explanation)}</textarea>
      <div class="row"><button class="btn" data-a="save">저장</button><button class="btn ghost" data-a="preview">미리 보기</button><button class="btn ghost" data-a="cancel">닫기</button></div>
      <div id="pv"></div>
    </div>`;
    const read = () => ({
      tag: editor.querySelector('#e-tag').value.trim(), level: +editor.querySelector('#e-lv').value,
      passage: editor.querySelector('#e-passage').value.trim(), box: editor.querySelector('#e-box').value.trim(),
      prompt: editor.querySelector('#e-prompt').value.trim(),
      choices: [...editor.querySelectorAll('.e-ch')].map((i) => i.value.trim()),
      answer: +(editor.querySelector('input[name=e-ans]:checked')?.value ?? 0),
      explanation: editor.querySelector('#e-exp').value.trim(),
    });
    editor.querySelector('[data-a=cancel]').onclick = () => (editor.innerHTML = '');
    editor.querySelector('[data-a=preview]').onclick = () => {
      const x = read();
      editor.querySelector('#pv').innerHTML = `<article class="paper">${questionHTML(x, 0)}<ol class="choices static">${x.choices.map((c, i) => `<li class="${i === x.answer ? 'right' : ''}"><span>${MARKS[i]}</span><span class="tx">${esc(c)}</span></li>`).join('')}</ol>${x.explanation ? `<div class="expl"><b>해설</b> ${esc(x.explanation)}</div>` : ''}</article>`;
    };
    editor.querySelector('[data-a=save]').onclick = async () => {
      const x = read();
      if (!x.prompt) return toast('발문을 적어 주세요.', 'bad');
      if (x.choices.some((c) => !c)) return toast('선지 다섯 개를 모두 채워 주세요.', 'bad');
      if (new Set(x.choices).size < 5) return toast('똑같은 선지가 있어요.', 'bad');
      if (q) await S.api.update(`questions/${q.id}`, x);
      else await S.api.add('questions', { ...x, key: '', createdAt: S.api.now() });
      toast('저장했어요'); editor.innerHTML = '';
    };
    editor.scrollIntoView({ behavior: 'smooth' });
  }

  track(S.api.watchCol('questions', (list) => {
    qs = list.sort((a, b) => (a.key || 'zz' + a.createdAt).localeCompare(b.key || 'zz' + b.createdAt));
    const el = main.querySelector('#qlist');
    if (!qs.length) { el.innerHTML = '<p class="empty">문항이 없어요. 「기본 문항 세트 넣기」를 눌러 시작해 보세요.</p>'; return; }
    el.innerHTML = `<p class="muted small">모두 ${qs.length}문항</p>` + qs.map((q, i) => `
      <div class="qrow"><div><span class="qtag">${esc(q.tag || '논리')}</span> <span class="lv">${'★'.repeat(q.level || 1)}</span>
        <p>${esc(q.passage ? q.passage.slice(0, 70) + (q.passage.length > 70 ? '…' : '') : q.box.slice(0, 70))}</p>
        <p class="muted small">${esc(q.prompt)} · 정답 ${MARKS[q.answer]}</p></div>
        <div class="col"><button class="link" data-ed="${q.id}">고치기</button><button class="link danger" data-rm="${q.id}">지우기</button></div></div>`).join('');
    el.querySelectorAll('[data-ed]').forEach((b) => (b.onclick = () => openEditor(qs.find((x) => x.id === b.dataset.ed))));
    el.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => { if (confirm('이 문항을 지울까요? 이미 끝난 경기 기록에는 남아 있어요.')) await S.api.remove(`questions/${b.dataset.rm}`); }));
  }));
}

/* ---- 순위표 (선생님·학생 공용) ---- */
function rankTable(users, meId) {
  const st = users.filter((u) => u.role === 'student').sort((a, b) => (b.rating ?? START_RATING) - (a.rating ?? START_RATING) || (b.wins || 0) - (a.wins || 0));
  if (!st.length) return '<p class="empty">아직 학생이 없어요.</p>';
  let rank = 0, prev = null;
  return `<table class="rank"><thead><tr><th>순위</th><th>이름</th><th>등급</th><th>점수</th><th>전적</th></tr></thead><tbody>
    ${st.map((u, i) => { const r = u.rating ?? START_RATING; if (r !== prev) { rank = i + 1; prev = r; }
      return `<tr class="${u.id === meId ? 'me' : ''}"><td class="rk r${rank}">${rank}</td><td>${esc(u.name)}</td><td>${tierBadge(r)}</td><td><b>${r}</b></td><td>${u.wins || 0}승 ${u.losses || 0}패 ${u.draws || 0}무</td></tr>`; }).join('')}
  </tbody></table>`;
}
function tRank(main) {
  main.innerHTML = '<h2>순위표</h2><div class="card" id="r"></div><p class="muted small">모든 학생은 1000점에서 시작해요. 강한 상대를 이기면 많이 오르고, 약한 상대에게 지면 많이 내려가요(Elo 방식).</p>';
  track(S.api.watchCol('users', (us) => (main.querySelector('#r').innerHTML = rankTable(us))));
}

/* ---- 경기 기록 ---- */
function historyList(ms, meId) {
  if (!ms.length) return '<p class="empty">끝난 경기가 없어요.</p>';
  return ms.sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0)).map((m) => {
    const [a, b] = m.players;
    const res = m.winner === 'draw' ? '무승부' : `${esc(m.names[m.winner])} 승`;
    const mine = meId ? (m.winner === 'draw' ? 'draw' : m.winner === meId ? 'win' : 'lose') : '';
    return `<div class="hrow ${mine}"><span class="muted small">${fmtDate(m.endedAt)}</span>
      <span class="vs"><span>${esc(m.names[a])}</span><b>${m.scores?.[a] || 0} : ${m.scores?.[b] || 0}</b><span>${esc(m.names[b])}</span></span>
      <span class="res">${res}</span><button class="link" data-rv="${m.id}">다시 보기</button></div>`;
  }).join('');
}
function tHistory(main) {
  main.innerHTML = '<h2>경기 기록</h2><div class="card" id="h"></div>';
  track(S.api.watchWhere('matches', 'status', '==', 'done', (ms) => {
    const el = main.querySelector('#h');
    el.innerHTML = historyList(ms);
    el.querySelectorAll('[data-rv]').forEach((b) => (b.onclick = () => renderReview(ms.find((m) => m.id === b.dataset.rv))));
  }));
}

/* ---- 설정 ---- */
function tSettings(main) {
  const demo = S.api.mode === 'demo';
  let link = '';
  if (!demo) {
    const cfg = JSON.parse(localStorage.getItem(CFG_KEY));
    link = `${location.origin}${location.pathname}?c=${encodeConfig(cfg)}`;
  }
  main.innerHTML = `
  <h2>설정</h2>
  <div class="card">
    <h3>반 이름</h3>
    <div class="row"><input id="cn" value="${esc(S.settings?.className || '')}"><button class="btn" data-a="cn">저장</button></div>
  </div>
  <div class="card">
    <h3>학생 접속 링크</h3>
    ${demo ? '<p class="muted">데모 모드에서는 접속 링크가 없어요. Firebase를 연결하면 생겨요.</p>' : `
      <p class="muted small">학생은 이 링크나 QR 코드로 한 번만 들어오면 돼요. 그다음부터는 사이트 주소만 열어도 우리 반으로 연결돼요.</p>
      <div class="row"><input id="lk" value="${esc(link)}" readonly><button class="btn" data-a="copy">복사</button></div>
      <div id="qr" class="qr"></div>`}
  </div>
  <div class="card">
    <h3>새 시즌 시작</h3>
    <p class="muted small">모든 학생의 점수를 1000점으로, 전적을 0으로 되돌려요. 경기 기록은 남아요.</p>
    <button class="btn ghost danger" data-a="season">점수 초기화</button>
  </div>
  <div class="card">
    <h3>이 기기</h3>
    <button class="btn ghost" data-a="reset">${demo ? '데모 끝내기' : '연결 바꾸기'}</button>
    ${demo ? '<button class="btn ghost danger" data-a="resetDemo">데모 데이터 초기화</button>' : ''}
  </div>`;
  main.querySelector('[data-a=cn]').onclick = async () => {
    const v = main.querySelector('#cn').value.trim(); if (!v) return;
    await S.api.update('meta/settings', { className: v }); S.settings.className = v; toast('저장했어요');
  };
  main.querySelector('[data-a=reset]').onclick = resetConnection;
  const rd = main.querySelector('[data-a=resetDemo]');
  if (rd) rd.onclick = () => { if (confirm('데모 데이터를 모두 지울까요?')) { S.api.resetDemo(); location.reload(); } };
  main.querySelector('[data-a=season]').onclick = async () => {
    if (!confirm('정말 모든 학생의 점수와 전적을 초기화할까요?')) return;
    const us = (await S.api.list('users')).filter((u) => u.role === 'student');
    for (const u of us) await S.api.update(`users/${u.id}`, { rating: START_RATING, wins: 0, losses: 0, draws: 0 });
    toast('새 시즌을 시작했어요!');
  };
  if (!demo) {
    main.querySelector('[data-a=copy]').onclick = () => copyText(link);
    const qr = main.querySelector('#qr');
    if (window.QRCode) new window.QRCode(qr, { text: link, width: 200, height: 200, correctLevel: window.QRCode.CorrectLevel.L });
    else qr.innerHTML = '<p class="muted small">QR 코드를 불러오지 못했어요.</p>';
  }
}

/* ============================== 학생 ============================== */
function renderStudentHome() {
  leave();
  $app.innerHTML = `
  <header class="top">
    <div class="brand sm"><span class="logo">∴</span><div><b>논리 아레나</b><small>${esc(S.settings?.className || '')}</small></div></div>
    <button class="btn ghost sm" data-a="logout">로그아웃</button>
  </header>
  ${S.api.mode === 'demo' ? '<div class="demo-strip">데모 모드 — 이 브라우저에만 저장됩니다</div>' : ''}
  <main class="student">
    <section class="me card" id="me"></section>
    <section id="active"></section>
    <section class="card">
      <h3>연습하기</h3>
      <p class="muted small">점수에 반영되지 않아요. 문항 5개를 풀고 해설을 바로 확인해요.</p>
      <button class="btn" data-a="practice">연습 시작</button>
    </section>
    <section class="card"><h3>우리 반 순위</h3><div id="rank"></div></section>
    <section class="card"><h3>내 경기 기록</h3><div id="hist"></div></section>
  </main>`;
  $app.querySelector('[data-a=logout]').onclick = () => S.api.signOut();
  $app.querySelector('[data-a=practice]').onclick = renderPractice;

  const drawMe = (u) => {
    if (!u) return;
    const r = u.rating ?? START_RATING;
    const t = tierOf(r), next = [...TIERS].reverse().find((x) => x.min > r);
    $app.querySelector('#me').innerHTML = `
      <div class="me-row"><div><p class="muted small">${u.number ?? ''}번</p><h2>${esc(u.name)}</h2>${tierBadge(r)}</div>
      <div class="rating"><b>${r}</b><small>점</small></div></div>
      <p class="muted small">${u.wins || 0}승 ${u.losses || 0}패 ${u.draws || 0}무${next ? ` · 「${next.name}」까지 ${next.min - r}점` : ' · 최고 등급!'}</p>`;
  };
  track(S.api.watch(`users/${S.uid}`, (u) => { S.me = u || S.me; drawMe(u); }));
  track(S.api.watchCol('users', (us) => ($app.querySelector('#rank').innerHTML = rankTable(us, S.uid))));
  track(S.api.watchWhere('matches', 'players', 'array-contains', S.uid, (ms) => {
    const act = ms.filter((m) => m.status === 'ready' || m.status === 'playing');
    const el = $app.querySelector('#active');
    el.innerHTML = act.map((m) => {
      const opp = m.players.find((p) => p !== S.uid);
      return `<div class="card call"><p class="small">⚔️ 대결이 배정됐어요!</p>
        <h2>VS ${esc(m.names[opp])}</h2>
        <p class="muted small">${m.questions.length}문항 · 문항당 ${m.timeLimit}초</p>
        <button class="btn big" data-go="${m.id}">${m.status === 'playing' ? '대결로 돌아가기' : '입장하기'}</button></div>`;
    }).join('');
    el.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => renderMatch(b.dataset.go)));
    const hist = $app.querySelector('#hist');
    hist.innerHTML = historyList(ms.filter((m) => m.status === 'done'), S.uid);
    hist.querySelectorAll('[data-rv]').forEach((b) => (b.onclick = () => renderReview(ms.find((m) => m.id === b.dataset.rv))));
  }));
}

/* ============================== 1:1 대결 ============================== */
function renderMatch(mid, { spectator = false } = {}) {
  leave();
  const path = `matches/${mid}`;
  const me = S.uid;
  let m = null;
  const L = { key: null, t0: 0, busy: false, expired: false, finalizing: false };

  const back = () => (S.me?.role === 'teacher' ? renderTeacher(spectator ? 'live' : 'history') : renderStudentHome());
  $app.innerHTML = '<div class="arena"><div id="stage"><p class="muted center-text">불러오는 중…</p></div></div>';
  const stage = $app.querySelector('#stage');

  track(S.api.watch(path, (d) => {
    m = d;
    if (!m) { stage.innerHTML = '<div class="card"><p>경기를 찾을 수 없어요.</p><button class="btn" id="bk">돌아가기</button></div>'; stage.querySelector('#bk').onclick = back; return; }
    const key = `${m.status}:${m.round}:${m.phase}`;
    if (key !== L.key) { L.key = key; L.t0 = performance.now(); L.expired = false; }
    const isPlayer = m.players.includes(me);
    if (isPlayer && !spectator && m.status === 'ready' && !m.ready?.[me]) S.api.update(path, { [`ready.${me}`]: true });
    if (m.status === 'ready' && m.players.every((p) => m.ready?.[p])) {
      S.api.tx(path, (x) => (x.status === 'ready' && x.players.every((p) => x.ready?.[p])
        ? { status: 'playing', round: 0, phase: 'question', startedAt: S.api.now() } : null));
    }
    draw();
    drive();
  }));
  trackTimer(setInterval(drive, 200));

  function names() {
    const p0 = spectator || !m.players.includes(me) ? m.players[0] : me;
    const p1 = m.players.find((p) => p !== p0);
    return [p0, p1];
  }

  function scorebar() {
    const [a, b] = names();
    const n = m.questions.length;
    return `<div class="scorebar">
      <div class="side ${spectator ? '' : 'mine'}"><span class="nm">${esc(m.names[a])}${spectator ? '' : ' (나)'}</span><b class="sc">${m.scores?.[a] || 0}</b></div>
      <div class="mid"><span class="rd">${m.status === 'playing' ? `${m.round + 1} / ${n}` : ''}</span><span class="clock" id="clock"></span></div>
      <div class="side"><b class="sc">${m.scores?.[b] || 0}</b><span class="nm">${esc(m.names[b])}</span></div>
    </div><div class="timebar"><i id="tbar"></i></div>`;
  }

  function draw() {
    if (!m) return;
    const [a, b] = names();
    if (m.status === 'cancelled') {
      stage.innerHTML = `<div class="card narrow center-text"><h2>경기가 취소됐어요</h2><button class="btn" id="bk">돌아가기</button></div>`;
      stage.querySelector('#bk').onclick = back; return;
    }
    if (m.status === 'ready') {
      stage.innerHTML = `<div class="card narrow center-text waiting">
        <p class="small muted">${m.questions.length}문항 · 문항당 ${m.timeLimit}초</p>
        <h2>${esc(m.names[a])} <span class="vs-mark">VS</span> ${esc(m.names[b])}</h2>
        <div class="readies">${m.players.map((p) => `<span class="${m.ready?.[p] ? 'ok' : ''}">${esc(m.names[p])} ${m.ready?.[p] ? '입장 ✓' : '기다리는 중…'}</span>`).join('')}</div>
        <p class="muted small">두 사람이 모두 들어오면 바로 시작해요.</p>
        <button class="btn ghost" id="bk">나가기</button></div>`;
      stage.querySelector('#bk').onclick = back; return;
    }
    if (m.status === 'done') return drawResult();

    const r = m.round, q = m.questions[r];
    const lim = m.timeLimit * 1000;
    const myAns = m.answers?.[me]?.[r];
    const reveal = m.phase === 'reveal';
    const pickOf = (p) => m.answers?.[p]?.[r]?.c;
    const answered = (p) => m.answers?.[p]?.[r] != null;
    const canPick = !spectator && m.players.includes(me) && !reveal && myAns == null && !L.expired;

    const choiceCls = (i) => {
      const c = [];
      if (reveal && i === q.answer) c.push('right');
      if (!spectator && pickOf(me) === i) c.push(reveal && i !== q.answer ? 'wrong' : 'picked');
      return c.join(' ');
    };
    const markers = (i) => reveal ? m.players.filter((p) => pickOf(p) === i).map((p) => `<em class="who">${esc(m.names[p])}</em>`).join('') : '';

    let status = '';
    if (reveal) {
      const pts = m.pts?.[r] || {};
      status = `<div class="reveal-box">${[a, b].map((p) => {
        const ok = pickOf(p) === q.answer;
        return `<span class="${ok ? 'ok' : 'no'}">${esc(m.names[p])} ${pickOf(p) == null ? '시간 초과' : ok ? '정답' : '오답'} <b>+${pts[p] || 0}</b></span>`;
      }).join('')}</div>
      ${q.explanation ? `<div class="expl"><b>해설</b> ${esc(q.explanation)}</div>` : ''}
      <p class="muted small center-text">${r + 1 < m.questions.length ? '잠시 뒤 다음 문항으로 넘어가요' : '잠시 뒤 결과가 나와요'}</p>`;
    } else if (spectator || !m.players.includes(me)) {
      status = `<p class="waitline">${[a, b].map((p) => `${esc(m.names[p])} ${answered(p) ? '✓ 답함' : '… 푸는 중'}`).join(' · ')}</p>`;
    } else if (myAns != null) {
      const opp = b;
      status = `<p class="waitline">답을 냈어요. ${answered(opp) ? '상대도 답했어요!' : '상대를 기다리는 중…'}</p>`;
    } else if (L.expired) {
      status = '<p class="waitline bad">시간이 다 됐어요.</p>';
    } else {
      status = `<p class="waitline">${answered(b) ? '⚡ 상대가 먼저 답했어요!' : '정답을 고르세요. 빨리 맞힐수록 보너스 점수!'}</p>`;
    }

    stage.innerHTML = `
      ${scorebar()}
      <article class="paper">
        ${questionHTML(q, r, m.questions.length)}
        <ol class="choices">${q.choices.map((c, i) => `<li><button class="${choiceCls(i)}" data-c="${i}" ${canPick ? '' : 'disabled'}><span>${MARKS[i]}</span><span class="tx">${esc(c)}</span>${markers(i)}</button></li>`).join('')}</ol>
      </article>
      ${status}
      ${spectator ? '<div class="center-text"><button class="btn ghost sm" id="bk">관전 그만하기</button></div>' : ''}`;
    stage.querySelectorAll('[data-c]').forEach((btn) => (btn.onclick = () => answer(+btn.dataset.c)));
    const bk = stage.querySelector('#bk'); if (bk) bk.onclick = back;
    updateClock();
  }

  function answer(i) {
    if (!m || m.status !== 'playing' || m.phase !== 'question') return;
    const r = m.round;
    if (m.answers?.[me]?.[r] != null) return;
    const el = performance.now() - L.t0;
    if (el > m.timeLimit * 1000) return;
    m.answers = m.answers || {}; m.answers[me] = m.answers[me] || {}; m.answers[me][r] = { c: i, t: Math.round(el) };
    draw();
    S.api.update(path, { [`answers.${me}.${r}`]: { c: i, t: Math.round(el) } }).catch((e) => toast(errMsg(e), 'bad'));
  }

  function updateClock() {
    if (!m || m.status !== 'playing') return;
    const el = performance.now() - L.t0;
    const bar = stage.querySelector('#tbar'), clock = stage.querySelector('#clock');
    if (!bar) return;
    if (m.phase === 'question') {
      const lim = m.timeLimit * 1000;
      const left = Math.max(0, lim - el);
      bar.style.width = `${(left / lim) * 100}%`;
      bar.className = left < 10000 ? 'hurry' : '';
      clock.textContent = `${Math.ceil(left / 1000)}초`;
    } else {
      bar.style.width = `${Math.max(0, 1 - el / REVEAL_MS) * 100}%`;
      bar.className = 'rev';
      clock.textContent = '채점';
    }
  }

  async function drive() {
    if (!m || m.status !== 'playing') return;
    updateClock();
    const r = m.round, lim = m.timeLimit * 1000;
    const el = performance.now() - L.t0;
    if (m.phase === 'question' && !L.expired && el > lim) { L.expired = true; draw(); }
    if (L.busy) return;
    if (m.phase === 'question') {
      const all = m.players.every((p) => m.answers?.[p]?.[r] != null);
      if (!(all || el > lim + 1500)) return;
      L.busy = true;
      await S.api.tx(path, (x) => {
        if (x.status !== 'playing' || x.round !== r || x.phase !== 'question') return null;
        const q = x.questions[r];
        const upd = { phase: 'reveal' };
        for (const p of x.players) {
          const a = x.answers?.[p]?.[r];
          const ok = a && a.c === q.answer;
          const pts = ok ? 100 + Math.round(50 * Math.max(0, 1 - a.t / (x.timeLimit * 1000))) : 0;
          upd[`pts.${r}.${p}`] = pts;
          upd[`scores.${p}`] = (x.scores?.[p] || 0) + pts;
          upd[`correct.${p}`] = (x.correct?.[p] || 0) + (ok ? 1 : 0);
        }
        return upd;
      });
      L.busy = false;
    } else if (m.phase === 'reveal' && el > REVEAL_MS) {
      L.busy = true;
      const last = r + 1 >= m.questions.length;
      const won = await S.api.tx(path, (x) => {
        if (x.status !== 'playing' || x.round !== r || x.phase !== 'reveal') return null;
        if (!last) return { round: r + 1, phase: 'question' };
        const [p, o] = x.players;
        const sp = x.scores?.[p] || 0, so = x.scores?.[o] || 0;
        return { status: 'done', phase: 'end', endedAt: S.api.now(), winner: sp === so ? 'draw' : sp > so ? p : o };
      });
      if (won && last) await finalizeRatings(path);
      L.busy = false;
    }
  }

  function drawResult() {
    const [a, b] = names();
    const isPlayer = m.players.includes(me) && !spectator;
    let title;
    if (m.winner === 'draw') title = '무승부!';
    else if (isPlayer) title = m.winner === me ? '승리!' : '아쉬운 패배';
    else title = `${esc(m.names[m.winner])} 승리`;
    const delta = (p) => (m.ratingDelta?.[p] == null ? '' : `<small class="${m.ratingDelta[p] >= 0 ? 'up' : 'down'}">${m.ratingDelta[p] >= 0 ? '+' : ''}${m.ratingDelta[p]}점</small>`);
    stage.innerHTML = `
      <div class="card narrow center-text result ${isPlayer ? (m.winner === me ? 'win' : m.winner === 'draw' ? 'draw' : 'lose') : ''}">
        <p class="small muted">경기 종료</p>
        <h1>${title}</h1>
        <div class="final">
          ${[a, b].map((p) => `<div><span class="nm">${esc(m.names[p])}</span><b>${m.scores?.[p] || 0}</b><span class="muted small">${m.correct?.[p] || 0}/${m.questions.length} 정답</span>${delta(p)}</div>`).join('<span class="vs-mark">VS</span>')}
        </div>
        ${m.ratingDelta ? '' : '<p class="muted small">점수를 반영하는 중…</p>'}
        <div class="row jc"><button class="btn" id="rv">문항 다시 보기</button><button class="btn ghost" id="bk">${isPlayer ? '홈으로' : '돌아가기'}</button></div>
      </div>`;
    stage.querySelector('#bk').onclick = back;
    stage.querySelector('#rv').onclick = () => renderReview({ ...m, id: mid });
  }
}

async function finalizeRatings(path) {
  const x = await S.api.get(path);
  if (!x || x.ratingDelta) return;
  const [a, b] = x.players;
  const [ua, ub] = await Promise.all([S.api.get(`users/${a}`), S.api.get(`users/${b}`)]);
  const ra = ua?.rating ?? START_RATING, rb = ub?.rating ?? START_RATING;
  const sa = x.winner === 'draw' ? 0.5 : x.winner === a ? 1 : 0;
  const ea = 1 / (1 + 10 ** ((rb - ra) / 400));
  const da = Math.round(32 * (sa - ea));
  const dbb = -da;
  const res = (s) => (s === 1 ? 'wins' : s === 0 ? 'losses' : 'draws');
  try {
    if (ua) await S.api.update(`users/${a}`, { rating: S.api.inc(da), [res(sa)]: S.api.inc(1) });
    if (ub) await S.api.update(`users/${b}`, { rating: S.api.inc(dbb), [res(1 - sa)]: S.api.inc(1) });
  } catch (e) { console.warn('rating', e); }
  await S.api.update(path, { ratingDelta: { [a]: da, [b]: dbb } });
}

/* ---- 다시 보기 ---- */
function renderReview(m) {
  leave();
  const me = S.uid;
  const isTeacher = S.me?.role === 'teacher';
  const [a, b] = m.players.includes(me) ? [me, m.players.find((p) => p !== me)] : m.players;
  $app.innerHTML = `<div class="arena review">
    <div class="row between"><button class="btn ghost sm" id="bk">← 돌아가기</button><span class="muted small">${fmtDate(m.endedAt)}</span></div>
    <h2 class="center-text">${esc(m.names[a])} <b>${m.scores?.[a] || 0} : ${m.scores?.[b] || 0}</b> ${esc(m.names[b])}</h2>
    ${m.questions.map((q, r) => {
      const pk = (p) => m.answers?.[p]?.[r]?.c;
      return `<article class="paper">
        ${questionHTML(q, r, m.questions.length)}
        <ol class="choices static">${q.choices.map((c, i) => `<li class="${i === q.answer ? 'right' : (pk(a) === i || pk(b) === i) ? 'wrong' : ''}"><span>${MARKS[i]}</span><span class="tx">${esc(c)}</span>
          ${[a, b].filter((p) => pk(p) === i).map((p) => `<em class="who">${esc(m.names[p])}</em>`).join('')}</li>`).join('')}</ol>
        <p class="small">${[a, b].map((p) => `${esc(m.names[p])}: ${pk(p) == null ? '시간 초과' : MARKS[pk(p)]} <b>+${m.pts?.[r]?.[p] || 0}</b>`).join(' · ')}</p>
        ${q.explanation ? `<div class="expl"><b>해설</b> ${esc(q.explanation)}</div>` : ''}
      </article>`;
    }).join('')}
  </div>`;
  $app.querySelector('#bk').onclick = () => (isTeacher ? renderTeacher('history') : renderStudentHome());
}

/* ============================== 연습 ============================== */
async function renderPractice() {
  leave();
  const all = await S.api.list('questions');
  if (!all.length) { toast('아직 문항이 없어요.', 'bad'); return renderStudentHome(); }
  const qs = shuffle(all).slice(0, 5);
  let i = 0, score = 0, pick = null;
  const draw = () => {
    if (i >= qs.length) {
      $app.innerHTML = `<div class="arena"><div class="card narrow center-text result"><p class="small muted">연습 끝</p><h1>${score} / ${qs.length}</h1>
        <p>${score === qs.length ? '완벽해요! 대결에서도 이 실력이면 걱정 없어요.' : '틀린 문항의 해설을 다시 떠올려 보세요.'}</p>
        <div class="row jc"><button class="btn" id="again">한 번 더</button><button class="btn ghost" id="home">홈으로</button></div></div></div>`;
      $app.querySelector('#again').onclick = renderPractice;
      $app.querySelector('#home').onclick = renderStudentHome;
      return;
    }
    const q = qs[i];
    const done = pick != null;
    $app.innerHTML = `<div class="arena">
      <div class="row between"><button class="btn ghost sm" id="home">← 그만하기</button><span class="muted">연습 · 맞힌 문항 ${score}</span></div>
      <article class="paper">${questionHTML(q, i, qs.length)}
        <ol class="choices">${q.choices.map((c, k) => `<li><button data-c="${k}" class="${done && k === q.answer ? 'right' : done && k === pick ? 'wrong' : ''}" ${done ? 'disabled' : ''}><span>${MARKS[k]}</span><span class="tx">${esc(c)}</span></button></li>`).join('')}</ol>
      </article>
      ${done ? `<div class="reveal-box"><span class="${pick === q.answer ? 'ok' : 'no'}">${pick === q.answer ? '정답이에요!' : `아쉬워요. 정답은 ${MARKS[q.answer]}`}</span></div>
        ${q.explanation ? `<div class="expl"><b>해설</b> ${esc(q.explanation)}</div>` : ''}
        <div class="center-text"><button class="btn" id="next">${i + 1 < qs.length ? '다음 문항' : '결과 보기'}</button></div>` : ''}
    </div>`;
    $app.querySelector('#home').onclick = renderStudentHome;
    $app.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => { pick = +b.dataset.c; if (pick === q.answer) score++; draw(); }));
    const nx = $app.querySelector('#next');
    if (nx) nx.onclick = () => { i++; pick = null; draw(); window.scrollTo(0, 0); };
  };
  draw();
}

boot();
