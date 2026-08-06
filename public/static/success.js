// 预约成功页（同时作为预约详情页：active / attended / cancelled 都共用）
'use strict';

const $ = (s) => document.querySelector(s);

// ====== confetti 纸飘带特效 ======
(function confettiBurst() {
  const cv = $('#confetti');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  cv.width = window.innerWidth;
  cv.height = window.innerHeight;
  const W = cv.width, H = cv.height;
  const colors = ['#C8102E','#9d0b22','#d4a24c','#e8c170','#f5e6a3','#fff','#ffd700','#ff4500','#00cc66'];
  const particles = [];
  const gravity = 0.12;
  const count = 120;
  for (let i = 0; i < count; i++) {
    particles.push({
      x: W / 2 + (Math.random() - 0.5) * 200,
      y: H / 2 - 80 + (Math.random() - 0.5) * 100,
      w: 6 + Math.random() * 8,
      h: 3 + Math.random() * 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      vx: (Math.random() - 0.5) * 10,
      vy: -8 - Math.random() * 16,
      rot: Math.random() * Math.PI * 2,
      rv: (Math.random() - 0.5) * 0.3,
    });
  }
  let frame = 0;
  function draw() {
    frame++;
    ctx.clearRect(0, 0, W, H);
    let alive = 0;
    for (const p of particles) {
      if (frame > 80 && p.vy > 0 && p.y > H + 20) continue;
      alive++;
      p.vy += gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.rv;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (alive > 0 && frame < 200) requestAnimationFrame(draw);
    else { cv.style.display = 'none'; }
  }
  draw();
})();

// ====== 预约详情 ======
function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function toast({ type = 'info', title, sub, duration = 2500 }) {
  const stack = $('#toastStack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  const ico = { success: '✅', danger: '❌', warning: '⚠️', info: 'ℹ️' }[type] || 'ℹ️';
  el.innerHTML = `<span class="ico">${ico}</span><div class="body"><div class="title">${title || ''}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  stack.appendChild(el);
  setTimeout(() => { el.style.animation = 'toastOut .25s ease-in forwards'; setTimeout(() => el.remove(), 250); }, duration);
}

const token = location.pathname.replace(/^\/success\//, '').replace(/\/$/, '').trim();
if (!token) { $('#iName').textContent = '无效的预约链接'; }

// 渲染顶部状态横幅（已取消 / 已核销 / 正常）
function renderStatusBanner(v) {
  const banner = $('#statusBanner');
  if (!banner) return;
  if (v.status === 'cancelled') {
    banner.style.cssText = 'background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:14px 16px;margin-bottom:14px;text-align:left;line-height:1.6';
    banner.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:10px">
        <span style="font-size:24px;line-height:1">❌</span>
        <div style="font-size:14px;color:#7f1d1d">
          <div style="font-weight:700;font-size:15px">预约已取消，二维码已作废</div>
          <div style="font-size:12px;color:#991b1b;margin-top:2px">Booking cancelled · QR code invalid</div>
        </div>
      </div>`;
  } else if (v.attended) {
    banner.style.cssText = 'background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:12px 16px;margin-bottom:14px;text-align:left;line-height:1.6';
    banner.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:10px">
        <span style="font-size:24px;line-height:1">✅</span>
        <div style="font-size:14px;color:#166534">
          <div style="font-weight:700">已核销入场</div>
          <div style="font-size:12px;color:#15803d;margin-top:2px">Checked in</div>
        </div>
      </div>`;
  } else {
    banner.style.display = 'none';
  }
}

// 渲染底部操作按钮
function renderActions(v) {
  const wrap = $('#actions');
  if (!wrap) return;
  wrap.innerHTML = '';

  // 已取消：只显示"再次预约"
  if (v.status === 'cancelled') {
    wrap.innerHTML = `<a class="btn btn-primary btn-sm" href="/">再次预约 · Book Again</a>`;
    wrap.style.cssText = 'justify-content:center;gap:8px';
    return;
  }

  // 已核销：只显示"再次预约"
  if (v.attended) {
    wrap.innerHTML = `<a class="btn btn-primary btn-sm" href="/">再次预约 · Book Again</a>`;
    wrap.style.cssText = 'justify-content:center;gap:8px';
    return;
  }

  // 正常 active：显示"取消预约"+"再次预约"
  wrap.innerHTML = `
    <a class="btn btn-ghost btn-sm" href="/cancel/${encodeURIComponent(token)}">取消预约 · Cancel</a>
    <a class="btn btn-primary btn-sm" href="/">再次预约 · Book Again</a>`;
  wrap.style.cssText = 'justify-content:center;gap:8px';
}

// 渲染截图提示框
function renderScreenshotHint(v) {
  const hint = $('#screenshotHint');
  if (!hint) return;
  if (v.status === 'cancelled' || v.attended) {
    hint.style.display = 'none';
  } else {
    hint.style.display = 'block';
  }
}

// 渲染二维码区域
function renderQR(v) {
  const qrWrap = $('#qrWrap');
  const qr = $('#qr');
  if (!qrWrap || !qr) return;
  if (v.status === 'cancelled') {
    qrWrap.style.cssText = 'padding:10px;margin:0 auto 10px;max-width:180px;opacity:.3;filter:grayscale(1)';
    qr.innerHTML = '<div style="min-height:160px;display:grid;place-items:center;font-size:13px;color:#999">— 已作废 —</div>';
    return;
  }
  const checkinUrl = location.origin + '/checkin/' + token;
  const q = qrcode(0, 'M');
  q.addData(checkinUrl);
  q.make();
  qr.innerHTML = q.createImgTag(5, 6);
}

async function load() {
  const r = await fetch('/api/booking/' + encodeURIComponent(token));
  if (r.status !== 200) { $('#iName').textContent = '加载失败'; return; }
  const v = await r.json();
  if (!v || !v.name) { $('#iName').textContent = '预约不存在'; return; }

  renderStatusBanner(v);
  renderScreenshotHint(v);
  renderQR(v);
  renderActions(v);

  $('#shortCode').textContent = v.short_code || '------';
  $('#iName').textContent = v.name + (v.phone ? '（' + v.phone.slice(0,3) + '****' + v.phone.slice(-4) + '）' : '');
  $('#iDate').textContent = v.date;
  $('#iSlot').textContent = v.start + '–' + v.end;
  $('#iParty').textContent = v.party_size + ' 人' + (v.companions && v.companions.length ? '（含随行 ' + v.companions.join('、') + '）' : '');

  // 页面标题
  const sc = v.status === 'cancelled' ? '已取消' : v.attended ? '已核销' : '预约成功';
  const scEn = v.status === 'cancelled' ? 'Cancelled' : v.attended ? 'Checked in' : 'Booked';
  document.title = sc + ' · ' + scEn + ' · ' + v.date + ' ' + v.start;
}
load();