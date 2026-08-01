// 预约首页
'use strict';

const $ = (s) => document.querySelector(s);

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

let slots = [];
let selectedSlot = null;

async function loadSlots() {
  const date = $('#date').value;
  const r = await fetch('/api/slots?date=' + date);
  const data = await r.json();
  slots = (data && data.slots) || [];
  renderSlots();
}

function renderSlots() {
  const root = $('#slots');
  if (slots.length === 0) {
    root.innerHTML = '<div class="muted" style="grid-column:1/-1;text-align:center;padding:12px">该日期暂无可预约时段</div>';
    selectedSlot = null;
    return;
  }
  root.innerHTML = slots.map(s => {
    const soldOut = (s.available || 0) <= 0;
    return `
      <div class="slot-card ${soldOut ? 'disabled' : ''} ${selectedSlot === s.id ? 'active' : ''}" data-id="${s.id}">
        <div class="t">${s.start_time}–${s.end_time}</div>
        <div class="c">${soldOut ? '已约满' : '余 ' + s.available}</div>
      </div>
    `;
  }).join('');
  root.querySelectorAll('.slot-card').forEach(el => {
    el.addEventListener('click', () => {
      if (el.classList.contains('disabled')) return;
      selectedSlot = Number(el.dataset.id);
      root.querySelectorAll('.slot-card').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
    });
  });
}

$('#date').addEventListener('change', loadSlots);

$('#submit').addEventListener('click', async () => {
  const msg = $('#msg');
  msg.textContent = '';
  const name = $('#name').value.trim();
  const phone = $('#phone').value.trim();
  const booker_id = $('#booker_id').value.trim();
  const c1 = $('#c1').value.trim();
  const c2 = $('#c2').value.trim();
  const companions = [c1, c2].filter(Boolean);
  const consent = $('#consent').checked;
  if (!name) { toast({ type: 'warning', title: '请填写姓名' }); return; }
  if (!phone) { toast({ type: 'warning', title: '请填写手机号' }); return; }
  if (!/^1\d{10}$/.test(phone)) { toast({ type: 'warning', title: '手机号格式不对', sub: '需 11 位、以 1 开头' }); return; }
  if (booker_id && !validIdLocal(booker_id)) { toast({ type: 'warning', title: '身份证号格式或校验位错误' }); return; }
  if (!booker_id) { toast({ type: 'warning', title: '请填写身份证号' }); return; }
  if (!selectedSlot) { toast({ type: 'warning', title: '请选择时段' }); return; }
  if (!consent) { toast({ type: 'warning', title: '请先同意个人信息处理说明' }); return; }

  const btn = $('#submit');
  btn.disabled = true; btn.textContent = '提交中…';
  try {
    const r = await fetch('/api/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: $('#date').value, slot_id: selectedSlot, name, phone, booker_id, companions }),
    });
    const data = await r.json();
    if (data.ok) {
      sessionStorage.setItem('shortCode_' + data.token, data.short_code || '');
      location.href = '/success/' + data.token;
    } else {
      toast({ type: 'danger', title: '预约失败', sub: data.msg || '请稍后再试' });
      btn.disabled = false; btn.textContent = '提交预约';
    }
  } catch (e) {
    toast({ type: 'danger', title: '网络错误' });
    btn.disabled = false; btn.textContent = '提交预约';
  }
});

function validIdLocal(s) {
  if (!/^\d{17}[\dXx]$/.test(s)) return false;
  const w = [7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2];
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(s[i]) * w[i];
  const c = '10X98765432'[sum % 11];
  return c === s[17].toUpperCase();
}

loadSlots();
