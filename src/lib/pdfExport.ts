import { safeDownloadBlob } from './download';
import { getOrgConfig, DEFAULT_KETUA_FALLBACK } from './orgConfig';

let cachedHtml2Pdf: any = null;

/**
 * Deteksi apakah perangkat pengguna adalah ponsel / tablet.
 * Di PC tetap memakai jendela pratinjau cetak browser; di ponsel langsung mengunduh file PDF.
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/**
 * Memuat html2pdf.js dari bundle lokal (lazy-loaded chunk, 100% offline-ready PWA tanpa CDN eksternal).
 */
export async function loadHtml2Pdf(): Promise<any> {
  if (cachedHtml2Pdf) return cachedHtml2Pdf;
  const mod = await import('html2pdf.js');
  cachedHtml2Pdf = (mod as any).default || mod;
  return cachedHtml2Pdf;
}

/**
 * Escape karakter HTML berbahaya agar teks dinamis aman dirender pada template cetak/PDF.
 */
export function escapePdfHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface KetuaSignerInfo {
  name: string;
  npa: string;
  npaLabel: string;
  nip: string;
  jabatan: string;
}

const DEFAULT_KETUA_NAME = DEFAULT_KETUA_FALLBACK.name;
const DEFAULT_KETUA_NPA = '13301500431';
const DEFAULT_KETUA_NIP = DEFAULT_KETUA_FALLBACK.nip;

/**
 * Membaca nama dan NPA Ketua PGRI Ranting secara dinamis dari Pengaturan Kepengurusan,
 * konfigurasi organisasi, penyimpanan NPA, dan daftar anggota.
 */
export function resolveKetuaSigner(
  teachers?: Array<{ name?: string; nip?: string; npa?: string }>
): KetuaSignerInfo {
  let name = DEFAULT_KETUA_NAME;
  let nip = DEFAULT_KETUA_NIP;
  let npa = '';
  let jabatan = 'Ketua PGRI Ranting Gelang';

  try {
    const orgCfg = getOrgConfig() as any;
    if (orgCfg?.kopRanting) {
      const rantingClean = String(orgCfg.kopRanting).trim();
      if (rantingClean) {
        const titleCaseRanting = rantingClean
          .toLowerCase()
          .replace(/\b\w/g, (ch) => ch.toUpperCase());
        jabatan = `Ketua PGRI ${titleCaseRanting}`;
      }
    }
    if (typeof orgCfg?.ketuaNpa === 'string' && orgCfg.ketuaNpa.trim()) {
      npa = orgCfg.ketuaNpa.trim();
    }
  } catch {}

  try {
    if (typeof window !== 'undefined') {
      const savedPengurus = localStorage.getItem('kombel-pengurus');
      if (savedPengurus) {
        const parsed = JSON.parse(savedPengurus);
        if (Array.isArray(parsed)) {
          const ketua =
            parsed.find(
              (p: any) =>
                p?.role &&
                p.role.toLowerCase().includes('ketua') &&
                !p.role.toLowerCase().includes('wakil')
            ) || parsed.find((p: any) => p?.role && p.role.toLowerCase().includes('ketua'));
          if (ketua) {
            if (typeof ketua.name === 'string' && ketua.name.trim() && ketua.name.trim() !== '-') {
              name = ketua.name.trim();
            }
            if (typeof ketua.nip === 'string' && ketua.nip.trim() && ketua.nip.trim() !== '-') {
              nip = ketua.nip.trim();
            }
            if (typeof ketua.npa === 'string' && ketua.npa.trim() && ketua.npa.trim() !== '-') {
              npa = ketua.npa.trim();
            }
          }
        }
      }

      if (!npa) {
        const rawUndanganNpa = localStorage.getItem('kombel-undangan-npa');
        if (rawUndanganNpa) {
          try {
            const parsedNpa = JSON.parse(rawUndanganNpa);
            if (typeof parsedNpa === 'string' && parsedNpa.trim()) {
              npa = parsedNpa.trim();
            } else if (parsedNpa && typeof parsedNpa === 'object') {
              const candidate = parsedNpa.ketua || parsedNpa.ketuaNpa || parsedNpa.npa;
              if (typeof candidate === 'string' && candidate.trim()) {
                npa = candidate.trim();
              }
            }
          } catch {
            if (rawUndanganNpa.trim()) {
              npa = rawUndanganNpa.trim();
            }
          }
        }
      }

      if (!npa) {
        const legacyKetuaNpa = localStorage.getItem('pgri-ketua-npa');
        if (legacyKetuaNpa && legacyKetuaNpa.trim()) {
          npa = legacyKetuaNpa.trim();
        }
      }
    }
  } catch {}

  if (!npa && Array.isArray(teachers) && teachers.length > 0) {
    const cleanTarget = name.toLowerCase().split(',')[0].trim();
    const matched = teachers.find((t) => {
      const tName = (t?.name || '').toLowerCase().split(',')[0].trim();
      return tName && cleanTarget && (tName === cleanTarget || tName.includes(cleanTarget) || cleanTarget.includes(tName));
    });
    if (matched?.npa && String(matched.npa).trim() && String(matched.npa).trim() !== '-') {
      npa = String(matched.npa).trim();
    }
  }

  const finalNpa = (npa || DEFAULT_KETUA_NPA).replace(/^NPA\.?\s*/i, '').trim() || DEFAULT_KETUA_NPA;
  return {
    name,
    npa: finalNpa,
    npaLabel: `NPA. ${finalNpa}`,
    nip,
    jabatan
  };
}

export interface PdfRenderOptions {
  filename: string;
  orientation?: 'portrait' | 'landscape';
  format?: string | [number, number];
  margin?: number | [number, number, number, number];
  quality?: number;
  scale?: number;
  pagebreak?: Record<string, any>;
}

/**
 * Mengonversi elemen HTML (unattached container dengan style `data-pdf-style="true"`)
 * menjadi PDF Blob non-kosong yang aman di mobile/Tailwind v4 lalu langsung mengunduhnya.
 */
export async function downloadContainerAsPdf(
  container: HTMLElement,
  options: PdfRenderOptions
): Promise<void> {
  const html2pdf = await loadHtml2Pdf();
  const opt: Record<string, any> = {
    margin: options.margin ?? [10, 12, 10, 12],
    filename: options.filename,
    image: { type: 'jpeg', quality: options.quality ?? 0.98 },
    html2canvas: {
      scale: options.scale ?? 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      scrollX: 0,
      scrollY: 0,
      onclone: (clonedDoc: Document) => {
        clonedDoc
          .querySelectorAll('style:not([data-pdf-style="true"]), link[rel="stylesheet"]')
          .forEach((el) => el.remove());
      }
    },
    jsPDF: {
      unit: 'mm',
      format: options.format ?? 'a4',
      orientation: options.orientation ?? 'portrait'
    }
  };
  if (options.pagebreak) {
    opt.pagebreak = options.pagebreak;
  }

  const pdfBlob = await html2pdf().set(opt).from(container).outputPdf('blob');
  await safeDownloadBlob(pdfBlob, options.filename);
}

/**
 * Menangani ekspor dokumen HTML penuh (misalnya Surat Tugas, Pengawas Ujian, Notulen, Buku Agenda):
 * - Di PC: membuka jendela cetak bawaan browser (Save as PDF / Print)
 * - Di Ponsel (atau jika pop-up diblokir): mengonversi HTML menjadi file PDF langsung dan mengunduhnya.
 */
export async function exportFullHtmlToPdfOrPrint(
  fullHtml: string,
  options: {
    filename: string;
    orientation?: 'portrait' | 'landscape';
    widthPx?: number;
    margin?: [number, number, number, number];
  }
): Promise<void> {
  const orientation = options.orientation ?? 'portrait';
  const mobile = isMobileDevice();

  if (!mobile) {
    const printWin = window.open('', '_blank', 'width=960,height=780');
    if (printWin) {
      const printableHtml = fullHtml.includes('window.print()')
        ? fullHtml
        : fullHtml.replace(
            '</body>',
            `<script>window.onload = function() { setTimeout(function() { window.print(); }, 200); };</script></body>`
          );
      printWin.document.write(printableHtml);
      printWin.document.close();
      return;
    }
  }

  let container: HTMLDivElement | null = null;
  try {
    const parser = new DOMParser();
    const parsedDoc = parser.parseFromString(fullHtml, 'text/html');
    const styleTexts = Array.from(parsedDoc.querySelectorAll('style'))
      .map((s) => s.textContent || '')
      .join('\n');

    // Hapus script agar tidak tereksekusi ulang saat dimasukkan ke container
    parsedDoc.querySelectorAll('script').forEach((s) => s.remove());

    // Normalisasi style halaman agar pas di kanvas html2canvas tanpa padding/background abu-abu
    const sanitizedStyle = styleTexts
      .replace(/body\s*\{/gi, '.pdf-doc-root {')
      .replace(/min-height\s*:\s*297mm\s*;?/gi, 'min-height: auto;')
      .replace(/background\s*:\s*#e5e7eb\s*;?/gi, 'background: #ffffff;');

    container = document.createElement('div');
    container.style.width = `${options.widthPx ?? (orientation === 'landscape' ? 1050 : 794)}px`;
    container.style.backgroundColor = '#ffffff';
    container.style.color = '#000000';
    container.style.padding = '0';
    container.style.margin = '0';

    container.innerHTML = `
      <style data-pdf-style="true">
        ${sanitizedStyle}
        .pdf-doc-root { background: #ffffff !important; padding: 0 !important; margin: 0 !important; }
        .sheet-a4 { width: 100% !important; min-height: auto !important; margin: 0 !important; box-shadow: none !important; padding: 6mm 8mm !important; }
      </style>
      <div class="pdf-doc-root">
        ${parsedDoc.body ? parsedDoc.body.innerHTML : fullHtml}
      </div>
    `;

    await downloadContainerAsPdf(container, {
      filename: options.filename.endsWith('.pdf') ? options.filename : `${options.filename}.pdf`,
      orientation,
      margin: options.margin ?? [6, 6, 6, 6],
      quality: 0.96,
      scale: 2
    });
  } catch (err) {
    console.error('Gagal membuat PDF langsung, fallback ke HTML:', err);
    const fallbackName = options.filename.replace(/\.pdf$/i, '.html');
    const htmlBlob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
    await safeDownloadBlob(htmlBlob, fallbackName);
  } finally {
    if (container && document.body.contains(container)) {
      document.body.removeChild(container);
    }
  }
}
