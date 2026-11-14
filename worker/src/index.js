import { certificateFormat, certificateTypes } from './certificate-format.js';

const MAX_FILE = 10 * 1024 * 1024;
const encoder = new TextEncoder();

export function normalizeBatch(value) {
  const batch = String(value ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 /_.-]{0,79}$/.test(batch)) {
    throw new HttpError(400, 'Enter a batch number using letters, numbers, spaces, /, _, . or -.');
  }
  return batch;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (data, status = 200) => Response.json(data, { status });
const hex = (bytes) => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
async function digest(value) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
async function sign(value, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}
function equal(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
async function authorize(request, env) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  const [expires, nonce, signature] = token.split('.');
  if (!expires || !nonce || !signature || Number(expires) < Date.now() ||
      !equal(signature, await sign(`${expires}.${nonce}`, env.SESSION_SECRET))) {
    throw new HttpError(401, 'Your session has expired. Please sign in again.');
  }
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '');
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    throw new HttpError(503, 'Certificate service is not configured yet.');
  }
  if (path === '/auth/login' && request.method === 'POST') {
    const ip = await digest(request.headers.get('CF-Connecting-IP') ?? 'local');
    const now = Date.now();
    await env.DB.prepare('DELETE FROM login_attempts WHERE reset_at < ?').bind(now).run();
    const attempt = await env.DB.prepare(`INSERT INTO login_attempts (ip_hash, attempts, reset_at)
      VALUES (?, 1, ?) ON CONFLICT(ip_hash) DO UPDATE SET attempts = attempts + 1
      RETURNING attempts`).bind(ip, now + 15 * 60 * 1000).first();
    if (attempt.attempts > 10) throw new HttpError(429, 'Too many sign-in attempts. Please try again in 15 minutes.');
    const body = await request.json();
    if (typeof body.password !== 'string' || body.password.length > 1024 ||
      !equal(await digest(body.password), await digest(env.ADMIN_PASSWORD))) {
      throw new HttpError(401, 'Incorrect password.');
    }
    const payload = `${now + 4 * 60 * 60 * 1000}.${crypto.randomUUID()}`;
    return json({ token: `${payload}.${await sign(payload, env.SESSION_SECRET)}` });
  }
  if (path === '/lookup' && request.method === 'GET') {
    const batch = normalizeBatch(url.searchParams.get('batch'));
    const row = await env.DB.prepare('SELECT batch_number, product_name, updated_at FROM batches WHERE batch_number = ? AND published = 1').bind(batch).first();
    if (!row) throw new HttpError(404, 'No certificate found for this batch. Check the number on your bottle and try again.');
    return json(row);
  }
  if (path === '/certificate' && request.method === 'GET') {
    const batch = normalizeBatch(url.searchParams.get('batch'));
    const row = await env.DB.prepare('SELECT * FROM batches WHERE batch_number = ? AND published = 1').bind(batch).first();
    if (!row) throw new HttpError(404, 'Certificate not found.');
    const file = await env.CERTIFICATES.get(row.certificate_key);
    if (!file) throw new HttpError(404, 'Certificate file is unavailable. Please contact Peregrine.');
    const type = file.httpMetadata?.contentType || 'application/pdf';
    const extension = certificateTypes[type];
    if (!extension) throw new HttpError(415, 'Unsupported certificate format.');
    return new Response(file.body, { headers: {
      'Content-Type': type,
      'Content-Disposition': `inline; filename="certificate-${batch.replace(/[^A-Z0-9-]/g, '-')}.${extension}"`,
      'X-Content-Type-Options': 'nosniff',
    } });
  }
  if (path === '/admin/batches') {
    await authorize(request, env);
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM batches ORDER BY updated_at DESC').all();
      return json(results);
    }
    if (request.method === 'POST') {
      if (Number(request.headers.get('Content-Length')) > MAX_FILE + 20000) throw new HttpError(413, 'Certificate must be smaller than 10 MB.');
      const form = await request.formData();
      const batch = normalizeBatch(form.get('batch_number'));
      const product = String(form.get('product_name') ?? '').trim();
      if (!product || product.length > 160) throw new HttpError(400, 'Enter a product name (up to 160 characters).');
      const id = String(form.get('id') ?? '');
      const existing = id ? await env.DB.prepare('SELECT * FROM batches WHERE id = ?').bind(id).first() : null;
      if (id && !existing) throw new HttpError(404, 'Batch no longer exists.');
      const duplicate = await env.DB.prepare('SELECT id FROM batches WHERE batch_number = ?').bind(batch).first();
      if (duplicate && duplicate.id !== id) throw new HttpError(409, 'This batch number already exists. Edit the existing batch instead.');
      const certificate = form.get('certificate');
      let key = existing?.certificate_key;
      let name = existing?.certificate_name;
      const hasFile = certificate instanceof File && certificate.size > 0;
      if (hasFile) {
        if (certificate.size > MAX_FILE) throw new HttpError(413, 'Certificate must be smaller than 10 MB.');
        const bytes = new Uint8Array(await certificate.arrayBuffer());
        const format = certificateFormat(bytes);
        if (!format) throw new HttpError(400, 'Upload a PDF, JPG, PNG, WebP or GIF certificate.');
        key = `${crypto.randomUUID()}.${format.extension}`;
        name = certificate.name.slice(0, 200);
        await env.CERTIFICATES.put(key, bytes, { httpMetadata: { contentType: format.type } });
      }
      if (!key) throw new HttpError(400, 'Choose a certificate file.');
      const now = new Date().toISOString();
      const recordId = id || crypto.randomUUID();
      try {
        await env.DB.prepare(`INSERT INTO batches (id, batch_number, product_name, certificate_key, certificate_name, published, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
          batch_number=excluded.batch_number, product_name=excluded.product_name, certificate_key=excluded.certificate_key,
          certificate_name=excluded.certificate_name, published=excluded.published, updated_at=excluded.updated_at`)
          .bind(recordId, batch, product, key, name, form.get('published') === 'true' ? 1 : 0, existing?.created_at ?? now, now).run();
      } catch (error) {
        if (hasFile) await env.CERTIFICATES.delete(key);
        if (String(error).includes('UNIQUE')) throw new HttpError(409, 'This batch number already exists.');
        throw error;
      }
      // Retire replaced files after the record points to the new certificate.
      if (hasFile && existing?.certificate_key) await env.CERTIFICATES.delete(existing.certificate_key);
      return json({ id: recordId }, 201);
    }
    if (request.method === 'DELETE') {
      const row = await env.DB.prepare('SELECT * FROM batches WHERE id = ?').bind(url.searchParams.get('id')).first();
      if (!row) throw new HttpError(404, 'Batch no longer exists.');
      await env.DB.prepare('DELETE FROM batches WHERE id = ?').bind(row.id).run();
      await env.CERTIFICATES.delete(row.certificate_key);
      return json({ deleted: true });
    }
  }
  throw new HttpError(404, 'Not found.');
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map(x => x.trim());
    if (origin && !allowed.includes(origin)) return json({ error: 'Origin not allowed.' }, 403);
    let response;
    try {
      response = request.method === 'OPTIONS' ? new Response(null, { status: 204 }) : await route(request, env);
    } catch (error) {
      if (!(error instanceof HttpError)) console.error(error);
      response = json({ error: error instanceof HttpError ? error.message : 'The certificate service is unavailable. Please try again.' }, error.status ?? 500);
    }
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    if (origin) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Vary', 'Origin');
    }
    headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return new Response(response.body, { status: response.status, headers });
  },
};
