const token = location.pathname.split('/').pop();

async function main() {
  const res = await fetch('/api/booking/' + token);
  const d = await res.json();
  const title = document.getElementById('title');
  const actions = document.getElementById('actions');

  if (!d.ok) {
    title.textContent = '预约不存在';
    document.getElementById('msg').textContent = '';
    return;
  }
  document.getElementById('info').innerHTML = `
    <p><b>日期：</b> ${d.date}</p>
    <p><b>时段：</b> ${d.start} - ${d.end}</p>
    <p><b>主预约人：</b> ${d.name}</p>`;

  if (d.status !== 'active') {
    title.textContent = '该预约已取消';
    document.getElementById('msg').textContent = '二维码已失效，名额已释放。';
    return;
  }

  actions.innerHTML = `
    <button type="button" class="danger" id="doCancel">确认取消</button>
    <a class="link" href="/">保留预约</a>`;
  document.getElementById('doCancel').onclick = async () => {
    const r = await fetch('/api/cancel/' + token, { method: 'POST' }).then(x => x.json());
    if (r.ok) {
      title.textContent = '已取消 ✅';
      title.className = 'ok';
      document.getElementById('msg').textContent = '名额已释放，二维码即刻失效。';
      actions.innerHTML = '<a class="primary" href="/">重新预约</a>';
    } else {
      title.textContent = '取消失败';
      document.getElementById('msg').textContent = r.msg || '请重试';
    }
  };
}
main();
