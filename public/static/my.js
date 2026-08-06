// 我的报名 — 读取本设备上所有预约记录
'use strict';
const $ = (s) => document.querySelector(s);

function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function getBookings() {
  try { return JSON.parse(localStorage.getItem('my_bookings') || '[]'); }
  catch { return []; }
}

async function load() {
  const list = getBookings();
  if (list.length === 0) {
    $('#list').innerHTML = '<div class="empty"><div class="ico">📭</div>本设备暂无报名记录</div>';
    return;
  }
  // 倒序（最新在前）
  list.reverse();
  $('#list').innerHTML = '<p class="muted" style="font-size:12px;margin:0 0 12px">共 ' + list.length + ' 条记录（仅本设备可见）</p>';
  const body = $('#list');

  for (const item of list) {
    const row = document.createElement('div');
    row.className = 'card';
    row.style.cssText = 'padding:14px 16px;margin-bottom:10px;text-align:left';
    row.innerHTML = '<span class="muted">加载中…</span>';
    body.appendChild(row);

    try {
      const r = await fetch('/api/booking/' + encodeURIComponent(item.token));
      if (r.status !== 200) { row.innerHTML = '<span class="muted">预约不存在（可能已过期）</span>'; continue; }
      const v = await r.json();
      if (!v || !v.name) { row.innerHTML = '<span class="muted">预约不存在</span>'; continue; }
      const statusTag = v.status !== 'active'
        ? '<span class="badge danger">已取消</span>'
        : v.attended
          ? '<span class="badge success">已核销</span>'
          : '<span class="badge warning">待核销</span>';
      row.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:15px;margin-bottom:4px">
              ${escapeHtml(v.name)} ${statusTag}
            </div>
            <div style="font-size:13px;color:var(--text-soft);line-height:1.6">
              📅 ${escapeHtml(v.date)} ${escapeHtml(v.start + '–' + v.end)} &nbsp;·&nbsp;
              👥 ${v.party_size} 人
              ${v.companions && v.companions.length ? '（' + escapeHtml(v.companions.join('、')) + '）' : ''}
            </div>
            <div style="font-size:12px;color:var(--text-mute);margin-top:4px">
              手机 ${escapeHtml(v.phone_mask || '-')} &nbsp;·&nbsp;
              核销码 <span class="shortcode" style="font-size:14px">${escapeHtml(v.short_code || '-')}</span>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
            <a class="btn btn-primary btn-sm" href="/success/${encodeURIComponent(item.token)}">查看</a>
          </div>
        </div>
      `;
    } catch {
      row.innerHTML = '<span class="muted">加载失败</span>';
    }
  }
}

load();
