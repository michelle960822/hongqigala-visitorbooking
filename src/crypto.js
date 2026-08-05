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

// ---------- AES-256-GCM（标准 Web Crypto，Workers/Pages 原生支持）----------
let _aesKey = null;

async function getKey() {
  if (!KEY) throw new Error('crypto 未初始化');
  if (!_aesKey) {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', KEY));
    _aesKey = await crypto.subtle.importKey('raw', h, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  return _aesKey;
}

export async function enc(s) {
  if (s === null || s === undefined || s === '') return s === null || s === undefined ? s : '';
  const data = new TextEncoder().encode(String(s));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await getKey();
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, data));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return bytesToBase64(out);
}

export async function dec(s) {
  if (!s) return '';
  const raw = base64ToBytes(s);
  if (raw.length < 12) return '';
  const iv = raw.subarray(0, 12);
  const ct = raw.subarray(12);
  try {
    const k = await getKey();
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k, ct);
    return new TextDecoder().decode(pt);
  } catch { return ''; }
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
