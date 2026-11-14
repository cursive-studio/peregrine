export function certificateFormat(bytes) {
  const starts = (signature) => signature.every((value, index) => bytes[index] === value);
  const text = (start, end) => new TextDecoder().decode(bytes.slice(start, end));
  if (text(0, 5) === '%PDF-') return { type: 'application/pdf', extension: 'pdf' };
  if (starts([0xff, 0xd8, 0xff])) return { type: 'image/jpeg', extension: 'jpg' };
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { type: 'image/png', extension: 'png' };
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return { type: 'image/webp', extension: 'webp' };
  if (['GIF87a', 'GIF89a'].includes(text(0, 6))) return { type: 'image/gif', extension: 'gif' };
  return null;
}

export const certificateTypes = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
