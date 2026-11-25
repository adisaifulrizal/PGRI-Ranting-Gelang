import QRCode from 'qrcode';

/**
 * Menghasilkan QR Code lokal (100% offline, tanpa server pihak ketiga) secara sinkron
 * dalam format Data URL SVG yang tajam untuk <img>, pratinjau cetak browser, dan PDF.
 */
export function generateQrSvgDataUrl(text: string, size: number = 240, margin: number = 2): string {
  try {
    const safeText = (text || '-').trim() || '-';
    const qr = QRCode.create(safeText, { errorCorrectionLevel: 'M' });
    const count = qr.modules.size;
    const total = count + margin * 2;

    const rects: string[] = [];
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.modules.get(r, c)) {
          rects.push(`M${c + margin},${r + margin}h1v1h-1z`);
        }
      }
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#ffffff"/><path d="${rects.join('')}" fill="#000000"/></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  } catch {
    return '';
  }
}

/**
 * Menghasilkan QR Code lokal dalam format Data URL PNG (Base64) untuk ekspor PNG / E-KTA / ZIP.
 */
export async function generateQrPngDataUrl(text: string, width: number = 600): Promise<string> {
  const safeText = (text || '-').trim() || '-';
  return QRCode.toDataURL(safeText, {
    width,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#000000',
      light: '#ffffff'
    }
  });
}

/**
 * Mengonversi QR Code lokal langsung menjadi Blob image/png tanpa request jaringan.
 */
export async function generateQrPngBlob(text: string, width: number = 600): Promise<Blob> {
  const dataUrl = await generateQrPngDataUrl(text, width);
  const base64 = dataUrl.split(',')[1] || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: 'image/png' });
}
