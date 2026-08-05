// 预约成功页
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

const token = location.pathname.replace(/^\/success\//, '').replace(/\/$/, '').trim();
if (!token) { $('#iName').textContent = '无效的预约链接'; }

async function load() {
  const r = await fetch('/api/booking/' + encodeURIComponent(token));
  if (r.status !== 200) { $('#iName').textContent = '加载失败'; return; }
  const v = await r.json();
  if (!v || !v.name) { $('#iName').textContent = '预约不存在'; return; }
  const checkinUrl = location.origin + '/checkin/' + token;
  const qr = qrcode(0, 'M');
  qr.addData(checkinUrl);
  qr.make();
  $('#qr').innerHTML = qr.createImgTag(5, 6);
  const sc = v.short_code || '------';
  $('#shortCode').textContent = sc;
  $('#iName').textContent = v.name + (v.phone ? '（' + v.phone.slice(0,3) + '****' + v.phone.slice(-4) + '）' : '');
  $('#iDate').textContent = v.date;
  $('#iSlot').textContent = v.start + '–' + v.end;
  $('#iParty').textContent = v.party_size + ' 人' + (v.companions && v.companions.length ? '（含随行 ' + v.companions.join('、') + '）' : '');
  $('#cancelLink').href = '/cancel/' + token;
  document.title = '预约成功 · Booked · ' + v.date + ' ' + v.start;
}
load();
