import { certificateRequest } from '../lib/certificate-api';
import { batchLink, batchQrSvg } from '../lib/batch-links';
type Batch = { id: string; batch_number: string; product_name: string; certificate_name: string; published: number; updated_at: string };
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const login = el<HTMLFormElement>('login-form');
const form = el<HTMLFormElement>('batch-form');
const dialog = el<HTMLDialogElement>('batch-dialog');
const deletion = el<HTMLDialogElement>('delete-dialog');
let token = sessionStorage.getItem('batch-admin-token') || '';
let batches: Batch[] = [];
let deleteId = '';
let saving = false;
function showLogin() {
  token = ''; sessionStorage.removeItem('batch-admin-token'); batches = [];
  el('batch-rows').replaceChildren();
  el('login-panel').hidden = false; el('dashboard').hidden = true; el('sign-out').hidden = true;
  dialog.close(); deletion.close();
}
async function request(path: string, options?: RequestInit) {
  try { return await certificateRequest(path, options, token); }
  catch (error) { if ((error as { status?: number }).status === 401) showLogin(); throw error; }
}
function render() {
  const query = el<HTMLInputElement>('search').value.trim().toLowerCase();
  const filtered = batches.filter(row => `${row.batch_number} ${row.product_name}`.toLowerCase().includes(query));
  el('batch-count').textContent = `${batches.length} ${batches.length === 1 ? 'batch' : 'batches'} / ${batches.filter(row => row.published).length} published`;
  el('batch-rows').replaceChildren();
  el('empty-state').hidden = filtered.length > 0;
  el('empty-state').textContent = batches.length ? 'No batches match your search.' : 'No batches yet. Add your first batch certificate.';
  for (const batch of filtered) {
    const row = document.createElement('tr');
    for (const value of [batch.batch_number, batch.product_name, batch.certificate_name, batch.published ? 'Published' : 'Draft', new Date(batch.updated_at).toLocaleDateString('en-GB')]) {
      const td = document.createElement('td'); td.textContent = value; row.append(td);
    }
    const actions = document.createElement('td');
    const group = document.createElement('div'); group.className = 'flex flex-wrap gap-2 min-w-[280px]';
    for (const label of ['Edit', 'Delete']) {
      const button = document.createElement('button'); button.textContent = label;
      button.addEventListener('click', () => {
        if (label === 'Edit') openEditor(batch);
        else { deleteId = batch.id; el('delete-description').textContent = `Remove batch ${batch.batch_number} and its certificate? Customers will no longer be able to find it.`; el('delete-message').textContent = ''; deletion.showModal(); }
      }); group.append(button);
    }
    for (const action of ['Copy batch link', 'Download QR code']) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action;
      button.setAttribute('aria-label', `${action} for ${batch.batch_number}`);
      button.addEventListener('click', async () => {
        button.disabled = true;
        const url = batchLink(batch.batch_number);
        const draftNotice = batch.published ? '' : ' Publish this batch before using the link on labels.';
        try {
          if (action === 'Copy batch link') {
            try {
              await navigator.clipboard.writeText(url);
            } catch {
              el('dashboard-message').textContent = `Copy this batch link: ${url}${draftNotice}`;
              return;
            }
            el('dashboard-message').textContent = `Batch link copied for ${batch.batch_number}.${draftNotice}`;
          } else {
            const svg = await batchQrSvg(batch.batch_number);
            const objectUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = `liva-${batch.batch_number.replace(/[^a-z0-9-]/gi, '-')}-qr.svg`;
            document.body.append(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
            el('dashboard-message').textContent = `QR code downloaded for ${batch.batch_number}.${draftNotice}`;
          }
        } catch {
          el('dashboard-message').textContent = `Unable to download the QR code. Please try again.`;
        } finally {
          button.disabled = false;
        }
      });
      group.append(button);
    }
    actions.append(group); row.append(actions); el('batch-rows').append(row);
  }
}
async function load() {
  batches = await request('/admin/batches');
  el('login-panel').hidden = true; el('dashboard').hidden = false; el('sign-out').hidden = false;
  render();
}
function openEditor(batch?: Batch) {
  form.reset();
  (form.elements.namedItem('id') as HTMLInputElement).value = batch?.id ?? '';
  el<HTMLInputElement>('edit-number').value = batch?.batch_number ?? '';
  el<HTMLInputElement>('edit-product').value = batch?.product_name ?? 'LIVA Organic Extra Virgin Olive Oil';
  (form.elements.namedItem('published') as HTMLInputElement).checked = !!batch?.published;
  el<HTMLInputElement>('edit-file').required = !batch;
  el('current-file').textContent = batch ? `Current: ${batch.certificate_name}. Leave unchanged to keep this file.` : '';
  el('editor-title').textContent = batch ? 'Edit batch' : 'Add batch';
  el('editor-message').textContent = ''; dialog.showModal();
}
login.addEventListener('submit', async event => {
  event.preventDefault(); const button = login.querySelector('button')!; button.disabled = true;
  el('login-message').textContent = 'Signing in...';
  try {
    const data = await certificateRequest('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: el<HTMLInputElement>('password').value }) });
    token = data.token; sessionStorage.setItem('batch-admin-token', token); login.reset(); await load(); el('login-message').textContent = '';
  } catch (error) { el('login-message').textContent = (error as Error).message; }
  finally { button.disabled = false; }
});
el('sign-out').addEventListener('click', showLogin);
el('new-batch').addEventListener('click', () => openEditor());
el('search').addEventListener('input', render);
el('cancel-edit').addEventListener('click', () => { if (!saving) dialog.close(); });
dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
form.addEventListener('submit', async event => {
  event.preventDefault(); const button = form.querySelector<HTMLButtonElement>('[type=submit]')!;
  const file = el<HTMLInputElement>('edit-file').files?.[0];
  if (file && file.size > 10 * 1024 * 1024) { el('editor-message').textContent = 'Certificate must be smaller than 10 MB.'; return; }
  saving = true; button.disabled = true; el('editor-message').textContent = 'Saving batch...';
  const data = new FormData(form); data.set('published', String((form.elements.namedItem('published') as HTMLInputElement).checked));
  try { await request('/admin/batches', { method: 'POST', body: data }); dialog.close(); await load(); el('dashboard-message').textContent = 'Batch saved.'; }
  catch (error) { el(dialog.open ? 'editor-message' : 'login-message').textContent = (error as Error).message; }
  finally { saving = false; button.disabled = false; }
});
el('cancel-delete').addEventListener('click', () => deletion.close());
el('confirm-delete').addEventListener('click', async () => {
  const button = el<HTMLButtonElement>('confirm-delete'); button.disabled = true;
  try { await request(`/admin/batches?id=${encodeURIComponent(deleteId)}`, { method: 'DELETE' }); deletion.close(); await load(); el('dashboard-message').textContent = 'Batch deleted.'; }
  catch (error) { el(deletion.open ? 'delete-message' : 'login-message').textContent = (error as Error).message; }
  finally { button.disabled = false; }
});
if (token) load().catch(error => { showLogin(); el('login-message').textContent = error.message; });
