#!/usr/bin/env python3
# 汽车体验活动 · 预约核销系统（零依赖版）
# 仅使用 Python 标准库 + 内嵌 qrcodegen.py，无需 pip install，直接 `python app.py` 运行。
# 加密：标准库 HMAC-SHA256 构造的流密码（每条约随机 nonce，等效于对称加密，满足 PII 加密存储）

import os
import sqlite3
import json
import hashlib
import hmac
import secrets
import datetime
import csv
import io
import base64
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import qrcodegen

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, 'data.db')
ENV_FILE = os.path.join(BASE, '.env')
STATIC_DIR = os.path.join(BASE, 'static')

# ---------------- 配置 ----------------
def load_env():
    if os.path.exists(ENV_FILE):
        for line in open(ENV_FILE, encoding='utf-8'):
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env()

PEPPER = os.environ.get('PEPPER', 'change_me_pepper').encode()
RAW_KEY = os.environ.get('ENCRYPTION_KEY')
if not RAW_KEY:
    RAW_KEY = base64.b64encode(secrets.token_bytes(32)).decode()
    with open(ENV_FILE, 'a', encoding='utf-8') as f:
        f.write(f"\nENCRYPTION_KEY={RAW_KEY}\n")
KEY = base64.b64decode(RAW_KEY)

ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', '404112')
RETENTION_DAYS = int(os.environ.get('RETENTION_DAYS', '30'))
REQUIRE_ID = os.environ.get('REQUIRE_ID', '0') == '1'
CAPACITY = int(os.environ.get('CAPACITY', '30'))
MAX_COMPANIONS = 2
BASE_URL = os.environ.get('BASE_URL')  # 可选：公网地址，用于生成二维码链接

SLOTS_SEED = [
    ('2026-08-14', '14:00', '16:00'),
    ('2026-08-14', '16:00', '18:00'),
    ('2026-08-15', '10:00', '12:00'),
    ('2026-08-15', '12:00', '14:00'),
    ('2026-08-15', '14:00', '16:00'),
    ('2026-08-15', '16:00', '18:00'),
]

ADMIN_SESSIONS = set()


# ---------------- 加密 ----------------
def _keystream(nonce, length):
    out = b''
    c = 0
    while len(out) < length:
        out += hmac.new(KEY, nonce + c.to_bytes(8, 'big'), hashlib.sha256).digest()
        c += 1
    return out[:length]


def enc(s):
    nonce = secrets.token_bytes(16)
    data = s.encode('utf-8')
    ct = bytes(a ^ b for a, b in zip(data, _keystream(nonce, len(data))))
    return base64.b64encode(nonce + ct).decode('ascii')


def dec(s):
    if not s:
        return ''
    raw = base64.b64decode(s)
    nonce, ct = raw[:16], raw[16:]
    return bytes(a ^ b for a, b in zip(ct, _keystream(nonce, len(ct)))).decode('utf-8')


def key_hash(s):
    return hashlib.sha256(PEPPER + s.strip().lower().encode('utf-8')).hexdigest()


# ---------------- 数据库 ----------------
def db_conn():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = db_conn()
    c = conn.cursor()
    c.executescript('''
    CREATE TABLE IF NOT EXISTS slots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        capacity INTEGER NOT NULL,
        available INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT UNIQUE NOT NULL,
        booker_key_hash TEXT NOT NULL,
        booking_date TEXT NOT NULL,
        slot_id INTEGER NOT NULL,
        party_size INTEGER NOT NULL,
        booker_name_enc TEXT NOT NULL,
        booker_id_enc TEXT,
        attended INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS companions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        booking_id INTEGER NOT NULL,
        name_enc TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_booker_date
        ON bookings(booker_key_hash, booking_date)
        WHERE status='active';
    ''')
    c.execute('SELECT COUNT(*) AS n FROM slots')
    if c.fetchone()['n'] == 0:
        for d, s, e in SLOTS_SEED:
            c.execute('INSERT INTO slots(date,start_time,end_time,capacity,available) VALUES(?,?,?,?,?)',
                      (d, s, e, CAPACITY, CAPACITY))
    conn.commit()
    conn.close()


def get_companions(bid):
    conn = db_conn()
    c = conn.cursor()
    rows = c.execute('SELECT name_enc FROM companions WHERE booking_id=?', (bid,)).fetchall()
    conn.close()
    return [dec(r['name_enc']) for r in rows]


def valid_id(idn):
    if len(idn) != 18:
        return False
    if not idn[:17].isdigit() or idn[17] not in '0123456789Xx':
        return False
    weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
    codes = '10X98765432'
    s = sum(int(idn[i]) * weights[i] for i in range(17))
    return idn[17].upper() == codes[s % 11]


# ---------------- 二维码 ----------------
def qr_svg(text):
    qr = qrcodegen.QrCode.encode_text(text, qrcodegen.QrCode.Ecc.MEDIUM)
    n = qr.get_size()
    rects = []
    for y in range(n):
        for x in range(n):
            if qr.get_module(x, y):
                rects.append(f'<rect x="{x}" y="{y}" width="1" height="1"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n} {n}" '
            f'shape-rendering="crispEdges" style="width:200px;height:200px">'
            f'<rect width="{n}" height="{n}" fill="#fff"/>{"".join(rects)}</svg>')


def qr_url(token, host):
    if BASE_URL:
        return f"{BASE_URL.rstrip('/')}/checkin/{token}"
    return f"http://{host or 'localhost'}/checkin/{token}"


# ---------------- 页面渲染 ----------------
def render_index():
    id_label = '身份证号' if REQUIRE_ID else '身份证号（选填）'
    id_attr = 'required' if REQUIRE_ID else ''
    return f'''<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>汽车体验活动 · 预约</title><link rel="stylesheet" href="/static/style.css"></head>
<body><div class="card">
<h1>汽车体验活动预约</h1>
<p class="sub">请选择日期与时段，填写信息后提交。每人每天限约一个时段，最多可带 2 名随行人。</p>
<form id="bookForm">
<label>选择日期<select id="date" name="date" required>
<option value="">— 请选择 —</option>
<option value="2026-08-14">8月14日（周四）</option>
<option value="2026-08-15">8月15日（周五）</option></select></label>
<label>选择时段<select id="slot" name="slot_id" required disabled>
<option value="">— 请先选择日期 —</option></select>
<span class="hint" id="slotHint"></span></label>
<label>主预约人姓名<input type="text" name="name" required placeholder="请输入姓名"></label>
<label>身份证号<input type="text" name="booker_id" placeholder="18位身份证号" maxlength="18" {id_attr}></label>
<p class="hint" style="margin:-6px 0 14px">{id_label}</p>
<div class="companions"><div class="comp-head"><span>随行人（最多 2 人，仅填姓名）</span>
<button type="button" id="addCompanion" class="link">+ 添加</button></div>
<div id="companionList"></div></div>
<button type="submit" class="primary" id="submit">提交预约</button>
<p class="msg" id="msg"></p></form></div>
<script src="/static/app.js"></script></body></html>'''


def render_success(token, slot, comps, qr):
    comp_html = '、'.join(comps) if comps else '无'
    return f'''<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>预约成功</title><link rel="stylesheet" href="/static/style.css"></head>
<body><div class="card center">
<h1 class="ok">预约成功 🎉</h1>
<p class="sub">请保存下方二维码，到场出示核销。如无法前来，可随时取消释放名额。</p>
<div class="qr">{qr}</div>
<div class="info">
<p><b>日期：</b> {slot['date']}</p>
<p><b>时段：</b> {slot['start_time']} - {slot['end_time']}</p>
<p><b>主预约人：</b> {slot.get('_name','')} </p>
<p><b>总人数：</b> {slot.get('_size','')} 人（含随行）</p>
<p><b>随行人：</b> {comp_html}</p></div>
<div class="actions"><a class="primary" href="/cancel/{token}">取消预约</a></div>
<p class="hint">取消后二维码立即失效，名额实时释放。</p></div></body></html>'''


def render_cancel(done, slot=None, name=''):
    if done:
        return '''<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>取消预约</title><link rel="stylesheet" href="/static/style.css"></head>
<body><div class="card center"><h1 class="ok">已取消 ✅</h1>
<p class="sub">您的预约已取消，名额已释放，二维码即刻失效。</p>
<a class="primary" href="/">重新预约</a></div></body></html>'''
    return f'''<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>取消预约</title><link rel="stylesheet" href="/static/style.css"></head>
<body><div class="card center"><h1>确认取消预约？</h1>
<p class="sub">取消后该时段名额将实时 +1 释放给他人。</p>
<div class="info"><p><b>日期：</b> {slot['date']}</p>
<p><b>时段：</b> {slot['start_time']} - {slot['end_time']}</p>
<p><b>主预约人：</b> {name}</p></div>
<form method="post" class="row">
<button type="submit" class="danger">确认取消</button>
<a class="link" href="/">保留预约</a></form></div></body></html>'''


def render_checkin(ok, msg):
    return f'''<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>核销</title><link rel="stylesheet" href="/static/style.css"></head>
<body><div class="card center">
<h1 class="{'ok' if ok else 'warn'}">{'核销成功 ✅' if ok else '无法核销'}</h1>
<p class="sub">{msg}</p><a class="link" href="/">返回首页</a></div></body></html>'''


def render_admin_login(error=''):
    err = f'<p class="msg err">{error}</p>' if error else ''
    return f'''<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>管理员登录</title><link rel="stylesheet" href="/static/style.css"></head>
<body><div class="card center"><h1>管理员后台</h1>
<p class="sub">请输入管理密码</p>
{err}<form method="post"><label>密码<input type="password" name="password" required autofocus></label>
<button type="submit" class="primary">登录</button></form></div></body></html>'''


def render_admin(rows, slots, retention_days):
    total = len(rows)
    came = sum(1 for r in rows if r['attended'])
    cancelled = sum(1 for r in rows if r['status'] != 'active')
    nodrop = total - came - cancelled
    body = []
    for r in rows:
        r = dict(r)
        comps = get_companions(r['id'])
        comp_html = '、'.join(comps) if comps else '—'
        if r['status'] != 'active':
            state, cls = '已取消', 'muted'
        elif r['attended']:
            state, cls = '已到场', ''
        else:
            state, cls = '未到场', 'nodrop'
        action = ''
        if r['status'] == 'active' and not r['attended']:
            action = (f'<form method="post" action="/admin/checkin/{r["id"]}" class="inline">'
                      f'<button type="submit" class="link">标记到场</button></form>')
        body.append(
            f'<tr class="{cls}"><td> {r["id"]} </td>'
            f'<td> {r["date"]}<br> {r["start_time"]}-{r["end_time"]} </td>'
            f'<td> {dec(r["booker_name_enc"])} </td>'
            f'<td> {comp_html} </td>'
            f'<td> {r["party_size"]} </td><td> {state} </td>'
            f'<td> {"✅" if r["attended"] else "—"} </td><td> {action} </td></tr>')
    rows_html = ''.join(body)
    return f'''<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>管理员后台</title><link rel="stylesheet" href="/static/style.css"></head>
<body><div class="admin">
<div class="topbar"><h1>报名管理后台</h1>
<div class="topbar-actions">
<a class="link" href="/admin/export">导出 CSV</a>
<form method="post" action="/admin/cleanup" class="inline" onsubmit="return confirm('确认删除超过 {retention_days} 天的历史记录？');">
<button type="submit" class="link danger">清理过期数据</button></form>
<a class="link" href="/admin/logout">退出</a></div></div>
<div class="summary">总记录 {total} · 已到场 {came} · 预约未到 {nodrop} · 已取消 {cancelled}</div>
<table><thead><tr><th>ID</th><th>日期/时段</th><th>主预约人</th><th>随行人</th>
<th>人数</th><th>状态</th><th>到场</th><th>操作</th></tr></thead>
<tbody> {rows_html} </tbody></table></div></body></html>'''


# ---------------- 业务处理 ----------------
def do_book(data):
    date = data.get('date')
    try:
        slot_id = int(data.get('slot_id'))
    except (TypeError, ValueError):
        return False, 'BAD_SLOT', '请选择时段', 400
    name = (data.get('name') or '').strip()
    booker_id = (data.get('booker_id') or '').strip()
    companions = [c.strip() for c in data.get('companions', []) if isinstance(c, str) and c.strip()]

    if not name:
        return False, 'NAME_REQUIRED', '请填写姓名', 400
    if REQUIRE_ID and not booker_id:
        return False, 'ID_REQUIRED', '请填写身份证号', 400
    if booker_id and not valid_id(booker_id):
        return False, 'ID_INVALID', '身份证号格式或校验位错误', 400
    if len(companions) > MAX_COMPANIONS:
        return False, 'TOO_MANY', f'随行人最多{MAX_COMPANIONS}人', 400

    party_size = 1 + len(companions)
    key = booker_id if booker_id else name
    token = secrets.token_urlsafe(16)
    now = datetime.datetime.now().isoformat(timespec='seconds')

    conn = db_conn()
    c = conn.cursor()
    try:
        c.execute('BEGIN')
        c.execute('UPDATE slots SET available = available - ? WHERE id=? AND available >= ?',
                  (party_size, slot_id, party_size))
        if c.rowcount == 0:
            conn.rollback()
            return False, 'SOLD_OUT', '该时段名额不足或已约满', 409
        c.execute('''INSERT INTO bookings(token,booker_key_hash,booking_date,slot_id,party_size,
                    booker_name_enc,booker_id_enc,created_at)
                    VALUES(?,?,?,?,?,?,?,?)''',
                  (token, key_hash(key), date, slot_id, party_size, enc(name),
                   enc(booker_id) if booker_id else None, now))
        bid = c.lastrowid
        for cn in companions:
            c.execute('INSERT INTO companions(booking_id,name_enc) VALUES(?,?)', (bid, enc(cn)))
        conn.commit()
    except sqlite3.IntegrityError:
        conn.rollback()
        return False, 'DUPLICATE', '您今天已预约过该活动', 409
    finally:
        conn.close()
    return True, 'OK', token, 200


# ---------------- HTTP 处理 ----------------
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype, headers=None):
        if isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        length = int(self.headers.get('Content-Length', 0) or 0)
        raw = self.rfile.read(length) if length else b''
        ct = self.headers.get('Content-Type', '')
        if 'application/json' in ct:
            data = json.loads(raw.decode('utf-8') or '{}')
            if isinstance(data.get('companions'), str):
                data['companions'] = [x for x in data['companions'].split(',') if x.strip()]
            elif not isinstance(data.get('companions'), list):
                data['companions'] = []
            return data
        qs = urllib.parse.parse_qs(raw.decode('utf-8'))
        return {k: (v if k == 'companions' else v[0]) for k, v in qs.items()}

    def _cookie_sid(self):
        cookie = self.headers.get('Cookie', '')
        for part in cookie.split(';'):
            part = part.strip()
            if part.startswith('sid='):
                return part[4:]
        return None

    def _admin_ok(self):
        return self._cookie_sid() in ADMIN_SESSIONS

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/':
            return self._send(200, render_index(), 'text/html; charset=utf-8')
        if path == '/api/slots':
            conn = db_conn()
            c = conn.cursor()
            date = urllib.parse.parse_qs(self.path.split('?')[1] if '?' in self.path else '').get('date', [None])[0]
            if date:
                rows = c.execute('SELECT * FROM slots WHERE date=? ORDER BY start_time', (date,)).fetchall()
            else:
                rows = c.execute('SELECT * FROM slots ORDER BY date, start_time').fetchall()
            conn.close()
            return self._send(200, json.dumps([dict(r) for r in rows], ensure_ascii=False),
                              'application/json; charset=utf-8')
        if path.startswith('/success/'):
            token = path[len('/success/'):]
            conn = db_conn(); c = conn.cursor()
            b = c.execute('SELECT * FROM bookings WHERE token=?', (token,)).fetchone()
            if not b:
                return self._send(404, 'not found', 'text/plain; charset=utf-8')
            slot = c.execute('SELECT * FROM slots WHERE id=?', (b['slot_id'],)).fetchone()
            comps = get_companions(b['id'])
            conn.close()
            slot = dict(slot); slot['_name'] = dec(b['booker_name_enc']); slot['_size'] = b['party_size']
            return self._send(200, render_success(token, slot, comps, qr_svg(qr_url(token, self.headers.get('Host')))),
                              'text/html; charset=utf-8')
        if path.startswith('/cancel/'):
            token = path[len('/cancel/'):]
            conn = db_conn(); c = conn.cursor()
            b = c.execute('SELECT * FROM bookings WHERE token=?', (token,)).fetchone()
            if not b:
                return self._send(404, 'not found', 'text/plain; charset=utf-8')
            slot = c.execute('SELECT * FROM slots WHERE id=?', (b['slot_id'],)).fetchone()
            conn.close()
            return self._send(200, render_cancel(False, dict(slot), dec(b['booker_name_enc'])),
                              'text/html; charset=utf-8')
        if path.startswith('/checkin/'):
            token = path[len('/checkin/'):]
            conn = db_conn(); c = conn.cursor()
            b = c.execute('SELECT * FROM bookings WHERE token=?', (token,)).fetchone()
            if not b:
                return self._send(200, render_checkin(False, '二维码无效'), 'text/html; charset=utf-8')
            if b['status'] != 'active':
                conn.close()
                return self._send(200, render_checkin(False, '该预约已取消，二维码失效'), 'text/html; charset=utf-8')
            if b['attended']:
                conn.close()
                return self._send(200, render_checkin(True, '已核销，请勿重复'), 'text/html; charset=utf-8')
            c.execute('UPDATE bookings SET attended=1 WHERE token=?', (token,))
            conn.commit(); conn.close()
            return self._send(200, render_checkin(True, '核销成功，欢迎体验！'), 'text/html; charset=utf-8')
        if path == '/admin':
            if self._admin_ok():
                return self._redirect('/admin/dashboard')
            return self._send(200, render_admin_login(), 'text/html; charset=utf-8')
        if path == '/admin/logout':
            sid = self._cookie_sid()
            if sid:
                ADMIN_SESSIONS.discard(sid)
            self.send_response(303)
            self.send_header('Location', '/admin')
            self.send_header('Set-Cookie', 'sid=; Path=/; Max-Age=0')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if path == '/admin/dashboard':
            if not self._admin_ok():
                return self._redirect('/admin')
            conn = db_conn(); c = conn.cursor()
            rows = c.execute('''SELECT b.*, s.date, s.start_time, s.end_time
                                FROM bookings b JOIN slots s ON b.slot_id=s.id
                                ORDER BY s.date, s.start_time, b.id''').fetchall()
            slots = c.execute('SELECT * FROM slots ORDER BY date, start_time').fetchall()
            conn.close()
            return self._send(200, render_admin(rows, slots, RETENTION_DAYS), 'text/html; charset=utf-8')
        if path == '/admin/export':
            if not self._admin_ok():
                return self._redirect('/admin')
            conn = db_conn(); c = conn.cursor()
            rows = c.execute('''SELECT b.*, s.date, s.start_time, s.end_time
                                FROM bookings b JOIN slots s ON b.slot_id=s.id
                                ORDER BY s.date, s.start_time, b.id''').fetchall()
            out = io.StringIO(); w = csv.writer(out)
            w.writerow(['预约ID', '日期', '时段', '主预约人', '身份证', '随行人', '总人数',
                        '状态', '是否到场', '预约时间'])
            for r in rows:
                r = dict(r)
                comps = get_companions(r['id'])
                bid = dec(r['booker_id_enc']) if r['booker_id_enc'] else ''
                status = '已取消' if r['status'] != 'active' else ('已到场' if r['attended'] else '未到场')
                w.writerow([r['id'], r['date'], f"{r['start_time']}-{r['end_time']}",
                            dec(r['booker_name_enc']), bid, '、'.join(comps), r['party_size'],
                            status, '是' if r['attended'] else '否', r['created_at']])
            conn.close()
            buf = io.BytesIO(); buf.write(out.getvalue().encode('utf-8-sig')); buf.seek(0)
            return self._send(200, buf.getvalue(), 'text/csv; charset=utf-8',
                              {'Content-Disposition': "attachment; filename=signup_export.csv"})
        if path.startswith('/static/'):
            return self._static(path)
        self._send(404, 'not found', 'text/plain; charset=utf-8')

    def do_POST(self):
        path = self.path.split('?')[0]
        if path == '/book':
            ok, code, msg, http = do_book(self._body())
            if ok:
                return self._send(http, json.dumps({'ok': True, 'token': msg}, ensure_ascii=False),
                                  'application/json; charset=utf-8')
            return self._send(http, json.dumps({'ok': False, 'code': code, 'msg': msg}, ensure_ascii=False),
                              'application/json; charset=utf-8')
        if path == '/admin':
            data = self._body()
            if data.get('password') == ADMIN_PASSWORD:
                sid = secrets.token_hex(16)
                ADMIN_SESSIONS.add(sid)
                self.send_response(303)
                self.send_header('Location', '/admin/dashboard')
                self.send_header('Set-Cookie', f'sid={sid }; Path=/; HttpOnly')
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
            return self._send(200, render_admin_login('密码错误'), 'text/html; charset=utf-8')
        if path.startswith('/cancel/'):
            token = path[len('/cancel/'):]
            conn = db_conn(); c = conn.cursor()
            b = c.execute('SELECT * FROM bookings WHERE token=?', (token,)).fetchone()
            if b and b['status'] == 'active':
                c.execute('BEGIN')
                c.execute('UPDATE slots SET available = MIN(capacity, available + ?) WHERE id=?',
                          (b['party_size'], b['slot_id']))
                c.execute('UPDATE bookings SET status=? WHERE token=?', ('cancelled', token))
                conn.commit()
            conn.close()
            return self._send(200, render_cancel(True), 'text/html; charset=utf-8')
        if path.startswith('/admin/checkin/'):
            if not self._admin_ok():
                return self._redirect('/admin')
            bid = path[len('/admin/checkin/'):]
            conn = db_conn(); c = conn.cursor()
            c.execute('UPDATE bookings SET attended=1 WHERE id=? AND status=?', (int(bid), 'active'))
            conn.commit(); conn.close()
            return self._redirect('/admin/dashboard')
        if path == '/admin/cleanup':
            if not self._admin_ok():
                return self._redirect('/admin')
            cutoff = (datetime.datetime.now() - datetime.timedelta(days=RETENTION_DAYS)).isoformat(timespec='seconds')
            conn = db_conn(); c = conn.cursor()
            ids = [r['id'] for r in c.execute('SELECT id FROM bookings WHERE created_at < ?', (cutoff,)).fetchall()]
            for i in ids:
                c.execute('DELETE FROM companions WHERE booking_id=?', (i,))
            c.execute('DELETE FROM bookings WHERE created_at < ?', (cutoff,))
            conn.commit(); conn.close()
            return self._redirect('/admin/dashboard')
        self._send(404, 'not found', 'text/plain; charset=utf-8')

    def _redirect(self, loc):
        self.send_response(303)
        self.send_header('Location', loc)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def _static(self, path):
        rel = path[len('/static/'):]
        full = os.path.normpath(os.path.join(STATIC_DIR, rel))
        if not full.startswith(STATIC_DIR) or not os.path.isfile(full):
            return self._send(404, 'not found', 'text/plain; charset=utf-8')
        ctype = 'text/css' if full.endswith('.css') else 'application/javascript'
        with open(full, 'rb') as f:
            return self._send(200, f.read(), ctype)


if __name__ == '__main__':
    init_db()
    port = int(os.environ.get('PORT', 5000))
    print(f'预约系统已启动： http://localhost:{port}  （后台 /admin）')
    ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever()
