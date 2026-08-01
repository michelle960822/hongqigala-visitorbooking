// 取消页
'use strict';
const $ = (s) => document.querySelector(s);
const token = location.pathname.replace(/^\/cancel\//, '').replace(/\/$/, '').trim();

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

function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

async function load() {
  const r = await fetch('/api/booking/' + encodeURIComponent(token));
  if (r.status !== 200) { $('#info').innerHTML = '<div class="muted">预约不存在</div>'; return; }
  const v = await r.json();
  if (!v || !v.name) { $('#info').innerHTML = '<div class="muted">预约不存在</div>'; return; }
  if (v.status !== 'active') {
    $('#info').innerHTML = '<div class="alert danger"><span class="ico">⚠️</span><div class="body"><div class="title">该预约已取消</div></div></div>';
    $('#confirmBtn').style.display = 'none';
    $('#backBtn').textContent = '返回首页';
    return;
  }
  $('#info').innerHTML = `
    <dl>
      <dt>姓名</dt><dd>${escapeHtml(v.name)}</dd>
      <dt>日期 / 时段</dt><dd>${escapeHtml(v.date)} ${escapeHtml(v.start + '–' + v.end)}</dd>
      <dt>人数</dt><dd>${v.party_size} 人</dd>
    </dl>
  `;
  $('#backBtn').href = '/success/' + token;
}
load();

$('#confirmBtn').addEventListener('click', async () => {
  if (!confirm('确认取消该预约？名额将实时释放。')) return;
  const r = await fetch('/api/cancel/' + encodeURIComponent(token), { method: 'POST' });
  const data = await r.json().catch(() => ({}));
  if (r.status === 200 && (data.ok !== false)) {
    toast({ type: 'success', title: '已取消' });
    setTimeout(() => location.href = '/', 800);
  } else {
    toast({ type: 'danger', title: '取消失败', sub: (data && data.msg) || '请稍后重试' });
  }
});

$('#eraseBtn').addEventListener('click', async () => {
  if (!confirm('⚠️ 这将立即销毁您提交的所有个人信息（姓名、手机号、身份证号、随行人）。\n\n此操作不可恢复，请确认。')) return;
  const r = await fetch('/api/erase/' + encodeURIComponent(token), { method: 'POST' });
  const data = await r.json().catch(() => ({}));
  if (r.status === 200 && (data.ok !== false)) {
    toast({ type: 'success', title: '已销毁您的所有个人信息', sub: '您的预约记录已从系统中清除' });
    setTimeout(() => location.href = '/', 1500);
  } else {
    toast({ type: 'danger', title: '销毁失败' });
  }
});
