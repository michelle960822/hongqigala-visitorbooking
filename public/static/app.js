const MAX = 2;
let companionCount = 0;

const dateEl = document.getElementById('date');
const slotEl = document.getElementById('slot');
const slotHint = document.getElementById('slotHint');

dateEl.addEventListener('change', async () => {
  const date = dateEl.value;
  slotEl.innerHTML = '<option value="">— 请选择时段 —</option>';
  slotHint.textContent = '';
  if (!date) { slotEl.disabled = true; return; }
  const res = await fetch('/api/slots?date=' + date);
  const slots = await res.json();
  slotEl.disabled = false;
  slots.forEach(s => {
    const o = document.createElement('option');
    o.value = s.id;
    const left = s.available;
    o.textContent = `${s.start_time}-${s.end_time}（剩余 ${left}）`;
    if (left <= 0) { o.disabled = true; o.textContent += ' · 已约满'; }
    slotEl.appendChild(o);
  });
});

slotEl.addEventListener('change', () => {
  const opt = slotEl.options[slotEl.selectedIndex];
  slotHint.textContent = opt && opt.disabled ? '该时段已约满，请换一个' : '';
});

document.getElementById('addCompanion').addEventListener('click', () => {
  if (companionCount >= MAX) return;
  companionCount++;
  const wrap = document.getElementById('companionList');
  const row = document.createElement('div');
  row.className = 'c-row';
  row.innerHTML = `<input type="text" name="companions" placeholder="随行人姓名 ${companionCount}">
                   <button type="button" class="c-del">×</button>`;
  row.querySelector('.c-del').addEventListener('click', () => {
    row.remove(); companionCount--; renumber();
  });
  wrap.appendChild(row);
});

function renumber() {
  const rows = document.querySelectorAll('#companionList .c-row');
  companionCount = rows.length;
  rows.forEach((r, i) => { r.querySelector('input').placeholder = `随行人姓名 ${i + 1}`; });
}

const form = document.getElementById('bookForm');
const msg = document.getElementById('msg');
const submit = document.getElementById('submit');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.textContent = '';
  submit.disabled = true;
  submit.textContent = '提交中…';
  const fd = new FormData(form);
  const payload = {
    date: fd.get('date'),
    slot_id: fd.get('slot_id'),
    name: fd.get('name'),
    booker_id: fd.get('booker_id') || '',
    companions: fd.getAll('companions')
  };
  try {
    const res = await fetch('/api/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.ok) {
      window.location.href = '/success/' + data.token;
    } else {
      msg.textContent = data.msg || '提交失败';
      msg.className = 'msg err';
      submit.disabled = false;
      submit.textContent = '提交预约';
    }
  } catch (err) {
    msg.textContent = '网络错误，请重试';
    msg.className = 'msg err';
    submit.disabled = false;
    submit.textContent = '提交预约';
  }
});
