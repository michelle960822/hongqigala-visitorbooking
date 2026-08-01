// 预约成功页
'use strict';

const $ = (s) => document.querySelector(s);

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const token = location.pathname.replace(/^\/success\//, '').replace(/\/$/, '').trim();
if (!token) { $('#iName').textContent = '无效的预约链接'; }

async function load() {
  const r = await fetch('/api/booking/' + encodeURIComponent(token));
  if (r.status !== 200) {
    $('#iName').textContent = '加载失败';
    return;
  }
  const v = await r.json();
  if (!v || !v.name) { $('#iName').textContent = '预约不存在'; return; }
  // 二维码（用核销 URL，扫码也能核销）
  const checkinUrl = location.origin + '/checkin/' + token;
  const qr = qrcode(0, 'M');
  qr.addData(checkinUrl);
  qr.make();
  $('#qr').innerHTML = qr.createImgTag(6, 8);
  // 短码
  const sc = v.short_code || sessionStorage.getItem('shortCode_' + token) || '------';
  $('#shortCode').textContent = sc;
  // 详情
  $('#iName').textContent = v.name + (v.phone ? '（' + v.phone.slice(0,3) + '****' + v.phone.slice(-4) + '）' : '');
  $('#iDate').textContent = v.date;
  $('#iSlot').textContent = v.start + '–' + v.end;
  $('#iParty').textContent = v.party_size + ' 人' + (v.companions && v.companions.length ? '（含随行 ' + v.companions.join('、') + '）' : '');
  // 取消链接
  $('#cancelLink').href = '/cancel/' + token;
  // 标题
  document.title = '预约成功 · ' + v.date + ' ' + v.start;
}
load();
