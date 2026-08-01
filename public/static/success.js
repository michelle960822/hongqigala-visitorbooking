const token = location.pathname.split('/').pop();

async function main() {
  const res = await fetch('/api/booking/' + token);
  const d = await res.json();
  if (!d.ok) {
    document.getElementById('info').textContent = '预约不存在';
    document.getElementById('qr').textContent = '';
    return;
  }
  document.getElementById('info').innerHTML = `
    <p><b>日期：</b> ${d.date}</p>
    <p><b>时段：</b> ${d.start} - ${d.end}</p>
    <p><b>主预约人：</b> ${d.name}</p>
    <p><b>总人数：</b> ${d.party_size} 人（含随行）</p>
    <p><b>随行人：</b> ${d.companions.length ? d.companions.join('、') : '无'}</p>`;

  const url = location.origin + '/checkin/' + token;
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  document.getElementById('qr').innerHTML = qr.createImgTag(5, 8);

  document.getElementById('cancelLink').href = '/cancel/' + token;
}
main();
