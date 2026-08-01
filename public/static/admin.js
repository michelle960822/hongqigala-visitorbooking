// 后台管理 — 登录、扫码核销、流水、看板、报名管理
'use strict';

// ====== 通用工具 ======
function $(s) { return document.querySelector(s); }
function $$(s) { return Array.from(document.querySelectorAll(s)); }

function toast({ type = 'info', title, sub, duration = 3000 }) {
  const stack = $('#toastStack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  const ico = { success: '✅', danger: '❌', warning: '⚠️', info: 'ℹ️' }[type] || 'ℹ️';
  el.innerHTML = `<span class="ico">${ico}</span><div class="body"><div class="title">${title || ''}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut .25s ease-in forwards';
    setTimeout(() => el.remove(), 250);
  }, duration);
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
async function api(url, opts = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* not json */ }
  return { status: res.status, data };
}

// ====== 登录态 ======
let LOGGED_IN = false;
async function checkLogin() {
  const r = await api('/api/admin/me');
  if (r.status === 200 && r.data && r.data.ok) {
    showLoggedIn();
  } else {
    showLogin();
  }
}
function showLogin() {
  LOGGED_IN = false;
  $('#loginCard').style.display = '';
  $('#loggedIn').style.display = 'none';
  $('#loginTag').style.display = 'none';
  $('#logoutBtn').style.display = 'none';
}
function showLoggedIn() {
  LOGGED_IN = true;
  $('#loginCard').style.display = 'none';
  $('#loggedIn').style.display = '';
  $('#loginTag').style.display = '';
  $('#logoutBtn').style.display = '';
  // 默认 tab
  switchTab('scan');
  refreshAll();
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = $('#pwd').value.trim();
  if (!password) { $('#loginMsg').textContent = '请输入密码'; return; }
  const r = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
  if (r.status === 200 && r.data && r.data.ok) {
    $('#loginMsg').textContent = '';
    showLoggedIn();
  } else {
    $('#loginMsg').textContent = (r.data && r.data.msg) || '登录失败';
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' });
  stopScan();
  showLogin();
  toast({ type: 'info', title: '已退出登录' });
});

// ====== Tabs ======
function switchTab(name) {
  $$('.tab').forEach((el) => el.classList.toggle('active', el.dataset.tab === name));
  $$('.tab-pane').forEach((el) => el.classList.toggle('active', el.dataset.pane === name));
  if (name === 'manage') refreshManage();
  if (name === 'board') refreshBoard();
  if (name === 'scan') refreshFlow();
}
$$('.tab').forEach((el) => el.addEventListener('click', () => switchTab(el.dataset.tab)));

// ====== 扫码 ======
let stream = null;
let scanRAF = null;
let lastScanTime = 0;
let lastScanText = '';

function extractToken(text) {
  if (!text) return '';
  text = text.trim();
  // 完整 URL: .../checkin/<token>
  const m1 = text.match(/\/checkin\/([a-zA-Z0-9_-]+)/);
  if (m1) return m1[1];
  // 纯短码
  if (/^\d{6}$/.test(text)) return text;
  // 裸 token
  if (/^[a-f0-9]{16,32}$/i.test(text)) return text;
  return text;
}

async function startScan() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast({ type: 'danger', title: '当前浏览器不支持摄像头', sub: '请使用 Chrome / Safari / Edge 最新版，或在 HTTPS 下打开', duration: 5000 });
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    const v = $('#scanVideo');
    v.srcObject = stream;
    v.style.display = '';
    $('#scanFrame').style.display = '';
    $('.scan-card .placeholder').style.display = 'none';
    $('#startScanBtn').style.display = 'none';
    $('#stopScanBtn').style.display = '';
    toast({ type: 'success', title: '摄像头已启动' });
    scanLoop();
  } catch (e) {
    const name = (e && e.name) || '';
    let hint;
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || /device not found/i.test(e.message || '')) {
      hint = '当前设备未检测到摄像头。请直接使用下方"手动输入 6 位核销码"完成核销。';
    } else if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      hint = '摄像头权限被拒绝。请在浏览器地址栏左侧的锁图标中允许摄像头权限，然后刷新页面重试。';
    } else if (name === 'NotReadableError' || name === 'TrackStartError') {
      hint = '摄像头被其他程序占用。请关闭视频会议等应用后重试。';
    } else {
      hint = '请直接使用下方"手动输入 6 位核销码"完成核销。';
    }
    toast({ type: 'danger', title: '摄像头启动失败', sub: hint, duration: 7000 });
    // 自动切到手动输入模式
    $('#startScanBtn').style.display = 'none';
    $('#manualBox').style.display = '';
    $('#manualInput').focus();
  }
}

function stopScan() {
  if (scanRAF) cancelAnimationFrame(scanRAF);
  scanRAF = null;
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  const v = $('#scanVideo');
  if (v) v.srcObject = null;
  v && (v.style.display = 'none');
  $('#scanFrame').style.display = 'none';
  $('.scan-card .placeholder').style.display = '';
  $('#startScanBtn').style.display = '';
  $('#stopScanBtn').style.display = 'none';
}

function scanLoop() {
  if (!stream) return;
  const v = $('#scanVideo');
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d', { willReadFrequently: true });
  function tick() {
    if (!stream) return;
    if (v.readyState === v.HAVE_ENOUGH_DATA) {
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      ctx.drawImage(v, 0, 0, c.width, c.height);
      try {
        const code = jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
        if (code && code.data) {
          const now = Date.now();
          // 同码 2 秒内不重复触发
          if (code.data !== lastScanText || now - lastScanTime > 2000) {
            lastScanText = code.data;
            lastScanTime = now;
            const token = extractToken(code.data);
            flashCard();
            if (navigator.vibrate) navigator.vibrate(80);
            doCheckin(token);
          }
        }
      } catch (e) { /* ignore frame errors */ }
    }
    scanRAF = requestAnimationFrame(tick);
  }
  tick();
}

function flashCard() {
  const el = $('#scanCard');
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 400);
}

$('#startScanBtn').addEventListener('click', startScan);
$('#stopScanBtn').addEventListener('click', stopScan);
$('#manualFocusBtn').addEventListener('click', () => {
  $('#manualBox').style.display = '';
  $('#manualInput').focus();
});
$('#manualBtn').addEventListener('click', () => {
  const t = extractToken($('#manualInput').value);
  if (!t) { toast({ type: 'warning', title: '请输入 6 位核销码或完整链接' }); return; }
  doCheckin(t);
});
$('#manualInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#manualBtn').click(); }
});

async function doCheckin(code) {
  const r = await api('/api/checkin/' + encodeURIComponent(code), { method: 'POST' });
  if (r.status === 200 && r.data && r.data.ok) {
    showResult(r.data, code);
    if (!r.data.already) {
      toast({ type: 'success', title: '核销成功', sub: r.data.msg });
    } else {
      toast({ type: 'warning', title: '已核销过', sub: r.data.msg });
    }
    refreshFlow();
  } else {
    toast({ type: 'danger', title: '核销失败', sub: (r.data && r.data.msg) || '网络错误' });
  }
}

async function showResult(data, code) {
  $('#resultCard').style.display = '';
  const body = $('#resultBody');
  const booking = data.booking || {};
  body.innerHTML = `
    <div class="info-box" style="margin:0">
      <dl>
        <dt>核销码</dt><dd><span class="shortcode">${escapeHtml(booking.short_code || code)}</span></dd>
        <dt>姓名</dt><dd>${escapeHtml(booking.name_mask || booking.name || '-')}</dd>
        <dt>手机</dt><dd>${escapeHtml(booking.phone_mask || '-')}</dd>
        <dt>身份证</dt><dd>${escapeHtml(booking.idnum_mask || '-')}</dd>
        <dt>时段</dt><dd>${escapeHtml(booking.date || '-')} ${escapeHtml((booking.start || '') + '–' + (booking.end || ''))}</dd>
        <dt>人数</dt><dd>${escapeHtml(booking.party_size || '-')}</dd>
      </dl>
    </div>
  `;
  // 滚动到结果
  $('#resultCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ====== 流水 ======
async function refreshFlow() {
  if (!LOGGED_IN) return;
  const r = await api('/api/admin/flow');
  if (r.status !== 200 || !r.data || !r.data.ok) return;
  const list = r.data.list || [];
  const body = $('#flowBody');
  if (list.length === 0) {
    body.innerHTML = '<tr><td colspan="6" class="muted center" style="padding:30px">暂无核销记录</td></tr>';
    return;
  }
  body.innerHTML = list.map((x) => `
    <tr>
      <td class="nowrap">${escapeHtml(x.time)}</td>
      <td>${escapeHtml(x.name_mask || '-')}</td>
      <td>${escapeHtml(x.phone_mask || '-')}</td>
      <td>${escapeHtml(x.idnum_mask || '-')}</td>
      <td><span class="shortcode">${escapeHtml(x.short_code || '-')}</span></td>
      <td class="nowrap">${escapeHtml(x.date || '-')} ${escapeHtml((x.start || '') + '–' + (x.end || ''))}</td>
    </tr>
  `).join('');
}

// ====== 报名管理 ======
async function refreshManage() {
  if (!LOGGED_IN) return;
  const date = $('#manageDate').value;
  const status = $('#manageStatus').value;
  const params = new URLSearchParams();
  if (date) params.set('date', date);
  if (status && status !== 'all') params.set('status', status);
  const r = await api('/api/admin/dashboard' + (params.toString() ? '?' + params : ''));
  if (r.status !== 200 || !r.data || !r.data.ok) return;
  _lastManageList = r.data.list || [];
  renderManageTable(_lastManageList);
}
function renderManageTable(list) {
  const q = ($('#manageSearch').value || '').trim().toLowerCase();
  let filtered = list;
  if (q) {
    filtered = list.filter((x) =>
      (x.short_code || '').includes(q) ||
      (x.name || '').toLowerCase().includes(q) ||
      (x.phone || '').includes(q.replace(/\*/g, '')) ||
      (x.phone_mask || '').includes(q)
    );
  }
  const body = $('#manageBody');
  if (filtered.length === 0) {
    body.innerHTML = '<tr><td colspan="8" class="muted center" style="padding:30px">' + (q ? '无匹配结果' : '暂无报名记录') + '</td></tr>';
    return;
  }
  body.innerHTML = filtered.map((x) => {
    const stBadge = x.status !== 'active'
      ? '<span class="badge danger">已取消</span>'
      : x.attended
        ? '<span class="badge success">已到场</span>'
        : '<span class="badge warning">待核销</span>';
    const markBtn = x.status === 'active' && !x.attended
      ? `<button class="btn btn-ghost btn-sm" data-mark="${x.id}">标记到场</button>`
      : '';
    const cancelBtn = x.status === 'active'
      ? `<button class="btn btn-ghost btn-sm" data-cancel="${x.id}">取消</button>`
      : '';
    return `
      <tr>
        <td><span class="shortcode">${escapeHtml(x.short_code || '-')}</span></td>
        <td><strong>${escapeHtml(x.name || '-')}</strong></td>
        <td>${escapeHtml(x.phone_mask || '-')}</td>
        <td><span class="muted" style="font-size:12px">${escapeHtml(x.idnum_mask || '-')}</span></td>
        <td>${escapeHtml((x.companions || []).map(maskNameJs).join('、') || '-')}</td>
        <td class="nowrap">${escapeHtml(x.date || '-')}<br><span class="muted">${escapeHtml((x.start || '') + '–' + (x.end || ''))}</span></td>
        <td>${stBadge}</td>
        <td>${markBtn}${cancelBtn}</td>
      </tr>
    `;
  }).join('');
  // 绑定操作
  body.querySelectorAll('[data-mark]').forEach((b) => b.addEventListener('click', () => doMark(b.dataset.mark)));
  body.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => doAdminCancel(b.dataset.cancel)));
}
function maskNameJs(s) {
  if (!s) return '';
  if (s.length <= 1) return s;
  return s[0] + '*'.repeat(Math.max(1, s.length - 1));
}
async function doMark(id) {
  const r = await api('/api/admin/checkin/' + id, { method: 'POST' });
  if (r.status === 200 && r.data && r.data.ok) {
    toast({ type: 'success', title: '已标记到场' });
    refreshManage();
  } else { toast({ type: 'danger', title: '操作失败' }); }
}
async function doAdminCancel(id) {
  if (!confirm('确认取消该预约？名额将释放。')) return;
  const r = await api('/api/admin/cancel/' + id, { method: 'POST' });
  if (r.status === 200 && r.data && r.data.ok) {
    toast({ type: 'success', title: '已取消' });
    refreshManage();
  } else { toast({ type: 'danger', title: '取消失败' }); }
}
$('#refreshManageBtn').addEventListener('click', refreshManage);
$('#manageDate').addEventListener('change', refreshManage);
$('#manageStatus').addEventListener('change', refreshManage);
// 搜索：实时过滤
let _lastManageList = [];
$('#manageSearch').addEventListener('input', () => renderManageTable(_lastManageList));
$('#cleanupBtn').addEventListener('click', async () => {
  if (!confirm('确认清理活动结束后 10 天的过期数据？此操作不可恢复，将永久删除姓名/手机/身份证/预约记录。')) return;
  const r = await api('/api/admin/cleanup', { method: 'POST' });
  if (r.status === 200 && r.data && r.data.ok) {
    toast({ type: 'success', title: '已清理过期数据', sub: '共删除 ' + (r.data.deleted || 0) + ' 条记录' });
    refreshAll();
  } else { toast({ type: 'danger', title: '清理失败' }); }
});

// ====== 看板 ======
async function refreshBoard() {
  if (!LOGGED_IN) return;
  const r = await api('/api/admin/dashboard');
  if (r.status !== 200 || !r.data || !r.data.ok) return;
  const list = r.data.list || [];
  // 汇总
  const totalBooked = list.filter(x => x.status === 'active').length;
  const totalAttended = list.filter(x => x.attended).length;
  const totalCancelled = list.filter(x => x.status !== 'active').length;
  $('#statGrid').innerHTML = `
    <div class="stat-card"><div class="l">总预约（有效）</div><div class="v">${totalBooked}</div></div>
    <div class="stat-card"><div class="l">已到场</div><div class="v" style="color:var(--success)">${totalAttended}</div></div>
    <div class="stat-card"><div class="l">未到场</div><div class="v" style="color:var(--warning)">${totalBooked - totalAttended}</div></div>
    <div class="stat-card"><div class="l">已取消</div><div class="v" style="color:var(--danger)">${totalCancelled}</div></div>
  `;
  // 按时段分组
  const slotMap = {};
  list.forEach(x => {
    if (x.status !== 'active') return;
    const k = x.date + ' ' + x.start + '–' + x.end;
    if (!slotMap[k]) slotMap[k] = { date: x.date, slot: x.start + '–' + x.end, capacity: 30, booked: 0, attended: 0 };
    slotMap[k].booked += x.party_size || 1;
    if (x.attended) slotMap[k].attended += x.party_size || 1;
  });
  const slots = Object.values(slotMap);
  if (slots.length === 0) {
    $('#slotBoard').innerHTML = '<div class="empty"><div class="ico">📭</div>暂无有效预约</div>';
    return;
  }
  $('#slotBoard').innerHTML = slots.map(s => {
    const pct = Math.min(100, Math.round(s.booked / s.capacity * 100));
    return `
      <div class="card" style="margin-bottom:12px">
        <h3>📅 ${escapeHtml(s.date)} · ${escapeHtml(s.slot)}</h3>
        <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text-soft)">
          <span>已预约 ${s.booked} / ${s.capacity} 人</span>
          <span>已核销 ${s.attended} 人</span>
        </div>
        <div class="progress"><i style="width:${pct}%"></i></div>
      </div>
    `;
  }).join('');
}

function refreshAll() {
  refreshFlow();
  refreshManage();
  refreshBoard();
}

// 启动
checkLogin();
// 流水 5 秒自动刷新（仅在扫码 tab）
setInterval(() => {
  if (LOGGED_IN && $('.tab.active').dataset.tab === 'scan') refreshFlow();
}, 5000);
