export const apiBase = (import.meta.env.PUBLIC_CERTIFICATES_API_URL || (import.meta.env.DEV ? 'http://localhost:8787' : '')).replace(/\/$/, '');

export async function certificateRequest(path: string, options: RequestInit = {}, token?: string) {
  if (!apiBase) throw new Error('The certificate service is not connected yet. Please contact Peregrine.');
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response: Response;
  try { response = await fetch(`${apiBase}${path}`, { ...options, headers }); }
  catch { throw new Error('Unable to connect. Check your connection and try again.'); }
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed. Please try again.');
    Object.assign(error, { status: response.status });
    throw error;
  }
  return data;
}
