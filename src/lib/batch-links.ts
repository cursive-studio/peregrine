// Always encode the permanent production address, including on preview deployments.
export function batchLink(batchNumber: string): string {
  const url = new URL('https://www.peregrinecreativegroup.com/liva/trace');
  url.searchParams.set('batch', batchNumber.trim().toUpperCase());
  return url.href;
}

export async function batchQrSvg(batchNumber: string): Promise<string> {
  const { default: QRCode } = await import('qrcode');
  return QRCode.toString(batchLink(batchNumber), {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 4,
    width: 1024,
    color: { dark: '#000000', light: '#ffffff' },
  });
}
