// 核销页（公开 /checkin/<token>）
'use strict';
const $ = (s) => document.querySelector(s);

const code = location.pathname.replace(/^\/checkin\//, '').replace(/\/$/, '').trim();

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

async function run() {
  if (!code) {
    $('#title').textContent = '请提供核销码';
    $('#msg').textContent = '请扫描预约二维码或输入 6 位短码';
    return;
  }
  const r = await fetch('/api/checkin/' + encodeURIComponent(code), { method: 'POST' });
  const data = await r.json().catch(() => ({}));
  const ok = (r.status === 200) && data && data.ok;
  if (ok) {
    $('#title').textContent = data.already ? '已核销过' : '核销成功 ✅';
    $('#msg').textContent = data.msg || '欢迎体验！';
    $('#msg').style.color = 'var(--success)';
    if (data.booking) {
      $('#info').style.display = '';
      const b = data.booking;
      $('#info').innerHTML = `
        <dl>
          <dt>姓名</dt><dd>${escapeHtml(b.name_mask || b.name || '-')}</dd>
          <dt>手机</dt><dd>${escapeHtml(b.phone_mask || '-')}</dd>
          <dt>身份证</dt><dd>${escapeHtml(b.idnum_mask || '-')}</dd>
          <dt>时段</dt><dd>${escapeHtml(b.date || '-')} ${escapeHtml((b.start || '') + '–' + (b.end || ''))}</dd>
          <dt>短码</dt><dd><span class="shortcode">${escapeHtml(b.short_code || code)}</span></dd>
        </dl>
      `;
    }
    toast({ type: 'success', title: data.already ? '已核销' : '核销成功', sub: data.msg });
  } else {
    $('#title').textContent = '核销失败 ❌';
    $('#msg').textContent = (data && data.msg) || '二维码无效';
    $('#msg').style.color = 'var(--danger)';
    toast({ type: 'danger', title: '核销失败', sub: (data && data.msg) || '请检查二维码' });
  }
}
run();
