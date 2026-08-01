const loginBox = document.getElementById('login');
const dashBox = document.getElementById('dash');
const loginForm = document.getElementById('loginForm');
const pwd = document.getElementById('pwd');
const loginErr = document.getElementById('loginErr');
const summary = document.getElementById('summary');
const rowsEl = document.getElementById('rows');

function showLogin() {
  loginBox.style.display = 'block';
  dashBox.style.display = 'none';
}
function showDash() {
  loginBox.style.display = 'none';
  dashBox.style.display = 'block';
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginErr.textContent = '';
  const r = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pwd.value })
  }).then(x => x.json());
  if (r.ok) { showDash(); load(); }
  else { loginErr.textContent = '密码错误'; }
});

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  showLogin();
});

document.getElementById('cleanup').addEventListener('click', async () => {
  if (!confirm('确认删除超过留存天数的历史记录？')) return;
  await fetch('/api/admin/cleanup', { method: 'POST' });
  load();
});

async function load() {
  const res = await fetch('/api/admin/dashboard');
  if (res.status === 401) { showLogin(); return; }
  const d = await res.json();
  render(d.rows);
}

function render(rows) {
  const total = rows.length;
  const came = rows.filter(r => r.attended).length;
  const cancelled = rows.filter(r => r.status !== 'active').length;
  const nodrop = total - came - cancelled;
  summary.textContent = `总记录 ${total} · 已到场 ${came} · 预约未到 ${nodrop} · 已取消 ${cancelled}`;

  rowsEl.innerHTML = rows.map(r => {
    const compHtml = r.companions.length ? r.companions.join('、') : '—';
    let state, cls, action;
    if (r.status !== 'active') { state = '已取消'; cls = 'muted'; action = ''; }
    else if (r.attended) { state = '已到场'; cls = ''; action = ''; }
    else { state = '未到场'; cls = 'nodrop'; action = `<button class="link act" data-id="${r.id}">标记到场</button>`; }
    return `<tr class="${cls}">
      <td>${r.id}</td>
      <td>${r.date}<br>${r.start}-${r.end}</td>
      <td>${r.name}</td>
      <td>${compHtml}</td>
      <td>${r.party_size}</td>
      <td>${state}</td>
      <td>${r.attended ? '✅' : '—'}</td>
      <td>${action}</td>
    </tr>`;
  }).join('');

  rowsEl.querySelectorAll('.act').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch('/api/admin/checkin/' + btn.dataset.id, { method: 'POST' });
      load();
    });
  });
}

load();
