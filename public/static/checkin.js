const token = location.pathname.split('/').pop();

fetch('/api/checkin/' + token, { method: 'POST' })
  .then(r => r.json())
  .then(d => {
    const title = document.getElementById('title');
    title.textContent = d.ok ? '核销成功 ✅' : '无法核销';
    title.className = d.ok ? 'ok' : 'warn';
    document.getElementById('msg').textContent = d.msg || '';
  })
  .catch(() => {
    document.getElementById('title').textContent = '网络错误';
    document.getElementById('title').className = 'warn';
    document.getElementById('msg').textContent = '请重试';
  });
