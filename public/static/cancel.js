// 取消页
'use strict';
const $ = (s) => document.querySelector(s);
const token = location.pathname.replace(/^\/cancel\//, '').replace(/\/$/, '').trim();

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
function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

async function load() {
  const r = await fetch('/api/booking/' + encodeURIComponent(token));
  if (r.status !== 200) { $('#info').innerHTML = '<div class="muted">预约不存在</div>'; return; }
  const v = await r.json();
  if (!v || !v.name) { $('#info').innerHTML = '<div class="muted">预约不存在</div>'; return; }
  if (v.status !== 'active') {
    $('#info').innerHTML = '<p class="muted" style="font-size:15px;padding:20px 0">该预约已取消，名额已释放</p>';
    $('#confirmBtn').style.display = 'none';
    return;
  }
  $('#info').innerHTML = `<dl><dt>姓名</dt><dd>${escapeHtml(v.name)}</dd><dt>日期 / 时段</dt><dd>${escapeHtml(v.date)} ${escapeHtml(v.start + '–' + v.end)}</dd><dt>人数</dt><dd>${v.party_size} 人</dd></dl>`;
  $('#backBtn').href = '/success/' + token;
}
load();

$('#confirmBtn').addEventListener('click', async () => {
  if (!confirm('确认删除您的报名信息？名额将实时释放。')) return;
  $('#confirmBtn').disabled = true;
  $('#confirmBtn').textContent = '处理中…';
  const r = await fetch('/api/cancel/' + encodeURIComponent(token), { method: 'POST' });
  if (r.status === 200) {
    $('#info').innerHTML = '<p style="font-size:15px;color:var(--success);padding:20px 0">✅ 已取消，名额已实时释放</p>';
    $('#confirmBtn').style.display = 'none';
    toast({ type: 'success', title: '已取消', sub: '名额已实时释放' });
    setTimeout(() => { location.href = '/'; }, 1500);
  } else {
    $('#confirmBtn').disabled = false;
    $('#confirmBtn').textContent = '🗑 立即删除我的报名信息';
    toast({ type: 'danger', title: '取消失败，请稍后重试' });
  }
});
