// 加密与校验工具（Web Crypto 实现，Cloudflare Workers 与 Node 18+ 通用）
// 等价 Python 版：HMAC-SHA256 流密码，每条记录带 16 字节随机 nonce。
// 满足个人信息（PII）加密存储要求。

let KEY = null; // Uint8Array，由 initCrypto 注入

export function initCrypto(encryptionKeyB64) {
  KEY = base64ToBytes(encryptionKeyB64);
  if (!KEY || KEY.length < 16) throw new Error('ENCRYPTION_KEY 无效，需至少 16 字节的 base64 密钥');
}

export function isCryptoReady() {
  return KEY !== null;
}

// ---------- base64（Workers / Node 通用，避免依赖 Buffer） ----------
function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- HMAC-SHA256 ----------
let _hmacKey = null;
async function hmacSha256(msg) {
  if (!KEY) throw new Error('crypto 未初始化，请先调用 initCrypto');
  if (!_hmacKey) {
    _hmacKey = await crypto.subtle.importKey(
      'raw', KEY, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
  }
  const sig = await crypto.subtle.sign('HMAC', _hmacKey, msg);
  return new Uint8Array(sig);
}

// 大端 64 位整数（等价 Python c.to_bytes(8, 'big')）
function uint64be(n) {
  const out = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

// 密钥流：HMAC(KEY, nonce || c) 逐块拼接，直到足够长度
async function keystream(nonce, length) {
  const out = new Uint8Array(length);
  let pos = 0;
  let c = 0n;
  while (pos < length) {
    const msg = new Uint8Array(nonce.length + 8);
    msg.set(nonce, 0);
    msg.set(uint64be(c), nonce.length);
    const h = await hmacSha256(msg);
    const take = Math.min(h.length, length - pos);
    out.set(h.subarray(0, take), pos);
    pos += take;
    c++;
  }
  return out;
}

export async function enc(s) {
  if (s === null || s === undefined || s === '') return s === null || s === undefined ? s : '';
  const data = new TextEncoder().encode(String(s));
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  const ks = await keystream(nonce, data.length);
  const ct = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) ct[i] = data[i] ^ ks[i];
  const combined = new Uint8Array(16 + data.length);
  combined.set(nonce, 0);
  combined.set(ct, 16);
  return bytesToBase64(combined);
}

export async function dec(s) {
  if (!s) return '';
  const raw = base64ToBytes(s);
  if (raw.length < 16) return '';
  const nonce = raw.subarray(0, 16);
  const ct = raw.subarray(16);
  const ks = await keystream(nonce, ct.length);
  const out = new Uint8Array(ct.length);
  for (let i = 0; i < ct.length; i++) out[i] = ct[i] ^ ks[i];
  return new TextDecoder().decode(out);
}

export async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 身份证号校验位（GB 11643-1999，MOD 11-2），与 Python 版一致
export function validId(idn) {
  if (typeof idn !== 'string' || idn.length !== 18) return false;
  if (!/^\d{17}[\dXx]$/.test(idn)) return false;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const codes = '10X98765432';
  let s = 0;
  for (let i = 0; i < 17; i++) s += parseInt(idn[i], 10) * weights[i];
  return idn[17].toUpperCase() === codes[s % 11];
}

// 护照号：5–20 位字母/数字（中外护照均适用）
export function validPassport(s) {
  if (typeof s !== 'string') return false;
  return /^[A-Za-z0-9]{5,20}$/.test(s);
}

// 身份证或护照任一有效即可
export function validIdOrPassport(s) {
  if (validId(s)) return true;
  return validPassport(s);
}
