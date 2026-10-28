'use strict';
/* 레슨 관리 화면 (GitHub Pages). 데이터는 전부 Apps Script API에서 받아옵니다. */

const $ = (s, r) => (r || document).querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
const won = n => (Number(n) || 0).toLocaleString('ko-KR') + '원';

const S = { role: null, data: null, pub: null, tab: null, loginTab: 'student', adminHasPw: null, f: { student: '', view: 'planned' } };
const store = {
  get tok() { return sessionStorage.getItem('tok'); },
  set tok(v) { v ? sessionStorage.setItem('tok', v) : sessionStorage.removeItem('tok'); },
  get role() { return sessionStorage.getItem('role'); },
  set role(v) { v ? sessionStorage.setItem('role', v) : sessionStorage.removeItem('role'); }
};

/* ───── 공통 ───── */

async function api(action, payload) {
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // 사전요청(CORS preflight)을 피하기 위해 text/plain 사용
      body: JSON.stringify(Object.assign({ action: action, token: store.tok }, payload || {}))
    });
  } catch (e) {
    throw new Error('서버에 연결할 수 없습니다. config.js의 API_URL과 배포 설정을 확인하세요.');
  }
  let j;
  try { j = await res.json(); } catch (e) { throw new Error('서버 응답을 읽을 수 없습니다. 웹 앱 배포의 접근 권한이 "모든 사용자"인지 확인하세요.'); }
  if (!j.ok) {
    if (j.auth) { store.tok = null; store.role = null; S.role = null; S.data = null; }
    const err = new Error(j.error); err.auth = j.auth; throw err;
  }
  return j.data;
}

let toastTimer;
function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg; t.className = isErr ? 'err' : ''; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isErr ? 5000 : 2200);
}

async function run(fn) {
  try { return await fn(); }
  catch (e) { toast(e.message, true); if (e.auth) render(); }
}

function ytId(url) { const m = String(url || '').match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/); return m ? m[1] : null; }
function driveId(v) { const s = String(v || '').trim(); const m = s.match(/\/d\/([\w-]{20,})/) || s.match(/[?&]id=([\w-]{20,})/); return m ? m[1] : s; }
function chip(s) { return `<span class="chip ${esc(s)}">${esc(s)}</span>`; }
function fmtDate(d) { if (!d) return ''; const p = String(d).split('-'); const dt = new Date(+p[0], +p[1] - 1, +p[2]); return `${p[1]}/${p[2]} (${'일월화수목금토'[dt.getDay()]})`; }
function byDate(a, b) { return (a.날짜 + a.시작).localeCompare(b.날짜 + b.시작); }

async function openFile(id) {
  const w = window.open('', '_blank');
  try {
    const f = await api('getFile', { id: id });
    const bin = atob(f.data); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([arr], { type: f.mime }));
    if (w) w.location = url; else location.href = url;
  } catch (e) { if (w) w.close(); toast(e.message, true); }
}

/* ───── 입력 팝업 ───── */

function fieldHTML(f, v) {
  const val = v == null ? '' : v;
  const hint = f.hint ? `<div class="hint">${esc(f.hint)}</div>` : '';
  let input;
  if (f.type === 'select') {
    input = `<select name="${f.k}">${f.options.map(o => `<option value="${esc(o[0])}" ${String(o[0]) === String(val) ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
  } else if (f.type === 'multi') {
    const sel = String(val).split(',').map(s => s.trim().toLowerCase());
    input = `<select name="${f.k}" multiple>${f.options.map(o => `<option value="${esc(o[0])}" ${sel.indexOf(String(o[0]).toLowerCase()) >= 0 ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
  } else if (f.type === 'textarea') {
    input = `<textarea name="${f.k}">${esc(val)}</textarea>`;
  } else {
    input = `<input name="${f.k}" type="${f.type || 'text'}" value="${esc(val)}" ${f.ph ? `placeholder="${esc(f.ph)}"` : ''}>`;
  }
  return `<label>${esc(f.label)}</label>${input}${hint}`;
}

function openForm(title, fields, vals, onSave, sub) {
  const d = document.createElement('dialog');
  d.innerHTML = `<form><h3>${esc(title)}</h3>${sub ? `<div class="hint">${esc(sub)}</div>` : ''}${fields.map(f => fieldHTML(f, (vals || {})[f.k])).join('')}
    <div class="row end"><button type="button" class="ghost" data-x>취소</button><button class="primary">저장</button></div></form>`;
  document.body.appendChild(d); d.showModal();
  const close = () => { d.close(); d.remove(); };
  d.querySelector('[data-x]').onclick = close;
  d.querySelector('form').onsubmit = async ev => {
    ev.preventDefault();
    const o = {};
    fields.forEach(f => {
      const el = d.querySelector(`[name="${f.k}"]`);
      o[f.k] = f.type === 'multi' ? Array.from(el.selectedOptions).map(x => x.value).join(',') : el.value.trim();
    });
    try { await onSave(o); close(); } catch (e) { toast(e.message, true); }
  };
}

/* ───── 화면 전환 ───── */

async function render() {
  const app = $('#app');
  if (S.role === 'student' && S.data) return viewStudent(app);
  if (S.role === 'admin' && S.data) return viewAdmin(app);
  S.role = null;
  if (!S.pub) { try { S.pub = await api('publicData'); } catch (e) { S.pub = { materials: [], videos: [], error: e.message }; } }
  viewPublic(app);
}

async function boot() {
  if (store.tok && store.role) {
    try {
      S.role = store.role;
      S.data = await api(store.role === 'admin' ? 'adminData' : 'studentData');
      S.tab = store.role === 'admin' ? 'home' : 'lessons';
    } catch (e) { S.role = null; S.data = null; store.tok = null; store.role = null; }
  }
  render();
}

function logout() { store.tok = null; store.role = null; S.role = null; S.data = null; S.pub = null; render(); }

/* ───── 메인(공개) + 로그인 ───── */

function viewPublic(app) {
  const p = S.pub;
  app.innerHTML = `
  <header class="top"><h1>${esc(SITE_TITLE)}</h1></header>
  <main>
    ${p.error ? `<div class="alert">${esc(p.error)}</div>` : ''}
    <div class="card login">
      <div class="seg"><button data-act="lt" data-v="student" class="${S.loginTab === 'student' ? 'on' : ''}">학생</button>
      <button data-act="lt" data-v="admin" class="${S.loginTab === 'admin' ? 'on' : ''}">선생님</button></div>
      <div id="loginBody"></div>
    </div>
    <div class="card"><h2>공개 연습자료</h2>${materialList(p.materials)}</div>
    <div class="card"><h2>영상</h2>${videoGrid(p.videos)}</div>
  </main>`;
  loginBody();
}

async function loginBody() {
  const box = $('#loginBody'); if (!box) return;
  if (S.loginTab === 'student') {
    box.innerHTML = `<form id="fs"><label>내 고유번호</label><input name="code" autocomplete="off" autocapitalize="off" placeholder="선생님께 받은 번호">
      <div class="row end"><button class="primary">로그인</button></div></form>`;
    $('#fs').onsubmit = ev => { ev.preventDefault(); run(async () => {
      const r = await api('loginStudent', { code: ev.target.code.value });
      store.tok = r.token; store.role = 'student'; S.role = 'student';
      S.data = await api('studentData'); S.tab = 'lessons'; render();
    }); };
    return;
  }
  if (S.adminHasPw === null) {
    box.innerHTML = '<div class="empty">확인 중…</div>';
    try { S.adminHasPw = (await api('adminState')).hasPassword; } catch (e) { box.innerHTML = `<div class="alert">${esc(e.message)}</div>`; return; }
  }
  if (!S.adminHasPw) {
    box.innerHTML = `<form id="fa"><div class="hint">처음 사용입니다. 관리자 비밀번호를 만드세요 (8자 이상).</div>
      <label>새 비밀번호</label><input type="password" name="p1" autocomplete="new-password">
      <label>비밀번호 확인</label><input type="password" name="p2" autocomplete="new-password">
      <div class="row end"><button class="primary">비밀번호 만들기</button></div></form>`;
    $('#fa').onsubmit = ev => { ev.preventDefault(); run(async () => {
      if (ev.target.p1.value !== ev.target.p2.value) throw new Error('비밀번호가 서로 다릅니다');
      const r = await api('setupAdmin', { password: ev.target.p1.value });
      S.adminHasPw = true; await enterAdmin(r.token);
    }); };
  } else {
    box.innerHTML = `<form id="fa"><label>관리자 비밀번호</label><input type="password" name="pw" autocomplete="current-password">
      <div class="row end"><button class="primary">로그인</button></div></form>`;
    $('#fa').onsubmit = ev => { ev.preventDefault(); run(async () => {
      const r = await api('loginAdmin', { password: ev.target.pw.value });
      await enterAdmin(r.token);
    }); };
  }
}

async function enterAdmin(token) {
  store.tok = token; store.role = 'admin'; S.role = 'admin';
  S.data = await api('adminData'); S.tab = 'home'; render();
}

function materialList(list) {
  if (!list || !list.length) return '<div class="empty">자료가 없습니다.</div>';
  return list.map(m => `<div class="list-item"><div>${esc(m.제목)}<small>${esc(m.분류 || '')} ${esc(m.메모 || '')}</small></div>
    <button class="ghost sm" data-act="file" data-id="${esc(m.자료ID)}">열기</button></div>`).join('');
}

function videoGrid(list) {
  if (!list || !list.length) return '<div class="empty">영상이 없습니다.</div>';
  return `<div class="vgrid">${list.map(v => {
    const id = ytId(v.유튜브링크);
    return `<div>${id ? `<iframe class="video" src="https://www.youtube-nocookie.com/embed/${id}" allowfullscreen loading="lazy"></iframe>` : `<a href="${esc(v.유튜브링크)}" target="_blank" rel="noopener">링크 열기</a>`}
      <div style="margin-top:4px">${esc(v.제목)}</div><div class="hint">${esc(v.메모 || '')}</div></div>`;
  }).join('')}</div>`;
}

/* ───── 학생 화면 ───── */

function viewStudent(app) {
  const d = S.data, s = d.summary;
  const tabs = [['lessons', '내 일정'], ['journals', '레슨일지'], ['materials', '자료'], ['videos', '영상'], ['pay', '결제']];
  app.innerHTML = `
  <header class="top"><h1>${esc(SITE_TITLE)}</h1><div class="row"><span class="muted">${esc(d.profile.이름)}님</span><button class="ghost sm" data-act="logout">로그아웃</button></div></header>
  <main>
    <div class="grid" style="margin-bottom:16px">
      <div class="stat big ${s.remaining <= 1 ? 'low' : ''}"><b>${s.remaining}회</b><span>남은 레슨</span></div>
      <div class="stat"><b>${s.paid}회</b><span>결제한 회차</span></div>
      <div class="stat"><b>${s.used}회</b><span>진행(차감)</span></div>
      <div class="stat"><b>${s.attended}/${s.absent}/${s.postponed}</b><span>출석/결석/연기</span></div>
    </div>
    <div class="tabs">${tabs.map(t => `<button data-act="tab" data-v="${t[0]}" class="${S.tab === t[0] ? 'on' : ''}">${t[1]}</button>`).join('')}</div>
    <div id="tabBody"></div>
  </main>`;
  const b = $('#tabBody');
  if (S.tab === 'lessons') {
    const up = d.lessons.filter(l => l.상태 === '예정').sort(byDate);
    const past = d.lessons.filter(l => l.상태 !== '예정').sort(byDate).reverse();
    b.innerHTML = `<div class="card"><h2>예정된 레슨</h2>${lessonTable(up, false)}</div><div class="card"><h2>지난 레슨</h2>${lessonTable(past, false)}</div>`;
  } else if (S.tab === 'journals') {
    const js = d.journals.slice().sort((a, c) => c.날짜.localeCompare(a.날짜));
    b.innerHTML = `<div class="card">${js.length ? js.map(j => journalHTML(j, d.materials)).join('') : '<div class="empty">아직 일지가 없습니다.</div>'}</div>`;
  } else if (S.tab === 'materials') {
    b.innerHTML = `<div class="card">${materialList(d.materials)}</div>`;
  } else if (S.tab === 'videos') {
    b.innerHTML = `<div class="card">${videoGrid(d.videos)}</div>`;
  } else {
    b.innerHTML = `<div class="card"><div class="table-wrap"><table><tr><th>결제일</th><th>금액</th><th>회차</th><th>비고</th></tr>
      ${d.payments.map(p => `<tr><td>${esc(p.결제일)}</td><td>${won(p.결제금액)}</td><td>${esc(p.결제회차)}회</td><td class="wrap">${esc(p.비고)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">결제 내역이 없습니다.</td></tr>'}</table></div></div>`;
  }
}

function lessonTable(list, admin) {
  if (!list.length) return '<div class="empty">없습니다.</div>';
  return `<div class="table-wrap"><table><tr><th>날짜</th><th>시간</th><th>상태</th><th>메모</th></tr>
    ${list.map(l => `<tr><td>${fmtDate(l.날짜)}</td><td>${esc(l.시작)}~${esc(l.종료)}</td><td>${chip(l.상태)}${l.차감 ? ' <span class="hint">차감</span>' : ''}</td><td class="wrap">${esc(l.메모)}</td></tr>`).join('')}</table></div>`;
}

function journalHTML(j, mats, admin) {
  const ids = String(j.사용자료ID || '').split(',').map(s => s.trim()).filter(Boolean);
  const line = (k, v) => v ? `<p><span class="k">${k}</span> ${esc(v)}</p>` : '';
  return `<div class="journal"><h4>${fmtDate(j.날짜)}</h4>
    ${line('배운 내용', j.학습내용)}${line('잘한 점', j.잘한점)}${line('보완할 점', j.보완할점)}${line('숙제', j.숙제)}${line('다음 레슨 준비', j.다음레슨준비)}
    ${admin && j.비공개메모 ? `<p><span class="k">비공개 메모</span> ${esc(j.비공개메모)}</p>` : ''}
    ${ids.map(id => { const m = (mats || []).find(x => x.자료ID === id); return m ? `<button class="ghost sm" data-act="file" data-id="${esc(id)}">📎 ${esc(m.제목)}</button> ` : ''; }).join('')}
    ${admin ? `<div class="row" style="margin-top:6px"><span class="chip">${j.학생공개 === 'Y' ? '학생 공개' : '비공개'}</span>
      <button class="ghost sm" data-act="jEdit" data-id="${esc(j.일지ID)}">수정</button><button class="ghost sm danger" data-act="del" data-sheet="Journals" data-id="${esc(j.일지ID)}">삭제</button></div>` : ''}</div>`;
}

/* ───── 선생님 화면 ───── */

function viewAdmin(app) {
  const tabs = [['home', '현황'], ['lessons', '일정'], ['students', '학생'], ['journals', '일지'], ['materials', '자료·영상'], ['settings', '설정']];
  app.innerHTML = `
  <header class="top"><h1>${esc(SITE_TITLE)} · 선생님</h1><button class="ghost sm" data-act="logout">로그아웃</button></header>
  <main><div class="tabs">${tabs.map(t => `<button data-act="tab" data-v="${t[0]}" class="${S.tab === t[0] ? 'on' : ''}">${t[1]}</button>`).join('')}</div><div id="tabBody"></div></main>`;
  ({ home: adminHome, lessons: adminLessons, students: adminStudents, journals: adminJournals, materials: adminMaterials, settings: adminSettings }[S.tab] || adminHome)($('#tabBody'));
}

const stName = code => { const s = S.data.students.find(x => x.학생코드.toLowerCase() === String(code).toLowerCase()); return s ? s.이름 : code; };
const stOptions = (all) => (all ? [['', '전체 학생']] : []).concat(S.data.students.filter(s => s.상태 !== '종료').map(s => [s.학생코드, `${s.이름} (${s.학생코드})`]));

async function reload() { S.data = await api('adminData'); render(); }

function adminHome(b) {
  const d = S.data;
  const th = Number(d.config['알림기준회차']) || 1;
  const alerts = d.students.filter(s => d.alerts.indexOf(s.학생코드) >= 0);
  const pending = d.lessons.filter(l => l.상태 === '예정' && l.날짜 < today()).sort(byDate);
  b.innerHTML = `
  ${alerts.length ? `<div class="alert"><b>잔여 ${th}회 이하 — 결제 안내가 필요합니다</b>${alerts.map(s => `<div class="row between"><span>${esc(s.이름)} · 잔여 ${s.summary.remaining}회 · ${esc(s.연락처 || '연락처 없음')}</span>
    <button class="ghost sm" data-act="copyMsg" data-code="${esc(s.학생코드)}">안내 문구 복사</button></div>`).join('')}</div>` : ''}
  ${pending.length ? `<div class="card"><h2>출결 미처리 (${pending.length})</h2><div class="table-wrap"><table><tr><th>날짜</th><th>학생</th><th>시간</th><th></th></tr>
    ${pending.map(l => `<tr><td>${fmtDate(l.날짜)}</td><td>${esc(stName(l.학생코드))}</td><td>${esc(l.시작)}</td><td>${lessonBtns(l)}</td></tr>`).join('')}</table></div></div>` : ''}
  <div class="card"><div class="row between"><h2>학생별 회차 현황</h2><span class="hint">잔여 = 결제 회차 − 차감 회차</span></div><div class="table-wrap"><table>
    <tr><th>이름</th><th>상태</th><th>결제</th><th>차감</th><th>잔여</th><th>출석/결석/연기</th><th>예정</th><th></th></tr>
    ${d.students.map(s => `<tr><td>${esc(s.이름)}</td><td>${esc(s.상태)}</td><td>${s.summary.paid}</td><td>${s.summary.used}</td>
      <td><b style="color:${s.summary.remaining <= th && s.summary.paid > 0 ? 'var(--bad)' : 'inherit'}">${s.summary.remaining}</b></td>
      <td>${s.summary.attended}/${s.summary.absent}/${s.summary.postponed}</td><td>${s.summary.scheduled}</td>
      <td><button class="ghost sm" data-act="pay" data-code="${esc(s.학생코드)}">결제 추가</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">학생이 없습니다.</td></tr>'}</table></div></div>`;
}

function lessonBtns(l) {
  const id = `data-id="${esc(l.레슨ID)}"`;
  return `<div class="row">
    ${l.상태 === '예정' ? `<button class="ghost sm" data-act="ls" data-v="출석" ${id}>출석</button><button class="ghost sm" data-act="ls" data-v="결석" ${id}>결석</button><button class="ghost sm" data-act="resched" ${id}>연기</button><button class="ghost sm" data-act="ls" data-v="취소" ${id}>취소</button>`
      : `<button class="ghost sm" data-act="ls" data-v="예정" ${id}>예정으로</button>`}
    <button class="ghost sm danger" data-act="lDel" ${id}>삭제</button></div>`;
}

function adminLessons(b) {
  const d = S.data, f = S.f;
  let list = d.lessons.slice();
  if (f.student) list = list.filter(l => l.학생코드.toLowerCase() === f.student.toLowerCase());
  if (f.view === 'planned') list = list.filter(l => l.상태 === '예정');
  list.sort(byDate); if (f.view !== 'planned') list.reverse();
  b.innerHTML = `<div class="card"><div class="row between"><h2>레슨 일정</h2><button class="primary" data-act="lAdd">+ 레슨 추가</button></div>
    <div class="row" style="margin:6px 0 10px"><select id="fStu" style="width:auto">${stOptions(true).map(o => `<option value="${esc(o[0])}" ${o[0] === f.student ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>
    <select id="fView" style="width:auto"><option value="planned" ${f.view === 'planned' ? 'selected' : ''}>예정만</option><option value="all" ${f.view === 'all' ? 'selected' : ''}>전체 기록</option></select></div>
    <div class="table-wrap"><table><tr><th>날짜</th><th>시간</th><th>학생</th><th>상태</th><th>메모</th><th></th></tr>
    ${list.map(l => `<tr><td>${fmtDate(l.날짜)}</td><td>${esc(l.시작)}~${esc(l.종료)}</td><td>${esc(stName(l.학생코드))}</td><td>${chip(l.상태)}</td><td class="wrap">${esc(l.메모)}</td><td>${lessonBtns(l)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">레슨이 없습니다.</td></tr>'}</table></div>
    <div class="hint" style="margin-top:8px">출석·결석 처리 시 회차가 차감됩니다(결석 차감은 설정에서 변경). 연기·취소·예정은 차감되지 않습니다. 캘린더에서 일정을 옮기거나 지우면 10분 안에 여기에 반영됩니다.</div></div>`;
  $('#fStu').onchange = e => { S.f.student = e.target.value; render(); };
  $('#fView').onchange = e => { S.f.view = e.target.value; render(); };
}

function adminStudents(b) {
  const d = S.data;
  b.innerHTML = `<div class="card"><div class="row between"><h2>학생 관리</h2><button class="primary" data-act="sAdd">+ 학생 추가</button></div><div class="table-wrap"><table>
    <tr><th>고유번호</th><th>이름</th><th>연락처</th><th>등록일</th><th>상태</th><th>잔여</th><th class="wrap">메모</th><th></th></tr>
    ${d.students.map(s => `<tr><td><code>${esc(s.학생코드)}</code></td><td>${esc(s.이름)}</td><td>${esc(s.연락처)}</td><td>${esc(s.등록일)}</td><td>${esc(s.상태)}</td><td>${s.summary.remaining}</td><td class="wrap">${esc(s.메모)}</td>
    <td><button class="ghost sm" data-act="sEdit" data-code="${esc(s.학생코드)}">수정</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">학생이 없습니다.</td></tr>'}</table></div>
    <div class="hint" style="margin-top:8px">고유번호는 직접 정할 수 있고, 바꾸면 그 학생의 기록도 같이 바뀝니다. 학생이 그만두면 삭제 대신 상태를 "종료"로 바꾸세요 (로그인 차단 + 기록 보존).</div></div>`;
}

function adminJournals(b) {
  const d = S.data;
  const js = d.journals.filter(j => !S.f.student || j.학생코드.toLowerCase() === S.f.student.toLowerCase()).sort((a, c) => c.날짜.localeCompare(a.날짜));
  b.innerHTML = `<div class="card"><div class="row between"><h2>레슨 일지</h2><button class="primary" data-act="jAdd">+ 일지 작성</button></div>
    <div class="row" style="margin:6px 0"><select id="fStu" style="width:auto">${stOptions(true).map(o => `<option value="${esc(o[0])}" ${o[0] === S.f.student ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select></div>
    ${js.map(j => `<div class="hint" style="margin-top:10px">${esc(stName(j.학생코드))}</div>` + journalHTML(j, d.materials, true)).join('') || '<div class="empty">일지가 없습니다.</div>'}</div>`;
  $('#fStu').onchange = e => { S.f.student = e.target.value; render(); };
}

function adminMaterials(b) {
  const d = S.data;
  b.innerHTML = `<div class="card"><div class="row between"><h2>악보·연습자료</h2><button class="primary" data-act="mAdd">+ 자료 추가</button></div>
    ${d.materials.map(m => `<div class="list-item"><div>${esc(m.제목)} <span class="chip">${esc(m.분류)}</span><small>공개: ${esc(targetLabel(m.공개대상))}</small></div>
      <div class="row"><button class="ghost sm" data-act="file" data-id="${esc(m.자료ID)}">열기</button><button class="ghost sm" data-act="mEdit" data-id="${esc(m.자료ID)}">수정</button><button class="ghost sm danger" data-act="del" data-sheet="Materials" data-id="${esc(m.자료ID)}">삭제</button></div></div>`).join('') || '<div class="empty">자료가 없습니다.</div>'}</div>
  <div class="card"><div class="row between"><h2>영상 (유튜브)</h2><button class="primary" data-act="vAdd">+ 영상 추가</button></div>
    ${d.videos.map(v => `<div class="list-item"><div>${esc(v.제목)}<small>공개: ${esc(targetLabel(v.공개대상))} · ${esc(v.유튜브링크)}</small></div>
      <div class="row"><button class="ghost sm" data-act="vEdit" data-id="${esc(v.영상ID)}">수정</button><button class="ghost sm danger" data-act="del" data-sheet="Videos" data-id="${esc(v.영상ID)}">삭제</button></div></div>`).join('') || '<div class="empty">영상이 없습니다.</div>'}</div>`;
}

function targetLabel(t) {
  return String(t || '').split(',').map(x => x.trim()).filter(Boolean).map(x => (x === '공개' || x === '전체') ? x : stName(x)).join(', ') || '(아무에게도 안 보임)';
}

function adminSettings(b) {
  const c = S.data.config;
  b.innerHTML = `<div class="card"><h2>회차·알림 설정</h2>
    <form id="cf">
      <label>잔여 알림 기준 (회) — 이 회차 이하로 남으면 알림</label><input name="알림기준회차" type="number" min="0" value="${esc(c['알림기준회차'])}">
      <label>결석 시 회차 차감</label><select name="결석차감"><option value="Y" ${c['결석차감'] === 'Y' ? 'selected' : ''}>차감함</option><option value="N" ${c['결석차감'] === 'N' ? 'selected' : ''}>차감 안 함</option></select>
      <label>기본 레슨 길이 (분)</label><input name="기본레슨분" type="number" min="10" value="${esc(c['기본레슨분'])}">
      <label>캘린더 일정 제목 앞부분</label><input name="수업명" value="${esc(c['수업명'])}">
      <label>사용할 캘린더 ID (비우면 내 기본 캘린더)</label><input name="캘린더ID" value="${esc(c['캘린더ID'])}">
      <div class="row end"><button class="primary">저장</button></div></form></div>
    <div class="card"><h2>지금 실행</h2><div class="row"><button class="ghost" data-act="sync">캘린더 변경 반영</button><button class="ghost" data-act="notify">잔여 회차 알림 메일 보내기</button></div>
      <div class="hint">둘 다 자동으로 실행됩니다 (캘린더 10분마다, 알림 매일 오전 9시). 알림은 선생님 구글 메일로 오고, 학생에게 보낼 문구가 같이 들어 있습니다.</div></div>
    <div class="card"><h2>관리자 비밀번호 변경</h2><form id="pf"><label>현재 비밀번호</label><input type="password" name="o" autocomplete="current-password">
      <label>새 비밀번호 (8자 이상)</label><input type="password" name="n" autocomplete="new-password"><div class="row end"><button class="primary">변경</button></div></form></div>`;
  $('#cf').onsubmit = ev => { ev.preventDefault(); run(async () => {
    const v = {}; Array.from(ev.target.elements).forEach(e => { if (e.name) v[e.name] = e.value.trim(); });
    await api('saveConfig', { values: v }); toast('저장했습니다'); await reload();
  }); };
  $('#pf').onsubmit = ev => { ev.preventDefault(); run(async () => {
    await api('changePassword', { oldPassword: ev.target.o.value, newPassword: ev.target.n.value }); ev.target.reset(); toast('비밀번호를 변경했습니다');
  }); };
}

/* ───── 폼 정의 ───── */

const randCode = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ', n = '23456789'; let s = ''; for (let i = 0; i < 2; i++) s += A[Math.floor(Math.random() * A.length)]; s += '-'; for (let i = 0; i < 4; i++) s += n[Math.floor(Math.random() * n.length)]; return s; };

function studentForm(old) {
  const f = [
    { k: '학생코드', label: '고유번호 (로그인용)', hint: '직접 정하세요. 비워 두지 말고, 다른 학생과 겹치면 안 됩니다.', ph: '예: MS-4821' },
    { k: '이름', label: '이름' }, { k: '연락처', label: '연락처', type: 'tel', ph: '010-0000-0000' },
    { k: '등록일', label: '등록일', type: 'date' },
    { k: '상태', label: '상태', type: 'select', options: [['수강중', '수강중'], ['휴강', '휴강'], ['종료', '종료 (로그인 차단)']] },
    { k: '메모', label: '메모', type: 'textarea' }
  ];
  const vals = old ? Object.assign({}, old) : { 학생코드: randCode(), 등록일: today(), 상태: '수강중' };
  openForm(old ? '학생 수정' : '학생 추가', f, vals, async o => {
    await api('saveRow', { sheet: 'Students', row: o, oldId: old ? old.학생코드 : undefined }); toast('저장했습니다'); await reload();
  });
}

function journalForm(old) {
  const f = [
    { k: '학생코드', label: '학생', type: 'select', options: stOptions(false) },
    { k: '날짜', label: '레슨 날짜', type: 'date' },
    { k: '학습내용', label: '오늘 배운 내용', type: 'textarea' },
    { k: '잘한점', label: '잘한 점', type: 'textarea' },
    { k: '보완할점', label: '보완할 점', type: 'textarea' },
    { k: '숙제', label: '숙제 / 연습 과제', type: 'textarea' },
    { k: '다음레슨준비', label: '다음 레슨 준비', type: 'textarea' },
    { k: '사용자료ID', label: '오늘 쓴 자료', type: 'multi', options: S.data.materials.map(m => [m.자료ID, m.제목]), hint: '여러 개는 Ctrl(Mac은 ⌘) 누르고 선택' },
    { k: '학생공개', label: '학생에게 보이기', type: 'select', options: [['Y', '공개'], ['N', '비공개']] },
    { k: '비공개메모', label: '비공개 메모 (선생님만 봄)', type: 'textarea' }
  ];
  const vals = old ? Object.assign({}, old) : { 날짜: today(), 학생공개: 'Y', 학생코드: S.f.student || (stOptions(false)[0] || [''])[0] };
  openForm(old ? '일지 수정' : '일지 작성', f, vals, async o => {
    await api('saveRow', { sheet: 'Journals', row: o, oldId: old ? old.일지ID : undefined }); toast('저장했습니다'); await reload();
  });
}

function targetOptions() { return [['공개', '공개 (로그인 없이 누구나)'], ['전체', '전체 학생 (로그인한 학생)']].concat(S.data.students.filter(s => s.상태 !== '종료').map(s => [s.학생코드, `${s.이름} 전용`])); }

function materialForm(old) {
  const f = [
    { k: '제목', label: '제목' }, { k: '분류', label: '분류', ph: '악보 / 연습자료 / 이미지 …' },
    { k: '드라이브파일ID', label: '구글 드라이브 파일 링크 또는 ID', hint: '드라이브에서 파일 우클릭 > 링크 복사한 주소를 그대로 붙여 넣어도 됩니다. 파일은 "제한됨"으로 두세요 (앱 안에서만 열림).' },
    { k: '공개대상', label: '공개 대상', type: 'multi', options: targetOptions(), hint: '여러 개 선택 가능' },
    { k: '메모', label: '메모' }
  ];
  openForm(old ? '자료 수정' : '자료 추가', f, old || { 공개대상: '전체' }, async o => {
    o.드라이브파일ID = driveId(o.드라이브파일ID);
    await api('saveRow', { sheet: 'Materials', row: o, oldId: old ? old.자료ID : undefined }); toast('저장했습니다'); await reload();
  });
}

function videoForm(old) {
  const f = [
    { k: '제목', label: '제목' }, { k: '유튜브링크', label: '유튜브 링크', hint: '"일부 공개"로 올린 영상을 추천합니다.' },
    { k: '공개대상', label: '공개 대상', type: 'multi', options: targetOptions() }, { k: '메모', label: '메모' }
  ];
  openForm(old ? '영상 수정' : '영상 추가', f, old || { 공개대상: '전체' }, async o => {
    await api('saveRow', { sheet: 'Videos', row: o, oldId: old ? old.영상ID : undefined }); toast('저장했습니다'); await reload();
  });
}

/* ───── 클릭 처리 ───── */

const H = {
  logout: () => logout(),
  lt: b => { S.loginTab = b.dataset.v; render(); },
  tab: b => { S.tab = b.dataset.v; render(); },
  file: b => openFile(b.dataset.id),
  ls: b => run(async () => { await api('setLessonStatus', { id: b.dataset.id, status: b.dataset.v }); await reload(); }),
  lDel: b => { if (confirm('이 레슨 기록을 삭제할까요? (캘린더 일정도 지워집니다)')) run(async () => { await api('deleteLesson', { id: b.dataset.id }); await reload(); }); },
  del: b => { if (confirm('삭제할까요?')) run(async () => { await api('deleteRow', { sheet: b.dataset.sheet, id: b.dataset.id }); await reload(); }); },
  lAdd: () => openForm('레슨 추가', [
    { k: 'code', label: '학생', type: 'select', options: stOptions(false) },
    { k: 'date', label: '날짜', type: 'date' }, { k: 'start', label: '시작 시간', type: 'time' },
    { k: 'end', label: '종료 시간 (비우면 기본 길이)', type: 'time' },
    { k: 'weeks', label: '매주 반복 횟수', type: 'number', hint: '1이면 한 번만, 4면 4주 연속 같은 요일·시간으로 등록' },
    { k: 'memo', label: '메모' }
  ], { date: today(), start: '15:00', weeks: '1', code: S.f.student || '' }, async o => {
    if (!o.start) throw new Error('시작 시간을 입력하세요');
    await api('addLessons', o); toast('등록했습니다 (캘린더에도 추가됨)'); await reload();
  }),
  resched: b => { const l = S.data.lessons.find(x => x.레슨ID === b.dataset.id); openForm('레슨 연기', [
    { k: 'date', label: '새 날짜', type: 'date' }, { k: 'start', label: '새 시작 시간', type: 'time' }, { k: 'end', label: '새 종료 시간 (비우면 기본 길이)', type: 'time' }, { k: 'memo', label: '사유' }
  ], { date: l.날짜, start: l.시작, end: l.종료 }, async o => {
    await api('reschedule', Object.assign({ id: l.레슨ID }, o)); toast('연기했습니다 (차감 없음, 캘린더 일정도 이동)'); await reload();
  }, `${stName(l.학생코드)} · ${l.날짜} ${l.시작}`); },
  pay: b => openForm('결제 추가', [
    { k: '결제일', label: '결제일', type: 'date' }, { k: '결제금액', label: '결제 금액(원)', type: 'number' }, { k: '결제회차', label: '결제 회차', type: 'number' }, { k: '비고', label: '비고' }
  ], { 결제일: today(), 결제회차: '4' }, async o => {
    o.학생코드 = b.dataset.code; await api('saveRow', { sheet: 'Packages', row: o }); toast('저장했습니다'); await reload();
  }, stName(b.dataset.code)),
  sAdd: () => studentForm(null),
  sEdit: b => studentForm(S.data.students.find(s => s.학생코드 === b.dataset.code)),
  jAdd: () => { if (!S.data.students.length) return toast('먼저 학생을 등록하세요', true); journalForm(null); },
  jEdit: b => journalForm(S.data.journals.find(j => j.일지ID === b.dataset.id)),
  mAdd: () => materialForm(null),
  mEdit: b => materialForm(S.data.materials.find(m => m.자료ID === b.dataset.id)),
  vAdd: () => videoForm(null),
  vEdit: b => videoForm(S.data.videos.find(v => v.영상ID === b.dataset.id)),
  sync: () => run(async () => { const r = await api('syncNow'); toast(`반영 완료 (이동 ${r.moved}건, 삭제 ${r.removed}건)`); await reload(); }),
  notify: () => run(async () => { const r = await api('notifyNow'); toast(r.sent ? `메일을 보냈습니다 (${r.sent}명)` : '알림 대상이 없습니다'); }),
  copyMsg: b => { const s = S.data.students.find(x => x.학생코드 === b.dataset.code);
    const m = `${s.이름}님, 현재 남은 레슨이 ${s.summary.remaining}회입니다. 다음 결제 안내드립니다.`;
    (navigator.clipboard ? navigator.clipboard.writeText(m) : Promise.reject()).then(() => toast('복사했습니다'), () => prompt('복사해서 사용하세요', m)); }
};

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (b && H[b.dataset.act]) H[b.dataset.act](b);
});

boot();
