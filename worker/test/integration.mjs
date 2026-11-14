import assert from 'node:assert/strict';

// Run against local Wrangler, never against the production Worker.
const base = 'http://localhost:8787';
assert.ok(process.env.TEST_ADMIN_PASSWORD, 'Set TEST_ADMIN_PASSWORD to your local Worker password.');
let token;
async function call(path, options = {}, expected = 200) {
  const response = await fetch(base + path, { ...options, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
  assert.equal(response.status, expected, `${path}: ${await response.clone().text()}`);
  return response;
}
const pdf = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF';
const number = `TEST-${Date.now()}`;
const makeForm = (id = '', published = false, content = pdf, name = 'certificate.pdf', type = 'application/pdf') => {
  const form = new FormData();
  form.set('id', id); form.set('batch_number', number.toLowerCase());
  form.set('product_name', 'LIVA test certificate'); form.set('published', String(published));
  if (content) form.set('certificate', new File([content], name, { type }));
  return form;
};
await call('/admin/batches', {}, 401);
await call('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }) }, 401);
token = (await (await call('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: process.env.TEST_ADMIN_PASSWORD }) })).json()).token;
let id;
try {
  await call('/admin/batches', { method: 'POST', body: makeForm('', false, 'not a pdf') }, 400);
  id = (await (await call('/admin/batches', { method: 'POST', body: makeForm() }, 201)).json()).id;
  await call(`/lookup?batch=${number}`, {}, 404);
  await call(`/certificate?batch=${number}`, {}, 404);
  await call('/admin/batches', { method: 'POST', body: makeForm() }, 409);
  await call('/admin/batches', { method: 'POST', body: makeForm(id, true, '') }, 201);
  assert.equal((await (await call(`/lookup?batch=${number.toLowerCase()}`)).json()).batch_number, number);
  assert.equal(await (await call(`/certificate?batch=${number}`)).text(), pdf);
  await call('/admin/batches', { method: 'POST', body: makeForm(id, true, pdf + '\n% replacement') }, 201);
  assert.match(await (await call(`/certificate?batch=${number}`)).text(), /replacement/);
  const formats = [
    ['png', 'image/png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64')],
    ['jpg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9])],
    ['gif', 'image/gif', Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')],
    ['webp', 'image/webp', Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64')],
  ];
  for (const [extension, type, bytes] of formats) {
    // Deliberately supply the wrong extension/MIME: delivery must follow the contents.
    await call('/admin/batches', { method: 'POST', body: makeForm(id, true, bytes, 'misnamed.pdf', 'application/pdf') }, 201);
    const response = await call(`/certificate?batch=${number}`);
    assert.equal(response.headers.get('Content-Type'), type);
    assert.match(response.headers.get('Content-Disposition'), new RegExp(`\\.${extension}"$`));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  }
  await call('/admin/batches', { method: 'POST', body: makeForm(id, true, '<svg onload="alert(1)"></svg>', 'fake.png', 'image/png') }, 400);
  await call('/admin/batches', { method: 'POST', body: makeForm(id, false, '') }, 201);
  await call(`/lookup?batch=${number}`, {}, 404);
  await call('/admin/batches', { headers: { Origin: 'https://untrusted.example' } }, 403);
  await call('/lookup?batch=%3Cscript%3E', {}, 400);
  await call('/admin/batches', { headers: { Authorization: 'Bearer forged' } }, 401);
} finally {
  if (id) await call(`/admin/batches?id=${id}`, { method: 'DELETE' });
}
await call(`/lookup?batch=${number}`, {}, 404);
console.log('Passed: authentication, invalid files, draft privacy, duplicate protection, normalized lookup, PDF/image downloads and replacement, detected content types, unpublish, origin restrictions, token rejection, deletion.');
