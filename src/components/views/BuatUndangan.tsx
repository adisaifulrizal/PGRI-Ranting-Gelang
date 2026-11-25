import React, { useState, useEffect, useMemo } from 'react';
import {
  FileText,
  Download,
  Eye,
  Plus,
  Trash2,
  Users,
  RefreshCw,
  Save,
  Copy,
  Edit3,
  Printer,
  Lock,
  Search,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Share2,
  FileCheck2,
  BookOpen,
  ClipboardList,
  Hash,
  ExternalLink,
  Calendar,
  MapPin,
  ShieldCheck,
  X,
  Inbox,
  Send,
  Clock
} from 'lucide-react';
import { doc, getDoc, getDocFromServer } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';
import {
  mutateCloudCollection,
  syncFromFirebase,
  savePerDocItem,
  deletePerDocItem,
  syncSettingsToCloud,
  fetchCloudVersions,
  shouldFetchByVersion,
  markLocalVersionSynced
} from '../../lib/sync';
import { logAuditEvent } from '../../lib/auth';
import { ActivityEvent, AttendanceRecord, NotulenItem, SuratAgendaItem, Teacher } from '../../types';
import {
  getOrgConfig,
  openWhatsAppShare,
  DEFAULT_KETUA_FALLBACK,
  DEFAULT_SEKRETARIS_FALLBACK
} from '../../lib/orgConfig';
import { isMobileDevice, downloadContainerAsPdf, exportFullHtmlToPdfOrPrint } from '../../lib/pdfExport';
import { generateQrSvgDataUrl } from '../../lib/qrGenerator';

interface BuatUndanganProps {
  activeRole?: 'guru' | 'admin';
  teachers?: Teacher[];
  events?: ActivityEvent[];
  attendanceList?: AttendanceRecord[];
  theme?: 'light' | 'dark';
}

export interface InvitationParticipant {
  id: string;
  name: string;
  school: string;
  teacherId?: string;
}

export interface InvitationData {
  id: string;
  title: string; // Judul internal arsip
  updatedAt: string;
  // Kop Surat
  kopOrganisasi: string;
  kopSubOrganisasi: string;
  kopRanting: string;
  kopWilayah: string;
  kopSekretariat: string;
  // Metadata Surat
  nomorSurat: string;
  lampiranText: string;
  perihal: string;
  tanggalSurat: string;
  kepadaList: string[];
  diTempat: string;
  // Isi Surat
  salamPembuka: string;
  paragrafPembuka: string;
  hari: string;
  tanggalAcara: string;
  pukul: string;
  tempatAcara: string;
  acara: string;
  paragrafPenutup: string;
  salamPenutup: string;
  // Penandatangan
  ketuaJabatan: string;
  ketuaSubJabatan: string;
  ketuaNama: string;
  ketuaNpa: string;
  sekretarisJabatan: string;
  sekretarisSubJabatan: string;
  sekretarisNama: string;
  sekretarisNpa: string;
  // Tembusan
  tembusanHeader: string;
  tembusanList: string[];
  // Opsi Visual
  showStempel: boolean;
  showTtdImages: boolean;
  // Halaman 2 Lampiran
  includeLampiran: boolean;
  lampiranJudul1: string;
  lampiranJudul2: string;
  kolomKiriLabel: string;
  kolomKananLabel: string;
  subKolom1Label: string;
  subKolom2Label: string;
  timPutra: InvitationParticipant[];
  timPutri: InvitationParticipant[];
  lampiranTanggal: string;
  lampiranPenandatanganJabatan: string;
  // Tipe & Data Khusus Arsip Surat Tugas / Pengawas Ujian
  docCategory?: 'undangan' | 'surat_tugas' | 'pengawas_ujian';
  stSelectedIds?: string[];
  stManualNama?: string;
  puRows?: PengawasUjianRow[];
  puWaktu?: string;
}

interface OrgAssets {
  logoPgri: string | null;
  ttdKetua: string | null;
  ttdKetuaSize: number;
  ttdSekretaris: string | null;
  ttdSekretarisSize: number;
  logoStempel: string | null;
  stempelRotation: number;
  stempelSize: number;
}

const DEFAULT_KETUA_NAMA = DEFAULT_KETUA_FALLBACK.name.toUpperCase();
const DEFAULT_KETUA_NPA = '13301500431';
const DEFAULT_SEKRETARIS_NAMA = DEFAULT_SEKRETARIS_FALLBACK.name.replace(/^([^,]+)/, (m) => m.toUpperCase());
const DEFAULT_SEKRETARIS_NPA = '13301500081';

const NPA_STORAGE_KEY = 'kombel-undangan-npa';
const INVITATIONS_STORAGE_KEY = 'kombel-invitations';

const loadSavedNpa = (): { ketuaNpa: string; sekretarisNpa: string } => {
  try {
    const raw = localStorage.getItem(NPA_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ketuaNpa: parsed.ketuaNpa || DEFAULT_KETUA_NPA,
        sekretarisNpa: parsed.sekretarisNpa || DEFAULT_SEKRETARIS_NPA
      };
    }
  } catch {}
  return {
    ketuaNpa: DEFAULT_KETUA_NPA,
    sekretarisNpa: DEFAULT_SEKRETARIS_NPA
  };
};

const readSignersFromKepengurusan = (): {
  ketuaNama: string;
  sekretarisNama: string;
} => {
  let ketuaNama = DEFAULT_KETUA_NAMA;
  let sekretarisNama = DEFAULT_SEKRETARIS_NAMA;
  try {
    const raw = localStorage.getItem('kombel-pengurus');
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        const ketuaObj = list.find((p: any) => {
          const r = String(p?.role || '').toLowerCase();
          return r.includes('ketua') && !r.includes('wakil');
        });
        const sekObj = list.find((p: any) => {
          const r = String(p?.role || '').toLowerCase();
          return r.includes('sekretaris');
        });
        if (ketuaObj?.name && ketuaObj.name !== '-') {
          ketuaNama = String(ketuaObj.name).toUpperCase();
        }
        if (sekObj?.name && sekObj.name !== '-') {
          sekretarisNama = String(sekObj.name).toUpperCase();
        }
      }
    }
  } catch {}
  return { ketuaNama, sekretarisNama };
};

const resolveSignerNpasFromData = (
  ketuaNama: string,
  sekretarisNama: string
): { ketuaNpa: string; sekretarisNpa: string } => {
  const saved = loadSavedNpa();
  let ketuaNpa = saved.ketuaNpa;
  let sekretarisNpa = saved.sekretarisNpa;
  try {
    let teachersList: any[] = [];
    const rawTeachers = localStorage.getItem('kombel-teachers');
    if (rawTeachers) {
      const parsedT = JSON.parse(rawTeachers);
      if (Array.isArray(parsedT)) teachersList = parsedT;
    }
    const findNpa = (name: string): string => {
      const norm = (name || '').trim().toLowerCase();
      if (!norm) return '';
      const match = teachersList.find(
        (t: any) => String(t?.name || '').trim().toLowerCase() === norm
      );
      return match && match.npa ? String(match.npa).trim() : '';
    };
    const rawPengurus = localStorage.getItem('kombel-pengurus');
    if (rawPengurus) {
      const list = JSON.parse(rawPengurus);
      if (Array.isArray(list)) {
        const kObj = list.find((p: any) => {
          const r = String(p?.role || '').toLowerCase();
          return r.includes('ketua') && !r.includes('wakil');
        });
        if (kObj) {
          const foundK = (kObj.npa ? String(kObj.npa).trim() : '') || findNpa(kObj.name || ketuaNama);
          if (foundK) ketuaNpa = foundK;
        }
        const sObj = list.find((p: any) =>
          String(p?.role || '').toLowerCase().includes('sekretaris')
        );
        if (sObj) {
          const foundS = (sObj.npa ? String(sObj.npa).trim() : '') || findNpa(sObj.name || sekretarisNama);
          if (foundS) sekretarisNpa = foundS;
        }
      }
    }
  } catch {}
  return { ketuaNpa, sekretarisNpa };
};

const resolveEOfficeSigners = (): {
  namaKetua: string;
  npaKetua: string;
  namaSekretaris: string;
  npaSekretaris: string;
} => {
  const savedNpa = loadSavedNpa();
  let namaKetua = DEFAULT_KETUA_FALLBACK.name;
  let npaKetua = savedNpa.ketuaNpa || DEFAULT_KETUA_NPA;
  let namaSekretaris = DEFAULT_SEKRETARIS_FALLBACK.name;
  let npaSekretaris = savedNpa.sekretarisNpa || DEFAULT_SEKRETARIS_NPA;

  try {
    let teachersList: any[] = [];
    try {
      const rawTeachers = localStorage.getItem('kombel-teachers');
      if (rawTeachers) {
        const parsedT = JSON.parse(rawTeachers);
        if (Array.isArray(parsedT)) teachersList = parsedT;
      }
    } catch {}

    const findTeacherNpa = (personName: string): string => {
      const norm = (personName || '').trim().toLowerCase();
      if (!norm) return '';
      const match = teachersList.find((t: any) => String(t?.name || '').trim().toLowerCase() === norm);
      return match && match.npa ? String(match.npa).trim() : '';
    };

    const rawPengurus = localStorage.getItem('kombel-pengurus');
    if (rawPengurus) {
      const list = JSON.parse(rawPengurus);
      if (Array.isArray(list)) {
        const ketuaObj = list.find((p: any) => {
          const r = String(p?.role || '').toLowerCase();
          return r.includes('ketua') && !r.includes('wakil');
        });
        if (ketuaObj?.name && ketuaObj.name !== '-') {
          const resolvedName = String(ketuaObj.name).trim();
          namaKetua = resolvedName;
          const explicitNpa =
            (ketuaObj.npa ? String(ketuaObj.npa).trim() : '') || findTeacherNpa(resolvedName);
          if (explicitNpa) {
            npaKetua = explicitNpa;
          } else if (!resolvedName.toLowerCase().includes('umar ali kusuma')) {
            npaKetua = ketuaObj.nip && ketuaObj.nip !== '-' ? String(ketuaObj.nip).trim() : '-';
          }
        }

        const sekObj = list.find((p: any) => {
          const r = String(p?.role || '').toLowerCase();
          return r.includes('sekretaris');
        });
        if (sekObj?.name && sekObj.name !== '-') {
          const resolvedName = String(sekObj.name).trim();
          namaSekretaris = resolvedName;
          const explicitNpa =
            (sekObj.npa ? String(sekObj.npa).trim() : '') || findTeacherNpa(resolvedName);
          if (explicitNpa) {
            npaSekretaris = explicitNpa;
          } else if (!resolvedName.toLowerCase().includes('adi saiful rizal')) {
            npaSekretaris = sekObj.nip && sekObj.nip !== '-' ? String(sekObj.nip).trim() : '-';
          }
        }
      }
    }
  } catch {}

  return { namaKetua, npaKetua, namaSekretaris, npaSekretaris };
};

const readAssetsFromSettings = (): OrgAssets => {
  const safeNum = (key: string, def: number) => {
    try {
      const v = localStorage.getItem(key);
      if (v !== null) {
        const n = Number(v);
        if (!isNaN(n)) return n;
      }
    } catch {}
    return def;
  };
  return {
    logoPgri:
      typeof window !== 'undefined'
        ? localStorage.getItem('logo-pgri') || localStorage.getItem('logo-kombel')
        : null,
    ttdKetua: typeof window !== 'undefined' ? localStorage.getItem('ttd-ketua') : null,
    ttdKetuaSize: safeNum('ttd-ketua-size', 100),
    ttdSekretaris: typeof window !== 'undefined' ? localStorage.getItem('ttd-sekretaris') : null,
    ttdSekretarisSize: safeNum('ttd-sekretaris-size', 100),
    logoStempel: typeof window !== 'undefined' ? localStorage.getItem('logo-stempel') : null,
    stempelRotation: safeNum('logo-stempel-rotation', 0),
    stempelSize: safeNum('logo-stempel-size', 100)
  };
};

const createInitialDraft = (teachers: Teacher[] = []): InvitationData => {
  const signers = readSignersFromKepengurusan();
  const savedNpa = loadSavedNpa();

  const maleDefaults: InvitationParticipant[] = teachers
    .filter((t) => t.gender === 'L')
    .slice(0, 11)
    .map((t) => ({
      id: `p-${t.id}`,
      teacherId: t.id,
      name: t.name,
      school: t.school
    }));

  const femaleDefaults: InvitationParticipant[] = teachers
    .filter((t) => t.gender === 'P')
    .slice(0, 8)
    .map((t) => ({
      id: `w-${t.id}`,
      teacherId: t.id,
      name: t.name,
      school: t.school
    }));

  const todayFormatted = new Date().toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  const orgCfg = getOrgConfig();
  return {
    id: `inv-${Date.now()}`,
    title: 'Undangan Kegiatan PGRI Ranting Gelang',
    updatedAt: new Date().toISOString(),
    kopOrganisasi: orgCfg.kopOrganisasi || 'PERSATUAN GURU REPUBLIK INDONESIA',
    kopSubOrganisasi: '(Teachers Association Of Republic Indonesia)',
    kopRanting: orgCfg.kopRanting || 'RANTING GELANG',
    kopWilayah: orgCfg.kopWilayah || 'KECAMATAN SUMBERBARU - KABUPATEN JEMBER',
    kopSekretariat: orgCfg.kopSekretariat || 'Sekretariat : Jl. PTPN XII Gunung Gambir Desa Gelang, Kecamatan Sumberbaru - Kabupaten Jember 68156',
    nomorSurat: buildAutoLetterNumber('Und', 0),
    lampiranText: '-',
    perihal: 'Undangan',
    tanggalSurat: `Sumberbaru, ${todayFormatted}`,
    kepadaList: [
      'Kepala SD Negeri / Swasta',
      'Pengurus PGRI Ranting Gelang',
      'Anggota PGRI Ranting Gelang'
    ],
    diTempat: 'di Tempat',
    salamPembuka: 'Assalamu’alaikum Wr. Wb.',
    paragrafPembuka:
      'Sehubungan dengan akan dilaksanakannya peringatan **Hari Guru Nasional (HGN) 2026** Kecamatan Sumberbaru, kami mengundang seluruh Kepala Sekolah, Pengurus PGRI Ranting, dan Anggota PGRI Ranting (data terlampir) untuk menghadiri dan memeriahkan kegiatan yang akan dilaksanakan pada :',
    hari: 'Selasa',
    tanggalAcara: todayFormatted,
    pukul: '07.00 WIB - Selesai',
    tempatAcara: 'SDN Rowotengah 03',
    acara: 'Membawa Laptop Full Baterai',
    paragrafPenutup:
      'Demikian undangan ini kami buat, atas perhatian serta kerjasamanya kami sampaikan terimakasih.',
    salamPenutup: 'Wassalamu’alaikum Wr. Wb.',
    ketuaJabatan: 'Ketua',
    ketuaSubJabatan: 'PGRI Ranting Gelang',
    ketuaNama: signers.ketuaNama,
    ketuaNpa: savedNpa.ketuaNpa,
    sekretarisJabatan: 'Sekretaris',
    sekretarisSubJabatan: 'PGRI Ranting Gelang',
    sekretarisNama: signers.sekretarisNama,
    sekretarisNpa: savedNpa.sekretarisNpa,
    tembusanHeader: 'Tembusan disampaikan kepada :',
    tembusanList: [
      'Pengawas Bina',
      'Ketua K3S Sumberbaru',
      'Ketua PGRI Cabang Sumberbaru',
      'Arsip'
    ],
    showStempel: true,
    showTtdImages: true,
    includeLampiran: false,
    lampiranJudul1: 'Pemain Bola Voli',
    lampiranJudul2: 'PGRI Ranting Gelang',
    kolomKiriLabel: 'Tim Putra',
    kolomKananLabel: 'Tim Putri',
    subKolom1Label: 'Nama',
    subKolom2Label: 'Lembaga',
    timPutra: maleDefaults,
    timPutri: femaleDefaults,
    lampiranTanggal: `Sumberbaru, ${todayFormatted}`,
    lampiranPenandatanganJabatan: 'Ketua PGRI Ranting Gelang'
  };
};

const escapeHtml = (unsafe: string): string => {
  return String(unsafe || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

// Mendukung format **teks tebal** dengan aman setelah HTML di-escape
const formatRichInlineText = (raw: string): string => {
  const escaped = escapeHtml(raw);
  return escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br />');
};

const buildKopSuratHtml = (data: InvitationData, assets: OrgAssets): string => {
  const logoHtml = assets.logoPgri
    ? `<img src="${assets.logoPgri}" alt="Logo PGRI" style="width: 92px; height: 92px; object-fit: contain; display: block;" />`
    : `<div style="width: 92px; height: 92px; border: 1.5px dashed #94a3b8; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9pt; color: #64748b; text-align: center;">Logo<br/>PGRI</div>`;

  return `
    <div style="display: flex; align-items: center; gap: 14px; padding-bottom: 6px; position: relative; z-index: 2;">
      <div style="width: 94px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;">
        ${logoHtml}
      </div>
      <div style="flex: 1; text-align: center; line-height: 1.18; color: #000000; padding-left: 8px;">
        <div style="font-size: 13pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.3px;">
          ${escapeHtml(data.kopOrganisasi)}
        </div>
        <div style="font-size: 10.5pt; font-weight: bold; font-style: italic; margin-top: 1px;">
          ${escapeHtml(data.kopSubOrganisasi)}
        </div>
        <div style="font-size: 16.5pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 1px;">
          ${escapeHtml(data.kopRanting)}
        </div>
        <div style="font-size: 12pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.3px; margin-top: 1px;">
          ${escapeHtml(data.kopWilayah)}
        </div>
        <div style="font-size: 8.5pt; font-style: italic; margin-top: 2px;">
          ${escapeHtml(data.kopSekretariat)}
        </div>
      </div>
    </div>
    <div style="border-top: 2px solid #000000; border-bottom: 1px solid #000000; height: 2px; margin-bottom: 18px; position: relative; z-index: 2;"></div>
  `;
};

const buildInvitationPdfHtml = (data: InvitationData, assets: OrgAssets): string => {

  const stempelScale = Math.max(0.3, Math.min(2.5, (assets.stempelSize || 100) / 100));
  const stempelImgStyle = `width: ${Math.round(112 * stempelScale)}px; height: ${Math.round(112 * stempelScale)}px; object-fit: contain; transform: rotate(${assets.stempelRotation || 0}deg); opacity: 0.92; mix-blend-mode: multiply; display: block;`;
  const ttdKetuaScale = Math.max(0.3, Math.min(2.5, (assets.ttdKetuaSize || 100) / 100));
  const ttdSekretarisScale = Math.max(0.3, Math.min(2.5, (assets.ttdSekretarisSize || 100) / 100));

  const kepadaLinesHtml = (data.kepadaList || [])
    .filter((line) => line.trim() !== '')
    .map((line, idx) => {
      if (idx === 0) {
        return `
          <div style="display: flex; align-items: flex-start;">
            <span style="width: 34px; flex-shrink: 0;">Yth.</span>
            <span>${escapeHtml(line)}</span>
          </div>
        `;
      }
      return `
        <div style="display: flex; align-items: flex-start;">
          <span style="width: 34px; flex-shrink: 0;"></span>
          <span>${escapeHtml(line)}</span>
        </div>
      `;
    })
    .join('');

  const tembusanItemsHtml = (data.tembusanList || [])
    .filter((item) => item.trim() !== '')
    .map((item, idx) => `<div>${idx + 1}. ${escapeHtml(item)}</div>`)
    .join('');

  const page1Html = `
    <div class="undangan-pdf-page" style="width: 210mm; height: 296mm; padding: 14mm 18mm 14mm 18mm; box-sizing: border-box; background-color: #ffffff; color: #000000; font-family: 'Times New Roman', Times, serif; font-size: 11pt; line-height: 1.45; position: relative; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between;">
      <div>
      ${buildKopSuratHtml(data, assets)}

      <!-- Metadata & Tujuan -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 22px; position: relative; z-index: 2;">
        <div style="flex: 1; min-width: 0;">
          <table style="border-collapse: collapse; width: 100%; font-size: 11pt; line-height: 1.5; color: #000000;">
            <tr>
              <td style="width: 78px; vertical-align: top; padding: 1px 0;">Nomor</td>
              <td style="width: 14px; vertical-align: top; padding: 1px 0;">:</td>
              <td style="vertical-align: top; padding: 1px 0;">${escapeHtml(data.nomorSurat)}</td>
            </tr>
            <tr>
              <td style="width: 78px; vertical-align: top; padding: 1px 0;">Lampiran</td>
              <td style="width: 14px; vertical-align: top; padding: 1px 0;">:</td>
              <td style="vertical-align: top; padding: 1px 0;">${escapeHtml(data.lampiranText)}</td>
            </tr>
            <tr>
              <td style="width: 78px; vertical-align: top; padding: 1px 0;">Perihal</td>
              <td style="width: 14px; vertical-align: top; padding: 1px 0;">:</td>
              <td style="vertical-align: top; padding: 1px 0;">${escapeHtml(data.perihal)}</td>
            </tr>
          </table>
        </div>

        <div style="width: fit-content; max-width: 50%; flex-shrink: 0; font-size: 11pt; line-height: 1.48; color: #000000;">
          <div style="margin-bottom: 12px;">${escapeHtml(data.tanggalSurat)}</div>
          <div>Kepada :</div>
          ${kepadaLinesHtml}
          <div style="display: flex; align-items: flex-start; margin-top: 2px;">
            <span style="width: 34px; flex-shrink: 0;"></span>
            <span style="text-decoration: underline;">${escapeHtml(data.diTempat)}</span>
          </div>
        </div>
      </div>

      <!-- Isi Surat -->
      <div style="position: relative; z-index: 2;">
        <div style="margin-bottom: 10px;">${escapeHtml(data.salamPembuka)}</div>

        <div style="text-align: justify; text-indent: 36px; margin-bottom: 14px; line-height: 1.55;">
          ${formatRichInlineText(data.paragrafPembuka)}
        </div>

        <table style="border-collapse: collapse; width: 100%; font-size: 11pt; line-height: 1.55; margin-bottom: 14px; color: #000000;">
          <tr>
            <td style="width: 92px; vertical-align: top; padding: 1px 0;">Hari</td>
            <td style="width: 16px; vertical-align: top; padding: 1px 0;">:</td>
            <td style="vertical-align: top; padding: 1px 0;">${escapeHtml(data.hari)}</td>
          </tr>
          <tr>
            <td style="width: 92px; vertical-align: top; padding: 1px 0;">Tanggal</td>
            <td style="width: 16px; vertical-align: top; padding: 1px 0;">:</td>
            <td style="vertical-align: top; padding: 1px 0;">${escapeHtml(data.tanggalAcara)}</td>
          </tr>
          <tr>
            <td style="width: 92px; vertical-align: top; padding: 1px 0;">Pukul</td>
            <td style="width: 16px; vertical-align: top; padding: 1px 0;">:</td>
            <td style="vertical-align: top; padding: 1px 0;">${escapeHtml(data.pukul)}</td>
          </tr>
          <tr>
            <td style="width: 92px; vertical-align: top; padding: 1px 0;">Tempat</td>
            <td style="width: 16px; vertical-align: top; padding: 1px 0;">:</td>
            <td style="vertical-align: top; padding: 1px 0;">${escapeHtml(data.tempatAcara)}</td>
          </tr>
          <tr>
            <td style="width: 92px; vertical-align: top; padding: 1px 0;">Catatan</td>
            <td style="width: 16px; vertical-align: top; padding: 1px 0;">:</td>
            <td style="vertical-align: top; padding: 1px 0;">${escapeHtml(data.acara)}</td>
          </tr>
        </table>

        <div style="text-align: justify; margin-bottom: 10px; line-height: 1.5;">
          ${formatRichInlineText(data.paragrafPenutup)}
        </div>

        <div style="margin-bottom: 24px;">${escapeHtml(data.salamPenutup)}</div>
      </div>

      <!-- Blok Tanda Tangan 3 Kolom (Ketua | Stempel | Sekretaris) -->
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 26px; position: relative; z-index: 2;">
        <div style="width: 36%; text-align: center; line-height: 1.35;">
          <div>${escapeHtml(data.ketuaJabatan)}</div>
          <div>${escapeHtml(data.ketuaSubJabatan)}</div>
          <div style="height: 66px; display: flex; align-items: center; justify-content: center; margin: 2px 0; overflow: visible;">
            ${
              data.showTtdImages && assets.ttdKetua
                ? `<img src="${assets.ttdKetua}" alt="TTD Ketua" style="height: ${Math.round(62 * ttdKetuaScale)}px; width: auto; max-width: ${Math.round(160 * ttdKetuaScale)}px; object-fit: contain;" />`
                : ''
            }
          </div>
          <div style="font-weight: bold; text-decoration: underline;">${escapeHtml(data.ketuaNama)}</div>
          <div>NPA. ${escapeHtml(data.ketuaNpa || '-')}</div>
        </div>

        <div style="width: 28%; display: flex; align-items: center; justify-content: center; overflow: visible;">
          ${
            data.showStempel && assets.logoStempel
              ? `<img src="${assets.logoStempel}" alt="Stempel Resmi" style="${stempelImgStyle}" />`
              : ''
          }
        </div>

        <div style="width: 36%; text-align: center; line-height: 1.35;">
          <div>${escapeHtml(data.sekretarisJabatan)}</div>
          <div>${escapeHtml(data.sekretarisSubJabatan)}</div>
          <div style="height: 66px; display: flex; align-items: center; justify-content: center; margin: 2px 0; overflow: visible;">
            ${
              data.showTtdImages && assets.ttdSekretaris
                ? `<img src="${assets.ttdSekretaris}" alt="TTD Sekretaris" style="height: ${Math.round(62 * ttdSekretarisScale)}px; width: auto; max-width: ${Math.round(160 * ttdSekretarisScale)}px; object-fit: contain;" />`
                : ''
            }
          </div>
          <div style="font-weight: bold; text-decoration: underline;">${escapeHtml(data.sekretarisNama)}</div>
          <div>NPA. ${escapeHtml(data.sekretarisNpa || '-')}</div>
        </div>
      </div>

      </div>

      <!-- Tembusan & QR Verifikasi Keaslian Surat -->
      <div style="display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; position: relative; z-index: 2;">
        ${
          tembusanItemsHtml
            ? `
          <div style="font-size: 10.5pt; line-height: 1.45; flex: 1;">
            <div style="margin-bottom: 4px;">${escapeHtml(data.tembusanHeader)}</div>
            ${tembusanItemsHtml}
          </div>
        `
            : '<div style="flex: 1;"></div>'
        }
        <div style="width: 96px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; font-size: 8.5pt; color: #334155; flex-shrink: 0;">
          <img
            src="${generateQrSvgDataUrl(`SURAT RESMI PGRI RANTING GELANG | No: ${data.nomorSurat} | Perihal: ${data.perihal} | Tgl: ${data.tanggalSurat}`, 140)}"
            alt="QR Verifikasi Surat"
            style="width: 58px; height: 58px; border: 1px solid #cbd5e1; padding: 3px; background: #fff; display: block; margin: 0 auto;"
          />
          <div style="margin-top: 4px; width: 100%; text-align: center; line-height: 1.2;">Verifikasi Surat</div>
        </div>
      </div>
    </div>
  `;

  return page1Html;
};

const AGENDA_STORAGE_KEY = 'pgri-surat-agenda';
const NOTULEN_STORAGE_KEY = 'pgri-notulen-rapat';

const isSafeHttpUrl = (url?: string) => Boolean(url && /^https?:\/\//i.test(url.trim()));

const ROMAN_MONTHS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export type OutgoingLetterCode = 'Und' | 'ST' | 'Ed' | 'Perm' | 'BA' | 'SK';

export const OUTGOING_CODE_OPTIONS: { code: OutgoingLetterCode; label: string }[] = [
  { code: 'Und', label: 'Und — Undangan' },
  { code: 'ST', label: 'ST — Surat Tugas' },
  { code: 'Ed', label: 'Ed — Surat Edaran' },
  { code: 'Perm', label: 'Perm — Permohonan' },
  { code: 'BA', label: 'BA — Berita Acara' },
  { code: 'SK', label: 'SK — Surat Keputusan' }
];

export const buildAutoLetterNumber = (codeType: OutgoingLetterCode, existingCount: number): string => {
  const cfg = getOrgConfig();
  const now = new Date();
  const seq = String(existingCount + 1).padStart(3, '0');
  const roman = ROMAN_MONTHS[now.getMonth()] || 'I';
  return `${seq}/${codeType}/${cfg.letterCodePrefix}/${roman}/${now.getFullYear()}`;
};

export const buildAutoAgendaNumber = (direction: 'Masuk' | 'Keluar', existingCount: number): string => {
  const now = new Date();
  const prefix = direction === 'Masuk' ? 'SM' : 'SK';
  const seq = String(existingCount + 1).padStart(3, '0');
  return `${prefix}-${seq}/${now.getFullYear()}`;
};

const formatAgendaDateShort = (dateStr?: string): string => {
  if (!dateStr) return '-';
  const match = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  return dateStr;
};

const readLocalAgendaList = (): SuratAgendaItem[] => {
  try {
    const raw = localStorage.getItem(AGENDA_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const quickRecordOutgoingAgenda = async (payload: {
  nomorSurat: string;
  tanggalSurat?: string;
  asalTujuan: string;
  perihal: string;
  catatan?: string;
}): Promise<{ ok: boolean; updatedExisting: boolean; item?: SuratAgendaItem; error?: string }> => {
  const cleanNomor = (payload.nomorSurat || '').trim().slice(0, 120);
  const cleanPerihal = (payload.perihal || '').trim().slice(0, 300);
  const cleanTujuan = ((payload.asalTujuan || '').trim() || 'Seluruh Anggota PGRI Ranting Gelang').slice(0, 200);
  if (!cleanNomor || !cleanPerihal) {
    return { ok: false, updatedExisting: false, error: 'Nomor surat dan perihal wajib diisi terlebih dahulu.' };
  }

  const currentList = readLocalAgendaList();
  const existing = currentList.find(
    (x) => x.direction === 'Keluar' && x.nomorSurat.trim().toLowerCase() === cleanNomor.toLowerCase()
  );
  const keluarCount = currentList.filter((x) => x.direction === 'Keluar').length;
  const todayIso = new Date().toISOString().split('T')[0];
  const cleanCatatan = (payload.catatan || '').trim().slice(0, 500);

  const item: SuratAgendaItem = {
    id: existing ? existing.id : `surat-${Date.now()}`,
    direction: 'Keluar',
    nomorAgenda: (existing?.nomorAgenda || buildAutoAgendaNumber('Keluar', keluarCount)).slice(0, 60),
    nomorSurat: cleanNomor,
    tanggalSurat: (payload.tanggalSurat || existing?.tanggalSurat || todayIso).slice(0, 32),
    asalTujuan: cleanTujuan,
    perihal: cleanPerihal,
    ...(existing?.lampiranUrl ? { lampiranUrl: existing.lampiranUrl.slice(0, 600) } : {}),
    ...(cleanCatatan ? { catatan: cleanCatatan } : existing?.catatan ? { catatan: existing.catatan.slice(0, 500) } : {})
  };

  const nextLocal = existing
    ? currentList.map((x) => (x.id === existing.id ? item : x))
    : [item, ...currentList];

  try {
    localStorage.setItem(AGENDA_STORAGE_KEY, JSON.stringify(nextLocal));
    window.dispatchEvent(new Event('pgri-eoffice-synced'));
  } catch {}

  const [colRes, perDocRes] = await Promise.all([
    mutateCloudCollection<SuratAgendaItem>(
      'suratAgenda',
      [AGENDA_STORAGE_KEY],
      (latest) =>
        latest.some((x) => x.id === item.id)
          ? latest.map((x) => (x.id === item.id ? item : x))
          : [item, ...latest],
      nextLocal,
      'Buku Agenda Surat'
    ),
    savePerDocItem('surat_agenda', item.id, item as unknown as Record<string, unknown>)
  ]);

  window.dispatchEvent(new Event('pgri-eoffice-synced'));

  await logAuditEvent(
    'Buku Agenda Surat',
    existing ? 'Perbarui Surat Keluar (1-Klik)' : 'Catat Surat Keluar (1-Klik)',
    `${item.nomorSurat} — ${item.perihal}`
  );

  if (!colRes.success || !perDocRes.success) {
    return {
      ok: true,
      updatedExisting: Boolean(existing),
      item,
      error: colRes.error || perDocRes.error
    };
  }
  return { ok: true, updatedExisting: Boolean(existing), item };
};

export interface PengawasUjianRow {
  id: string;
  teacherId?: string;
  namaPengawas: string;
  nipNpa: string;
  asalSekolah: string;
  tempatMengawas: string;
}

interface EOfficeProps {
  mode: 'surat_tugas' | 'pengawas_ujian' | 'agenda_surat' | 'notulen';
  isAdmin: boolean;
  isDark: boolean;
  teachers: Teacher[];
  events: ActivityEvent[];
  attendanceList: AttendanceRecord[];
  onNotice: (type: 'success' | 'error', text: string) => void;
  onSaveArchiveItem?: (item: InvitationData) => Promise<void>;
  isSavingCloud?: boolean;
  archiveCount?: number;
  loadedArchiveItem?: InvitationData | null;
}

export const EOfficeSubPanels: React.FC<EOfficeProps> = ({
  mode,
  isAdmin,
  isDark,
  teachers,
  events,
  attendanceList,
  onNotice,
  onSaveArchiveItem,
  isSavingCloud = false,
  archiveCount = 0,
  loadedArchiveItem = null
}) => {
  const orgConfig = useMemo(() => getOrgConfig(), []);
  const cardClass = isDark
    ? 'bg-stone-900 border-stone-800 text-stone-100'
    : 'bg-white border-stone-200/90 text-stone-900';
  const inputClass = isDark
    ? 'w-full px-3.5 py-2.5 rounded-xl bg-stone-950 border border-stone-800 text-stone-100 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-red-700/50 focus:border-red-700'
    : 'w-full px-3.5 py-2.5 rounded-xl bg-[#faf8f5] border border-stone-200 text-stone-900 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-red-700/35 focus:border-red-700';
  const labelClass = `block text-xs font-semibold mb-1 ${isDark ? 'text-stone-300' : 'text-stone-700'}`;
  const [isExportingEofficePdf, setIsExportingEofficePdf] = useState(false);

  // =========================================================================
  // 1. SURAT TUGAS / DELEGASI
  // =========================================================================
  const [stNomor, setStNomor] = useState(() => buildAutoLetterNumber('ST', 0));
  const [stDasar, setStDasar] = useState('Undangan Pengurus PGRI Cabang Kecamatan Sumberbaru tentang kegiatan pembinaan dan koordinasi organisasi.');
  const [stKeperluan, setStKeperluan] = useState('Mengikuti Rapat Koordinasi / Kegiatan Resmi PGRI mewakili PGRI Ranting Gelang.');
  const [stHari, setStHari] = useState(() =>
    new Date().toLocaleDateString('id-ID', { weekday: 'long' })
  );
  const [stTanggal, setStTanggal] = useState(() =>
    new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
  );
  const [stTempat, setStTempat] = useState('Gedung PGRI Kecamatan Sumberbaru');
  const [stSelectedIds, setStSelectedIds] = useState<string[]>([]);
  const [stManualNama, setStManualNama] = useState('');
  const [stTembusanList, setStTembusanList] = useState<string[]>([
    'Pengawas Bina',
    'Ketua K3S Sumberbaru',
    'Ketua PGRI Cabang Sumberbaru',
    'Arsip'
  ]);
  const [stShowTtdStempel, setStShowTtdStempel] = useState(true);

  useEffect(() => {
    if (!loadedArchiveItem) return;
    if (loadedArchiveItem.docCategory === 'surat_tugas') {
      setStNomor(loadedArchiveItem.nomorSurat || '');
      setStDasar(loadedArchiveItem.paragrafPembuka || '');
      setStKeperluan(loadedArchiveItem.acara || '');
      setStHari(loadedArchiveItem.hari || '');
      setStTanggal(loadedArchiveItem.tanggalAcara || '');
      setStTempat(loadedArchiveItem.tempatAcara || '');
      if (Array.isArray(loadedArchiveItem.stSelectedIds)) {
        setStSelectedIds(loadedArchiveItem.stSelectedIds);
      }
      if (typeof loadedArchiveItem.stManualNama === 'string') {
        setStManualNama(loadedArchiveItem.stManualNama);
      }
      if (Array.isArray(loadedArchiveItem.tembusanList)) {
        setStTembusanList(loadedArchiveItem.tembusanList);
      }
      setStShowTtdStempel(loadedArchiveItem.showTtdImages !== false);
    } else if (loadedArchiveItem.docCategory === 'pengawas_ujian') {
      setPuNomor(loadedArchiveItem.nomorSurat || '');
      setPuNamaUjian(loadedArchiveItem.acara || '');
      setPuDasar(loadedArchiveItem.paragrafPembuka || '');
      setPuHari(loadedArchiveItem.hari || '');
      setPuTanggalPelaksanaan(loadedArchiveItem.tanggalAcara || '');
      setPuWaktu(loadedArchiveItem.puWaktu || loadedArchiveItem.pukul || '');
      if (Array.isArray(loadedArchiveItem.puRows)) {
        setPuRows(loadedArchiveItem.puRows);
      }
      if (Array.isArray(loadedArchiveItem.tembusanList)) {
        setPuTembusanList(loadedArchiveItem.tembusanList);
      }
      setPuShowTtdStempel(loadedArchiveItem.showTtdImages !== false);
    }
  }, [loadedArchiveItem]);

  const selectedDelegates = useMemo(
    () => teachers.filter((t) => stSelectedIds.includes(t.id)),
    [teachers, stSelectedIds]
  );

  const toggleDelegate = (id: string) => {
    setStSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const buildSuratTugasHtml = () => {
    const logoPgri = localStorage.getItem('logo-pgri') || localStorage.getItem('logo-kombel') || '';
    const ttdKetua = localStorage.getItem('ttd-ketua') || '';
    const ttdKetuaScale = Math.max(0.3, Math.min(2.5, (Number(localStorage.getItem('ttd-ketua-size')) || 100) / 100));
    const ttdSekretaris = localStorage.getItem('ttd-sekretaris') || '';
    const ttdSekretarisScale = Math.max(0.3, Math.min(2.5, (Number(localStorage.getItem('ttd-sekretaris-size')) || 100) / 100));
    const stempel = localStorage.getItem('logo-stempel') || '';
    const stempelScale = Math.max(0.3, Math.min(2.5, (Number(localStorage.getItem('logo-stempel-size')) || 100) / 100));
    const stempelRotation = Number(localStorage.getItem('logo-stempel-rotation')) || 0;
    const { namaKetua, npaKetua, namaSekretaris, npaSekretaris } = resolveEOfficeSigners();
    const todayStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const rows = [
      ...selectedDelegates.map((t, i) => ({
        no: i + 1,
        name: t.name,
        npa: (t as any).npa || t.nip || '-',
        school: t.school || '-'
      })),
      ...(stManualNama.trim()
        ? stManualNama
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((name, idx) => ({
              no: selectedDelegates.length + idx + 1,
              name,
              npa: '-',
              school: 'PGRI Ranting Gelang'
            }))
        : [])
    ];

    const stTembusanItemsHtml = (stTembusanList || [])
      .filter((item) => item.trim() !== '')
      .map((item, idx) => `<div>${idx + 1}. ${escapeHtml(item)}</div>`)
      .join('');

    const verifyText = `SURAT TUGAS PGRI RANTING GELANG | No: ${stNomor} | Tgl: ${stHari}, ${stTanggal}`;
    const qrUrl = generateQrSvgDataUrl(verifyText, 140);

    return `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>Surat Tugas ${escapeHtml(stNomor)}</title>
      <style>
        @page { size: A4 portrait; margin: 0; }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: transparent; }
        .sheet-a4 {
          width: 210mm;
          min-height: 297mm;
          margin: 0 auto;
          background: #ffffff;
          color: #000000;
          padding: 14mm 18mm 14mm 18mm;
          font-family: 'Times New Roman', Times, serif;
          font-size: 11.5pt;
          line-height: 1.5;
          display: flex;
          flex-direction: column;
        }
        .content-body { flex: 1; }
        .kop { display: flex; align-items: center; gap: 14px; padding-bottom: 6px; position: relative; z-index: 2; font-family: 'Times New Roman', Times, serif; }
        .kop-logo-wrap { width: 94px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
        .kop-logo-wrap img { width: 92px; height: 92px; object-fit: contain; display: block; }
        .kop-logo-placeholder { width: 92px; height: 92px; border: 1.5px dashed #94a3b8; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9pt; color: #64748b; text-align: center; }
        .kop-text { flex: 1; text-align: center; line-height: 1.18; color: #000000; padding-left: 8px; }
        .kop-text .org-main { font-size: 13pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.3px; }
        .kop-text .sub-org { font-size: 10.5pt; font-weight: bold; font-style: italic; margin-top: 1px; }
        .kop-text .ranting-main { font-size: 16.5pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 1px; }
        .kop-text .wilayah { font-size: 12pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.3px; margin-top: 1px; }
        .kop-text .sekretariat { font-size: 8.5pt; font-style: italic; margin-top: 2px; }
        .kop-divider { border-top: 2px solid #000000; border-bottom: 1px solid #000000; height: 2px; margin-bottom: 18px; position: relative; z-index: 2; }
        .title { text-align: center; margin: 14px 0 16px; }
        .title h3 { margin: 0; font-size: 13pt; text-decoration: underline; letter-spacing: 1px; }
        table.delegates { width: 100%; border-collapse: collapse; margin: 10px 0 14px; font-size: 10.5pt; }
        table.delegates th, table.delegates td { border: 1px solid #000; padding: 6px 8px; }
        table.delegates th { background: #f3f4f6; }
        .footer-wrap { margin-top: 24px; padding-top: 8px; }
        .ttd-grid { display: flex; justify-content: space-between; align-items: flex-end; position: relative; }
        .ttd-col { width: 220px; text-align: center; position: relative; }
        .ttd-space { height: 68px; position: relative; display: flex; align-items: center; justify-content: center; overflow: visible; }
        .stempel-center { position: absolute; left: 50%; transform: translateX(-50%); bottom: 6px; opacity: 0.88; mix-blend-mode: multiply; pointer-events: none; }
        @media print {
          html, body { background: #ffffff; }
          .sheet-a4 { width: 210mm; min-height: 297mm; margin: 0; box-shadow: none; }
        }
      </style></head><body>
      <div class="sheet-a4">
        <div class="content-body">
          <div class="kop">
            <div class="kop-logo-wrap">
              ${logoPgri ? `<img src="${logoPgri}" alt="Logo PGRI" />` : `<div class="kop-logo-placeholder">Logo<br/>PGRI</div>`}
            </div>
            <div class="kop-text">
              <div class="org-main">${escapeHtml(orgConfig.kopOrganisasi)}</div>
              <div class="sub-org">(Teachers Association Of Republic Indonesia)</div>
              <div class="ranting-main">${escapeHtml(orgConfig.kopRanting)}</div>
              <div class="wilayah">${escapeHtml(orgConfig.kopWilayah)}</div>
              <div class="sekretariat">${escapeHtml(orgConfig.kopSekretariat)}</div>
            </div>
          </div>
          <div class="kop-divider"></div>
          <div class="title">
            <h3>SURAT TUGAS</h3>
            <div>Nomor : ${escapeHtml(stNomor)}</div>
          </div>
          <p><strong>Dasar :</strong> ${escapeHtml(stDasar)}</p>
          <p style="text-align:center; font-weight:bold; letter-spacing:1px; margin: 12px 0 8px;">MENUGASKAN</p>
          <p>Kepada anggota PGRI Ranting Gelang berikut ini:</p>
          <table class="delegates">
            <thead><tr><th style="width:40px">No</th><th>Nama Lengkap</th><th>NPA / NIP</th><th>Unit Kerja / Sekolah</th></tr></thead>
            <tbody>
              ${
                rows.length > 0
                  ? rows.map((r) => `<tr><td style="text-align:center">${r.no}</td><td>${escapeHtml(r.name)}</td><td style="text-align:center">${escapeHtml(r.npa)}</td><td>${escapeHtml(r.school)}</td></tr>`).join('')
                  : `<tr><td colspan="4" style="text-align:center; color:#666;">(Belum ada peserta delegasi yang dipilih)</td></tr>`
              }
            </tbody>
          </table>
          <p><strong>Untuk :</strong> ${escapeHtml(stKeperluan)}</p>
          <table style="margin: 8px 0 12px; font-size: 11pt;">
            <tr><td style="width:130px">Hari</td><td>: ${escapeHtml(stHari)}</td></tr>
            <tr><td>Tanggal</td><td>: ${escapeHtml(stTanggal)}</td></tr>
            <tr><td>Tempat</td><td>: ${escapeHtml(stTempat)}</td></tr>
          </table>
          <p>Demikian Surat Tugas ini diberikan untuk dilaksanakan dengan penuh tanggung jawab serta melaporkan hasilnya kepada Pengurus PGRI Ranting Gelang.</p>
        </div>
        <div class="footer-wrap">
          <div style="text-align:right; margin-bottom:6px; padding-right:24px;">Sumberbaru, ${escapeHtml(todayStr)}</div>
          <div class="ttd-grid">
            <div class="ttd-col">
              <div>Ketua</div>
              <div>PGRI Ranting Gelang</div>
              <div class="ttd-space">
                ${ttdKetua ? `<img src="${ttdKetua}" style="height:${Math.round(62 * ttdKetuaScale)}px; width:auto; max-width:${Math.round(160 * ttdKetuaScale)}px; object-fit:contain;" alt="TTD Ketua" />` : ''}
              </div>
              <div style="font-weight:bold; text-decoration:underline;">${escapeHtml(namaKetua)}</div>
              <div style="font-size:10pt;">NPA. ${escapeHtml(npaKetua)}</div>
            </div>
            ${stempel ? `<img src="${stempel}" class="stempel-center" style="width:${Math.round(112 * stempelScale)}px; height:${Math.round(112 * stempelScale)}px; object-fit:contain; transform:translateX(-50%) rotate(${stempelRotation}deg);" alt="Stempel" />` : ''}
            <div class="ttd-col">
              <div>Sekretaris</div>
              <div>PGRI Ranting Gelang</div>
              <div class="ttd-space">
                ${ttdSekretaris ? `<img src="${ttdSekretaris}" style="height:${Math.round(62 * ttdSekretarisScale)}px; width:auto; max-width:${Math.round(160 * ttdSekretarisScale)}px; object-fit:contain;" alt="TTD Sekretaris" />` : ''}
              </div>
              <div style="font-weight:bold; text-decoration:underline;">${escapeHtml(namaSekretaris)}</div>
              <div style="font-size:10pt;">NPA. ${escapeHtml(npaSekretaris)}</div>
            </div>
          </div>
          <div style="margin-top:16px; display:flex; justify-content:space-between; align-items:flex-end; gap:12px;">
            ${
              stTembusanItemsHtml
                ? `
              <div style="font-size: 10.5pt; line-height: 1.45; flex: 1;">
                <div style="margin-bottom: 4px;">Tembusan disampaikan kepada :</div>
                ${stTembusanItemsHtml}
              </div>
            `
                : '<div style="flex: 1;"></div>'
            }
            <div style="width:96px; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; font-size:8.5pt; color:#334155; flex-shrink:0;">
              <img src="${qrUrl}" alt="QR Verifikasi" style="width:58px; height:58px; border:1px solid #cbd5e1; padding:3px; background:#fff; display:block; margin:0 auto;" />
              <div style="margin-top:4px; width:100%; text-align:center; line-height:1.2;">Verifikasi Surat</div>
            </div>
          </div>
        </div>
      </div>
      </body></html>`;
  };

  const handleExportSuratTugas = async () => {
    if (isExportingEofficePdf) return;
    setIsExportingEofficePdf(true);
    try {
      const html = buildSuratTugasHtml();
      await exportFullHtmlToPdfOrPrint(html, {
        filename: `Surat_Tugas_${stNomor.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
        orientation: 'portrait'
      });
      logAuditEvent('E-Office', 'Cetak Surat Tugas', `Menerbitkan Surat Tugas No. ${stNomor} (${selectedDelegates.length} delegasi).`);
      onNotice(
        'success',
        isMobileDevice()
          ? 'File PDF Surat Tugas berhasil diunduh.'
          : 'Jendela cetak Surat Tugas dibuka (pilih Save as PDF untuk menyimpan).'
      );
    } finally {
      setIsExportingEofficePdf(false);
    }
  };

  // =========================================================================
  // 1B. PENGAWAS UJIAN (SILANG ANTAR SEKOLAH)
  // =========================================================================
  const [puNomor, setPuNomor] = useState(() => buildAutoLetterNumber('ST', 0));
  const [puNamaUjian, setPuNamaUjian] = useState('Sumatif Akhir Semester (SAS) Ganjil Tahun Pelajaran 2026/2027');
  const [puDasar, setPuDasar] = useState(
    'Hasil musyawarah Pengurus PGRI Ranting Gelang dan Kepala Sekolah tentang pelaksanaan pengawas ujian silang antar sekolah di PGRI Ranting Gelang.'
  );
  const [puHari, setPuHari] = useState('Senin - Sabtu');
  const [puTanggalPelaksanaan, setPuTanggalPelaksanaan] = useState('30 November 2026 - 05 Desember 2026');
  const [puWaktu, setPuWaktu] = useState('07.30 WIB - Selesai');
  const [puSelectedTeacherId, setPuSelectedTeacherId] = useState('');
  const [puRows, setPuRows] = useState<PengawasUjianRow[]>([]);
  const [puTembusanList, setPuTembusanList] = useState<string[]>([
    'Pengawas Bina Kecamatan Sumberbaru',
    'Ketua K3S Kecamatan Sumberbaru',
    'Kepala SD Negeri / Swasta Se-Ranting Gelang',
    'Arsip'
  ]);
  const [puShowTtdStempel, setPuShowTtdStempel] = useState(true);

  const schoolOptions = useMemo(() => {
    const set = new Set<string>();
    teachers.forEach((t) => {
      if (t.school && t.school.trim()) set.add(t.school.trim());
    });
    return Array.from(set).sort();
  }, [teachers]);

  const handleAddPengawasFromTeacher = () => {
    const t = teachers.find((x) => x.id === puSelectedTeacherId);
    if (!t) return;
    setPuRows((prev) => [
      ...prev,
      {
        id: `pu-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        teacherId: t.id,
        namaPengawas: t.name,
        nipNpa: (t as any).npa || t.nip || '-',
        asalSekolah: t.school || '-',
        tempatMengawas: ''
      }
    ]);
    setPuSelectedTeacherId('');
  };

  const handleAddPengawasManual = () => {
    setPuRows((prev) => [
      ...prev,
      {
        id: `pu-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        namaPengawas: '',
        nipNpa: '-',
        asalSekolah: '',
        tempatMengawas: ''
      }
    ]);
  };

  const updatePuRow = (id: string, field: keyof PengawasUjianRow, value: string) => {
    setPuRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const removePuRow = (id: string) => {
    setPuRows((prev) => prev.filter((r) => r.id !== id));
  };

  const buildPengawasUjianHtml = () => {
    const logoPgri = localStorage.getItem('logo-pgri') || localStorage.getItem('logo-kombel') || '';
    const ttdKetua = localStorage.getItem('ttd-ketua') || '';
    const ttdKetuaScale = Math.max(0.3, Math.min(2.5, (Number(localStorage.getItem('ttd-ketua-size')) || 100) / 100));
    const ttdSekretaris = localStorage.getItem('ttd-sekretaris') || '';
    const ttdSekretarisScale = Math.max(0.3, Math.min(2.5, (Number(localStorage.getItem('ttd-sekretaris-size')) || 100) / 100));
    const stempel = localStorage.getItem('logo-stempel') || '';
    const stempelScale = Math.max(0.3, Math.min(2.5, (Number(localStorage.getItem('logo-stempel-size')) || 100) / 100));
    const stempelRotation = Number(localStorage.getItem('logo-stempel-rotation')) || 0;
    const { namaKetua, npaKetua, namaSekretaris, npaSekretaris } = resolveEOfficeSigners();
    const todayStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

    const puTembusanItemsHtml = (puTembusanList || [])
      .filter((item) => item.trim() !== '')
      .map((item, idx) => `<div>${idx + 1}. ${escapeHtml(item)}</div>`)
      .join('');

    const verifyText = `SURAT TUGAS PENGAWAS UJIAN SILANG PGRI RANTING GELANG | No: ${puNomor} | Kegiatan: ${puNamaUjian}`;
    const qrUrl = generateQrSvgDataUrl(verifyText, 140);

    return `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>Surat Tugas Pengawas Ujian ${escapeHtml(puNomor)}</title>
      <style>
        @page { size: A4 portrait; margin: 0; }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: transparent; }
        .sheet-a4 {
          width: 210mm;
          min-height: 297mm;
          margin: 0 auto;
          background: #ffffff;
          color: #000000;
          padding: 14mm 18mm 14mm 18mm;
          font-family: 'Times New Roman', Times, serif;
          font-size: 11pt;
          line-height: 1.45;
          display: flex;
          flex-direction: column;
        }
        .content-body { flex: 1; }
        .kop { display: flex; align-items: center; gap: 14px; padding-bottom: 6px; position: relative; z-index: 2; font-family: 'Times New Roman', Times, serif; }
        .kop-logo-wrap { width: 94px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
        .kop-logo-wrap img { width: 92px; height: 92px; object-fit: contain; display: block; }
        .kop-logo-placeholder { width: 92px; height: 92px; border: 1.5px dashed #94a3b8; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9pt; color: #64748b; text-align: center; }
        .kop-text { flex: 1; text-align: center; line-height: 1.18; color: #000000; padding-left: 8px; }
        .kop-text .org-main { font-size: 13pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.3px; }
        .kop-text .sub-org { font-size: 10.5pt; font-weight: bold; font-style: italic; margin-top: 1px; }
        .kop-text .ranting-main { font-size: 16.5pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 1px; }
        .kop-text .wilayah { font-size: 12pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.3px; margin-top: 1px; }
        .kop-text .sekretariat { font-size: 8.5pt; font-style: italic; margin-top: 2px; }
        .kop-divider { border-top: 2px solid #000000; border-bottom: 1px solid #000000; height: 2px; margin-bottom: 16px; position: relative; z-index: 2; }
        .title { text-align: center; margin: 10px 0 14px; }
        .title h3 { margin: 0; font-size: 12.5pt; text-decoration: underline; letter-spacing: 0.8px; }
        table.pengawas { width: 100%; border-collapse: collapse; margin: 10px 0 12px; font-size: 9.8pt; }
        table.pengawas th, table.pengawas td { border: 1px solid #000; padding: 5px 7px; vertical-align: middle; }
        table.pengawas th { background: #f3f4f6; text-align: center; font-weight: bold; }
        .footer-wrap { margin-top: 18px; padding-top: 6px; }
        .ttd-grid { display: flex; justify-content: space-between; align-items: flex-end; position: relative; }
        .ttd-col { width: 220px; text-align: center; position: relative; }
        .ttd-space { height: 64px; position: relative; display: flex; align-items: center; justify-content: center; overflow: visible; }
        .stempel-center { position: absolute; left: 50%; transform: translateX(-50%); bottom: 6px; opacity: 0.88; mix-blend-mode: multiply; pointer-events: none; }
        @media print {
          html, body { background: #ffffff; }
          .sheet-a4 { width: 210mm; min-height: 297mm; margin: 0; box-shadow: none; }
        }
      </style></head><body>
      <div class="sheet-a4">
        <div class="content-body">
          <div class="kop">
            <div class="kop-logo-wrap">
              ${logoPgri ? `<img src="${logoPgri}" alt="Logo PGRI" />` : `<div class="kop-logo-placeholder">Logo<br/>PGRI</div>`}
            </div>
            <div class="kop-text">
              <div class="org-main">${escapeHtml(orgConfig.kopOrganisasi)}</div>
              <div class="sub-org">(Teachers Association Of Republic Indonesia)</div>
              <div class="ranting-main">${escapeHtml(orgConfig.kopRanting)}</div>
              <div class="wilayah">${escapeHtml(orgConfig.kopWilayah)}</div>
              <div class="sekretariat">${escapeHtml(orgConfig.kopSekretariat)}</div>
            </div>
          </div>
          <div class="kop-divider"></div>
          <div class="title">
            <h3>SURAT TUGAS PENGAWAS UJIAN SILANG</h3>
            <div>Nomor : ${escapeHtml(puNomor)}</div>
          </div>
          <p style="margin: 0 0 8px; text-align: justify;"><strong>Dasar :</strong> ${escapeHtml(puDasar)}</p>
          <p style="text-align:center; font-weight:bold; letter-spacing:1px; margin: 10px 0 6px;">MENUGASKAN</p>
          <p style="margin: 0 0 6px;">Kepada nama-nama guru PGRI Ranting Gelang berikut untuk bertugas sebagai <strong>Pengawas Ujian Silang</strong> pada kegiatan <strong>${escapeHtml(puNamaUjian)}</strong>:</p>
          <table class="pengawas">
            <thead>
              <tr>
                <th style="width:32px">No</th>
                <th>Nama Pengawas</th>
                <th style="width:105px">NPA / NIP</th>
                <th>Asal Sekolah</th>
                <th>Tempat Ujian</th>
              </tr>
            </thead>
            <tbody>
              ${
                puRows.length > 0
                  ? puRows
                      .map(
                        (r, idx) =>
                          `<tr>
                            <td style="text-align:center">${idx + 1}</td>
                            <td><strong>${escapeHtml(r.namaPengawas || '-')}</strong></td>
                            <td style="text-align:center">${escapeHtml(r.nipNpa || '-')}</td>
                            <td>${escapeHtml(r.asalSekolah || '-')}</td>
                            <td><strong>${escapeHtml(r.tempatMengawas || '-')}</strong></td>
                          </tr>`
                      )
                      .join('')
                  : `<tr><td colspan="5" style="text-align:center; color:#666; padding:12px;">(Belum ada daftar penugasan pengawas silang yang ditambahkan)</td></tr>`
              }
            </tbody>
          </table>
          <table style="margin: 6px 0 10px; font-size: 10.5pt;">
            <tr><td style="width:140px">Hari</td><td>: ${escapeHtml(puHari)}</td></tr>
            <tr><td>Tanggal</td><td>: ${escapeHtml(puTanggalPelaksanaan)}</td></tr>
            <tr><td>Waktu</td><td>: ${escapeHtml(puWaktu)}</td></tr>
          </table>
          <p style="margin: 0; text-align: justify;">Demikian Surat Tugas Pengawas Ujian Silang ini dibuat untuk dilaksanakan dengan penuh tanggung jawab dan integritas sesuai tata tertib pengawas ujian.</p>
        </div>
        <div class="footer-wrap">
          <div style="text-align:right; margin-bottom:6px; padding-right:24px;">Sumberbaru, ${escapeHtml(todayStr)}</div>
          <div class="ttd-grid">
            <div class="ttd-col">
              <div>Ketua</div>
              <div>PGRI Ranting Gelang</div>
              <div class="ttd-space">
                ${puShowTtdStempel && ttdKetua ? `<img src="${ttdKetua}" style="height:${Math.round(62 * ttdKetuaScale)}px; width:auto; max-width:${Math.round(160 * ttdKetuaScale)}px; object-fit:contain;" alt="TTD Ketua" />` : ''}
              </div>
              <div style="font-weight:bold; text-decoration:underline;">${escapeHtml(namaKetua)}</div>
              <div style="font-size:10pt;">NPA. ${escapeHtml(npaKetua)}</div>
            </div>
            ${puShowTtdStempel && stempel ? `<img src="${stempel}" class="stempel-center" style="width:${Math.round(112 * stempelScale)}px; height:${Math.round(112 * stempelScale)}px; object-fit:contain; transform:translateX(-50%) rotate(${stempelRotation}deg);" alt="Stempel" />` : ''}
            <div class="ttd-col">
              <div>Sekretaris</div>
              <div>PGRI Ranting Gelang</div>
              <div class="ttd-space">
                ${puShowTtdStempel && ttdSekretaris ? `<img src="${ttdSekretaris}" style="height:${Math.round(62 * ttdSekretarisScale)}px; width:auto; max-width:${Math.round(160 * ttdSekretarisScale)}px; object-fit:contain;" alt="TTD Sekretaris" />` : ''}
              </div>
              <div style="font-weight:bold; text-decoration:underline;">${escapeHtml(namaSekretaris)}</div>
              <div style="font-size:10pt;">NPA. ${escapeHtml(npaSekretaris)}</div>
            </div>
          </div>
          <div style="margin-top:14px; display:flex; justify-content:space-between; align-items:flex-end; gap:12px;">
            ${
              puTembusanItemsHtml
                ? `
              <div style="font-size: 10pt; line-height: 1.4; flex: 1;">
                <div style="margin-bottom: 3px;">Tembusan disampaikan kepada :</div>
                ${puTembusanItemsHtml}
              </div>
            `
                : '<div style="flex: 1;"></div>'
            }
            <div style="width:96px; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; font-size:8.5pt; color:#334155; flex-shrink:0;">
              <img src="${qrUrl}" alt="QR Verifikasi" style="width:56px; height:56px; border:1px solid #cbd5e1; padding:3px; background:#fff; display:block; margin:0 auto;" />
              <div style="margin-top:4px; width:100%; text-align:center; line-height:1.2;">Verifikasi Surat</div>
            </div>
          </div>
        </div>
      </div>
      </body></html>`;
  };

  const handleExportPengawasUjian = async () => {
    if (isExportingEofficePdf) return;
    setIsExportingEofficePdf(true);
    try {
      const html = buildPengawasUjianHtml();
      await exportFullHtmlToPdfOrPrint(html, {
        filename: `Pengawas_Ujian_Silang_${puNomor.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
        orientation: 'portrait'
      });
      logAuditEvent(
        'E-Office',
        'Cetak Surat Tugas Pengawas Ujian',
        `Menerbitkan Surat Tugas Pengawas Ujian Silang No. ${puNomor} (${puRows.length} pengawas).`
      );
      onNotice(
        'success',
        isMobileDevice()
          ? 'File PDF Pengawas Ujian Silang berhasil diunduh.'
          : 'Jendela cetak Pengawas Ujian Silang dibuka (pilih Save as PDF untuk menyimpan).'
      );
    } finally {
      setIsExportingEofficePdf(false);
    }
  };

  // =========================================================================
  // 2. BUKU AGENDA SURAT (MASUK & KELUAR)
  // =========================================================================
  const [agendaList, setAgendaList] = useState<SuratAgendaItem[]>(() => readLocalAgendaList());
  const [agendaFilter, setAgendaFilter] = useState<'Semua' | 'Masuk' | 'Keluar'>('Semua');
  const [agendaStatusFilter, setAgendaStatusFilter] = useState<'Semua' | 'Baru' | 'Diproses' | 'Selesai'>('Semua');
  const [agendaMonthFilter, setAgendaMonthFilter] = useState<string>('');
  const [agendaSearch, setAgendaSearch] = useState('');
  const [editingAgendaId, setEditingAgendaId] = useState<string | null>(null);
  const [keluarCodeType, setKeluarCodeType] = useState<OutgoingLetterCode>('Und');
  const [isRecordingQuickAgenda, setIsRecordingQuickAgenda] = useState(false);

  const createEmptyAgendaForm = (
    dir: 'Masuk' | 'Keluar',
    list: SuratAgendaItem[],
    codeType: OutgoingLetterCode = 'Und'
  ): Omit<SuratAgendaItem, 'id'> => {
    const todayIso = new Date().toISOString().split('T')[0];
    const dirCount = list.filter((x) => x.direction === dir).length;
    return {
      direction: dir,
      nomorAgenda: buildAutoAgendaNumber(dir, dirCount),
      nomorSurat: dir === 'Keluar' ? buildAutoLetterNumber(codeType, dirCount) : '',
      tanggalSurat: todayIso,
      tanggalTerima: dir === 'Masuk' ? todayIso : '',
      perihal: '',
      asalTujuan: '',
      disposisi: '',
      statusTindakLanjut: dir === 'Masuk' ? 'Baru' : undefined,
      catatan: '',
      lampiranUrl: ''
    };
  };

  const [newAgenda, setNewAgenda] = useState<Omit<SuratAgendaItem, 'id'>>(() =>
    createEmptyAgendaForm('Keluar', readLocalAgendaList(), 'Und')
  );

  useEffect(() => {
    try {
      localStorage.setItem(AGENDA_STORAGE_KEY, JSON.stringify(agendaList));
    } catch {}
  }, [agendaList]);

  useEffect(() => {
    const syncSubPanelsFromStorage = () => {
      try {
        const rawAgenda = localStorage.getItem(AGENDA_STORAGE_KEY);
        if (rawAgenda) {
          const parsedAgenda = JSON.parse(rawAgenda);
          if (Array.isArray(parsedAgenda)) setAgendaList(parsedAgenda);
        }
      } catch {}
      try {
        const rawNotulen = localStorage.getItem(NOTULEN_STORAGE_KEY);
        if (rawNotulen) {
          const parsedNotulen = JSON.parse(rawNotulen);
          if (Array.isArray(parsedNotulen)) setNotulenList(parsedNotulen);
        }
      } catch {}
    };
    window.addEventListener('pgri-eoffice-synced', syncSubPanelsFromStorage);
    return () => window.removeEventListener('pgri-eoffice-synced', syncSubPanelsFromStorage);
  }, []);

  const agendaStats = useMemo(() => {
    let totalMasuk = 0;
    let totalKeluar = 0;
    let pendingMasuk = 0;
    agendaList.forEach((item) => {
      if (item.direction === 'Masuk') {
        totalMasuk += 1;
        if ((item.statusTindakLanjut || 'Baru') !== 'Selesai') {
          pendingMasuk += 1;
        }
      } else {
        totalKeluar += 1;
      }
    });
    return { totalMasuk, totalKeluar, pendingMasuk };
  }, [agendaList]);

  const handleAgendaDirectionChange = (nextDir: 'Masuk' | 'Keluar') => {
    if (editingAgendaId) {
      setNewAgenda((prev) => ({
        ...prev,
        direction: nextDir,
        ...(nextDir === 'Masuk'
          ? {
              tanggalTerima: prev.tanggalTerima || new Date().toISOString().split('T')[0],
              statusTindakLanjut: prev.statusTindakLanjut || 'Baru'
            }
          : {})
      }));
      return;
    }
    const dirCount = agendaList.filter((x) => x.direction === nextDir).length;
    const todayIso = new Date().toISOString().split('T')[0];
    setNewAgenda((prev) => ({
      ...prev,
      direction: nextDir,
      nomorAgenda: buildAutoAgendaNumber(nextDir, dirCount),
      nomorSurat: nextDir === 'Keluar' ? buildAutoLetterNumber(keluarCodeType, dirCount) : '',
      tanggalTerima: nextDir === 'Masuk' ? prev.tanggalTerima || todayIso : '',
      statusTindakLanjut: nextDir === 'Masuk' ? prev.statusTindakLanjut || 'Baru' : undefined
    }));
  };

  const handleEditAgenda = (item: SuratAgendaItem) => {
    setEditingAgendaId(item.id);
    setNewAgenda({
      direction: item.direction,
      nomorAgenda: item.nomorAgenda || '',
      nomorSurat: item.nomorSurat,
      tanggalSurat: item.tanggalSurat,
      tanggalTerima: item.tanggalTerima || (item.direction === 'Masuk' ? item.tanggalSurat : ''),
      asalTujuan: item.asalTujuan,
      perihal: item.perihal,
      disposisi: item.disposisi || '',
      statusTindakLanjut: item.direction === 'Masuk' ? item.statusTindakLanjut || 'Baru' : undefined,
      lampiranUrl: item.lampiranUrl || '',
      catatan: item.catatan || ''
    });
  };

  const handleCancelEditAgenda = () => {
    setEditingAgendaId(null);
    setNewAgenda(createEmptyAgendaForm('Keluar', agendaList, keluarCodeType));
  };

  const handleQuickStatusChange = async (
    item: SuratAgendaItem,
    nextStatus: 'Baru' | 'Diproses' | 'Selesai'
  ) => {
    if (!isAdmin || item.direction !== 'Masuk') return;
    const updatedItem: SuratAgendaItem = {
      ...item,
      statusTindakLanjut: nextStatus
    };
    const updated = agendaList.map((x) => (x.id === item.id ? updatedItem : x));
    setAgendaList(updated);

    const [colRes, perDocRes] = await Promise.all([
      mutateCloudCollection<SuratAgendaItem>(
        'suratAgenda',
        [AGENDA_STORAGE_KEY],
        (latest) => latest.map((x) => (x.id === item.id ? updatedItem : x)),
        updated,
        'Buku Agenda Surat'
      ),
      savePerDocItem('surat_agenda', updatedItem.id, updatedItem as unknown as Record<string, unknown>)
    ]);

    if (colRes.success && perDocRes.success) {
      await logAuditEvent(
        'Buku Agenda Surat',
        'Ubah Status Disposisi',
        `${updatedItem.nomorSurat} — Status: ${nextStatus}`
      );
      onNotice('success', `Status Surat Masuk diperbarui menjadi "${nextStatus}".`);
    } else {
      onNotice('error', colRes.error || perDocRes.error || 'Status tersimpan lokal, gagal sinkron ke Cloud.');
    }
  };

  const handleAddAgenda = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !newAgenda.nomorSurat.trim() || !newAgenda.perihal.trim() || !newAgenda.asalTujuan.trim()) return;
    if (newAgenda.lampiranUrl && !isSafeHttpUrl(newAgenda.lampiranUrl)) {
      onNotice('error', 'URL lampiran harus diawali https:// atau http://');
      return;
    }

    const isEditing = Boolean(editingAgendaId);
    const dirCount = agendaList.filter((x) => x.direction === newAgenda.direction).length;
    const cleanNomorAgenda = (
      newAgenda.nomorAgenda?.trim() || buildAutoAgendaNumber(newAgenda.direction, dirCount)
    ).slice(0, 60);
    const cleanTanggalTerima =
      newAgenda.direction === 'Masuk'
        ? (newAgenda.tanggalTerima?.trim() || newAgenda.tanggalSurat || new Date().toISOString().split('T')[0]).slice(0, 32)
        : '';
    const cleanDisposisi =
      newAgenda.direction === 'Masuk' ? (newAgenda.disposisi || '').trim().slice(0, 300) : '';
    const cleanStatus: 'Baru' | 'Diproses' | 'Selesai' | undefined =
      newAgenda.direction === 'Masuk' ? newAgenda.statusTindakLanjut || 'Baru' : undefined;
    const cleanLampiran = (newAgenda.lampiranUrl || '').trim().slice(0, 600);
    const cleanCatatan = (newAgenda.catatan || '').trim().slice(0, 500);

    const item: SuratAgendaItem = {
      id: editingAgendaId || `surat-${Date.now()}`,
      direction: newAgenda.direction,
      ...(cleanNomorAgenda ? { nomorAgenda: cleanNomorAgenda } : {}),
      nomorSurat: newAgenda.nomorSurat.trim().slice(0, 120),
      tanggalSurat: (newAgenda.tanggalSurat || new Date().toISOString().split('T')[0]).slice(0, 32),
      ...(cleanTanggalTerima ? { tanggalTerima: cleanTanggalTerima } : {}),
      asalTujuan: newAgenda.asalTujuan.trim().slice(0, 200),
      perihal: newAgenda.perihal.trim().slice(0, 300),
      ...(cleanDisposisi ? { disposisi: cleanDisposisi } : {}),
      ...(cleanStatus ? { statusTindakLanjut: cleanStatus } : {}),
      ...(cleanLampiran ? { lampiranUrl: cleanLampiran } : {}),
      ...(cleanCatatan ? { catatan: cleanCatatan } : {})
    };

    const updated = isEditing
      ? agendaList.map((x) => (x.id === item.id ? item : x))
      : [item, ...agendaList];
    setAgendaList(updated);

    const [colRes, perDocRes] = await Promise.all([
      mutateCloudCollection<SuratAgendaItem>(
        'suratAgenda',
        [AGENDA_STORAGE_KEY],
        (latest) =>
          isEditing
            ? latest.map((x) => (x.id === item.id ? item : x))
            : [item, ...latest.filter((x) => x.id !== item.id)],
        updated,
        'Buku Agenda Surat'
      ),
      savePerDocItem('surat_agenda', item.id, item as unknown as Record<string, unknown>)
    ]);

    await logAuditEvent(
      'Buku Agenda Surat',
      isEditing ? `Edit Surat ${item.direction}` : `Catat Surat ${item.direction}`,
      `${item.nomorAgenda ? `[${item.nomorAgenda}] ` : ''}${item.nomorSurat} — ${item.perihal}`
    );

    setEditingAgendaId(null);
    setNewAgenda(createEmptyAgendaForm(item.direction, updated, keluarCodeType));
    if (colRes.success && perDocRes.success) {
      onNotice(
        'success',
        isEditing
          ? `Perubahan catatan Surat ${item.direction} berhasil disimpan.`
          : `Surat ${item.direction} berhasil dicatat di Buku Agenda & Cloud.`
      );
    } else {
      onNotice('error', colRes.error || perDocRes.error || 'Tersimpan di perangkat lokal, namun gagal sinkron ke Cloud.');
    }
  };

  const handleDeleteAgenda = async (id: string) => {
    if (!isAdmin) return;
    if (editingAgendaId === id) {
      setEditingAgendaId(null);
    }
    const deletedAgenda = agendaList.find((x) => x.id === id);
    const updated = agendaList.filter((x) => x.id !== id);
    setAgendaList(updated);
    const [res, perDocRes] = await Promise.all([
      mutateCloudCollection<SuratAgendaItem>(
        'suratAgenda',
        [AGENDA_STORAGE_KEY],
        (latest) => latest.filter((x) => x.id !== id),
        updated,
        'Buku Agenda Surat'
      ),
      deletePerDocItem('surat_agenda', id, 'Buku Agenda Surat')
    ]);
    setAgendaList(res.items);
    if (res.success && perDocRes.success) {
      if (deletedAgenda) {
        void logAuditEvent(
          'Buku Agenda Surat',
          'Hapus Surat',
          `Menghapus surat ${deletedAgenda.direction} No. ${deletedAgenda.nomorSurat} — ${deletedAgenda.perihal}.`
        );
      }
      onNotice('success', 'Catatan surat dihapus dari Buku Agenda.');
    } else {
      onNotice('error', res.error || perDocRes.error || 'Catatan terhapus lokal, namun gagal sinkron ke Cloud.');
    }
  };

  const filteredAgenda = useMemo(() => {
    return agendaList.filter((item) => {
      const matchDir = agendaFilter === 'Semua' || item.direction === agendaFilter;
      const matchStatus =
        agendaFilter !== 'Masuk' ||
        agendaStatusFilter === 'Semua' ||
        (item.statusTindakLanjut || 'Baru') === agendaStatusFilter;
      const matchMonth =
        !agendaMonthFilter ||
        (item.tanggalSurat || '').startsWith(agendaMonthFilter) ||
        (item.tanggalTerima || '').startsWith(agendaMonthFilter);
      const q = agendaSearch.toLowerCase();
      const matchQ =
        !q ||
        (item.nomorAgenda || '').toLowerCase().includes(q) ||
        item.nomorSurat.toLowerCase().includes(q) ||
        item.perihal.toLowerCase().includes(q) ||
        item.asalTujuan.toLowerCase().includes(q) ||
        (item.disposisi || '').toLowerCase().includes(q) ||
        (item.catatan || '').toLowerCase().includes(q);
      return matchDir && matchStatus && matchMonth && matchQ;
    });
  }, [agendaList, agendaFilter, agendaStatusFilter, agendaMonthFilter, agendaSearch]);

  const handleExportAgendaCsv = () => {
    const headers = [
      'No',
      'Jenis',
      'No Agenda',
      'Nomor Surat',
      'Tanggal Surat',
      'Tanggal Terima',
      'Asal / Tujuan',
      'Perihal',
      'Disposisi',
      'Status',
      'Catatan'
    ];
    const escapeCsv = (val?: string) => `"${String(val || '').replace(/"/g, '""')}"`;
    const rows = filteredAgenda.map((item, idx) =>
      [
        idx + 1,
        escapeCsv(item.direction),
        escapeCsv(item.nomorAgenda),
        escapeCsv(item.nomorSurat),
        escapeCsv(item.tanggalSurat),
        escapeCsv(item.tanggalTerima),
        escapeCsv(item.asalTujuan),
        escapeCsv(item.perihal),
        escapeCsv(item.disposisi),
        escapeCsv(item.statusTindakLanjut),
        escapeCsv(item.catatan)
      ].join(',')
    );
    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Buku_Agenda_Surat_${agendaFilter}_${agendaMonthFilter || 'Semua'}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    onNotice('success', 'File Excel/CSV Buku Agenda Surat berhasil diunduh.');
  };

  const buildAgendaRekapHtml = () => {
    const logoPgri = localStorage.getItem('logo-pgri') || localStorage.getItem('logo-kombel') || '';
    const ttdKetua = localStorage.getItem('ttd-ketua') || '';
    const ttdKetuaScale = Math.max(0.3, Math.min(2.5, (Number(localStorage.getItem('ttd-ketua-size')) || 100) / 100));
    const ttdSekretaris = localStorage.getItem('ttd-sekretaris') || '';
    const ttdSekretarisScale = Math.max(0.3, Math.min(2.5, (Number(localStorage.getItem('ttd-sekretaris-size')) || 100) / 100));
    const stempel = localStorage.getItem('logo-stempel') || '';
    const stempelScale = Math.max(0.3, Math.min(2.5, (Number(localStorage.getItem('logo-stempel-size')) || 100) / 100));
    const stempelRotation = Number(localStorage.getItem('logo-stempel-rotation')) || 0;
    const { namaKetua, npaKetua, namaSekretaris, npaSekretaris } = resolveEOfficeSigners();
    const todayStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const rekapHeading =
      agendaFilter === 'Masuk'
        ? 'BUKU AGENDA SURAT MASUK'
        : agendaFilter === 'Keluar'
          ? 'BUKU AGENDA SURAT KELUAR'
          : 'BUKU AGENDA SURAT (MASUK & KELUAR)';
    const verifyText = `${rekapHeading} PGRI RANTING GELANG | Total: ${filteredAgenda.length} | Cetak: ${todayStr}`;
    const qrUrl = generateQrSvgDataUrl(verifyText, 140);

    const tableHeadHtml =
      agendaFilter === 'Masuk'
        ? `<tr>
            <th style="width:28px">No</th>
            <th style="width:74px">No. Agenda</th>
            <th style="width:74px">Tgl. Terima</th>
            <th style="width:120px">No. &amp; Tgl. Surat</th>
            <th>Pengirim</th>
            <th>Perihal</th>
            <th style="width:120px">Disposisi / Status</th>
          </tr>`
        : agendaFilter === 'Keluar'
          ? `<tr>
              <th style="width:28px">No</th>
              <th style="width:76px">No. Agenda</th>
              <th style="width:76px">Tgl. Surat</th>
              <th style="width:130px">Nomor Surat</th>
              <th>Tujuan Surat</th>
              <th>Perihal</th>
              <th style="width:110px">Keterangan</th>
            </tr>`
          : `<tr>
              <th style="width:28px">No</th>
              <th style="width:58px">Jenis</th>
              <th style="width:76px">Tgl. Surat</th>
              <th style="width:125px">Nomor Surat</th>
              <th>Asal / Tujuan</th>
              <th>Perihal</th>
              <th style="width:110px">Ket. / Disposisi</th>
            </tr>`;

    const tableBodyHtml =
      filteredAgenda.length > 0
        ? filteredAgenda
            .map((item, idx) => {
              if (agendaFilter === 'Masuk') {
                const statusBadge = item.statusTindakLanjut || 'Baru';
                const dispText = [item.disposisi, item.catatan].filter(Boolean).join(' • ');
                return `<tr>
                  <td style="text-align:center">${idx + 1}</td>
                  <td style="text-align:center">${escapeHtml(item.nomorAgenda || '-')}</td>
                  <td style="text-align:center">${escapeHtml(formatAgendaDateShort(item.tanggalTerima || item.tanggalSurat))}</td>
                  <td><div>${escapeHtml(item.nomorSurat)}</div><div style="font-size:8.5pt;color:#444;">Tgl: ${escapeHtml(formatAgendaDateShort(item.tanggalSurat))}</div></td>
                  <td>${escapeHtml(item.asalTujuan)}</td>
                  <td>${escapeHtml(item.perihal)}</td>
                  <td><div><strong>[${escapeHtml(statusBadge)}]</strong></div>${dispText ? `<div style="font-size:8.5pt;margin-top:2px;">${escapeHtml(dispText)}</div>` : ''}</td>
                </tr>`;
              }
              if (agendaFilter === 'Keluar') {
                return `<tr>
                  <td style="text-align:center">${idx + 1}</td>
                  <td style="text-align:center">${escapeHtml(item.nomorAgenda || '-')}</td>
                  <td style="text-align:center">${escapeHtml(formatAgendaDateShort(item.tanggalSurat))}</td>
                  <td>${escapeHtml(item.nomorSurat)}</td>
                  <td>${escapeHtml(item.asalTujuan)}</td>
                  <td>${escapeHtml(item.perihal)}</td>
                  <td>${escapeHtml(item.catatan || '-')}</td>
                </tr>`;
              }
              const ketText =
                item.direction === 'Masuk'
                  ? `[${item.statusTindakLanjut || 'Baru'}] ${[item.disposisi, item.catatan].filter(Boolean).join(' • ')}`.trim()
                  : item.catatan || '-';
              return `<tr>
                <td style="text-align:center">${idx + 1}</td>
                <td style="text-align:center">${escapeHtml(item.direction)}</td>
                <td style="text-align:center">${escapeHtml(formatAgendaDateShort(item.tanggalSurat))}</td>
                <td>${escapeHtml(item.nomorSurat)}</td>
                <td>${escapeHtml(item.asalTujuan)}</td>
                <td>${escapeHtml(item.perihal)}</td>
                <td style="font-size:8.5pt;">${escapeHtml(ketText || '-')}</td>
              </tr>`;
            })
            .join('')
        : `<tr><td colspan="7" style="text-align:center; color:#666;">(Belum ada data surat pada filter ini)</td></tr>`;

    return `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>${escapeHtml(rekapHeading)}</title>
      <style>
        @page { size: A4 portrait; margin: 0; }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: transparent; }
        .sheet-a4 {
          width: 210mm;
          min-height: 297mm;
          margin: 0 auto;
          background: #ffffff;
          color: #000000;
          padding: 14mm 15mm 14mm 15mm;
          font-family: 'Times New Roman', Times, serif;
          font-size: 10.5pt;
          line-height: 1.4;
          display: flex;
          flex-direction: column;
        }
        .content-body { flex: 1; }
        .kop { display: flex; align-items: center; gap: 14px; padding-bottom: 6px; position: relative; z-index: 2; font-family: 'Times New Roman', Times, serif; }
        .kop-logo-wrap { width: 94px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
        .kop-logo-wrap img { width: 92px; height: 92px; object-fit: contain; display: block; }
        .kop-logo-placeholder { width: 92px; height: 92px; border: 1.5px dashed #94a3b8; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9pt; color: #64748b; text-align: center; }
        .kop-text { flex: 1; text-align: center; line-height: 1.18; color: #000000; padding-left: 8px; }
        .kop-text .org-main { font-size: 13pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.3px; }
        .kop-text .sub-org { font-size: 10.5pt; font-weight: bold; font-style: italic; margin-top: 1px; }
        .kop-text .ranting-main { font-size: 16.5pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 1px; }
        .kop-text .wilayah { font-size: 12pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.3px; margin-top: 1px; }
        .kop-text .sekretariat { font-size: 8.5pt; font-style: italic; margin-top: 2px; }
        .kop-divider { border-top: 2px solid #000000; border-bottom: 1px solid #000000; height: 2px; margin-bottom: 16px; position: relative; z-index: 2; }
        h3 { text-align: center; text-decoration: underline; margin: 10px 0 4px; font-size: 12.5pt; }
        .sub { text-align: center; font-size: 9.5pt; margin-bottom: 12px; }
        table { width: 100%; border-collapse: collapse; font-size: 9pt; }
        th, td { border: 1px solid #000; padding: 5px 6px; vertical-align: top; word-break: break-word; }
        th { background: #f3f4f6; text-align: center; }
        .ttd-grid { display: flex; justify-content: space-between; align-items: flex-end; position: relative; margin-top: 24px; }
        .ttd-col { width: 220px; text-align: center; position: relative; }
        .ttd-space { height: 68px; position: relative; display: flex; align-items: center; justify-content: center; overflow: visible; }
        .stempel-center { position: absolute; left: 50%; transform: translateX(-50%); bottom: 6px; width: 96px; opacity: 0.88; mix-blend-mode: multiply; pointer-events: none; }
        @media print {
          html, body { background: #ffffff; }
          .sheet-a4 { width: 210mm; min-height: 297mm; margin: 0; box-shadow: none; }
        }
      </style></head><body>
      <div class="sheet-a4">
        <div class="content-body">
          <div class="kop">
            <div class="kop-logo-wrap">
              ${logoPgri ? `<img src="${logoPgri}" alt="Logo PGRI" />` : `<div class="kop-logo-placeholder">Logo<br/>PGRI</div>`}
            </div>
            <div class="kop-text">
              <div class="org-main">${escapeHtml(orgConfig.kopOrganisasi)}</div>
              <div class="sub-org">(Teachers Association Of Republic Indonesia)</div>
              <div class="ranting-main">${escapeHtml(orgConfig.kopRanting)}</div>
              <div class="wilayah">${escapeHtml(orgConfig.kopWilayah)}</div>
              <div class="sekretariat">${escapeHtml(orgConfig.kopSekretariat)}</div>
            </div>
          </div>
          <div class="kop-divider"></div>
          <h3>${escapeHtml(rekapHeading)}</h3>
          <div class="sub">Dicetak pada: ${escapeHtml(todayStr)} • Total: ${filteredAgenda.length} Surat${agendaFilter === 'Masuk' && agendaStatusFilter !== 'Semua' ? ` • Status: ${escapeHtml(agendaStatusFilter)}` : ''}</div>
          <table>
            <thead>
              ${tableHeadHtml}
            </thead>
            <tbody>
              ${tableBodyHtml}
            </tbody>
          </table>
        </div>
        <div>
          <div style="text-align:right; margin-bottom:6px; padding-right:24px;">Sumberbaru, ${escapeHtml(todayStr)}</div>
          <div class="ttd-grid">
            <div class="ttd-col">
              <div>Ketua</div>
              <div>PGRI Ranting Gelang</div>
              <div class="ttd-space">
                ${ttdKetua ? `<img src="${ttdKetua}" style="height:${Math.round(62 * ttdKetuaScale)}px; width:auto; max-width:${Math.round(160 * ttdKetuaScale)}px; object-fit:contain;" alt="TTD Ketua" />` : ''}
              </div>
              <div style="font-weight:bold; text-decoration:underline;">${escapeHtml(namaKetua)}</div>
              <div style="font-size:10pt;">NPA. ${escapeHtml(npaKetua)}</div>
            </div>
            ${stempel ? `<img src="${stempel}" class="stempel-center" style="width:${Math.round(112 * stempelScale)}px; height:${Math.round(112 * stempelScale)}px; object-fit:contain; transform:translateX(-50%) rotate(${stempelRotation}deg);" alt="Stempel" />` : ''}
            <div class="ttd-col">
              <div>Sekretaris</div>
              <div>PGRI Ranting Gelang</div>
              <div class="ttd-space">
                ${ttdSekretaris ? `<img src="${ttdSekretaris}" style="height:${Math.round(62 * ttdSekretarisScale)}px; width:auto; max-width:${Math.round(160 * ttdSekretarisScale)}px; object-fit:contain;" alt="TTD Sekretaris" />` : ''}
              </div>
              <div style="font-weight:bold; text-decoration:underline;">${escapeHtml(namaSekretaris)}</div>
              <div style="font-size:10pt;">NPA. ${escapeHtml(npaSekretaris)}</div>
            </div>
          </div>
          <div style="margin-top:16px; display:flex; justify-content:flex-end;">
            <div style="width:96px; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; font-size:8.5pt; color:#334155;">
              <img src="${qrUrl}" alt="QR Verifikasi" style="width:58px; height:58px; border:1px solid #cbd5e1; padding:3px; background:#fff; display:block; margin:0 auto;" />
              <div style="margin-top:4px; width:100%; text-align:center; line-height:1.2;">Verifikasi Surat</div>
            </div>
          </div>
        </div>
      </div>
      </body></html>`;
  };

  // =========================================================================
  // 3. NOTULEN & BERITA ACARA RAPAT
  // =========================================================================
  const [notulenList, setNotulenList] = useState<NotulenItem[]>(() => {
    try {
      const raw = localStorage.getItem(NOTULEN_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [editingNotulenId, setEditingNotulenId] = useState<string | null>(null);
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<
    | { type: 'agenda'; item: SuratAgendaItem }
    | { type: 'notulen'; item: NotulenItem }
    | null
  >(null);
  const createEmptyNotulenForm = () => ({
    eventId: '',
    eventTitle: '',
    tanggal: new Date().toISOString().split('T')[0],
    waktu: '08.00 - Selesai WIB',
    tempat: 'SDN Gelang 03',
    pimpinanRapat: 'Ketua PGRI Ranting Gelang',
    notulis: 'Sekretaris PGRI Ranting Gelang',
    jumlahHadir: 0,
    agenda: '',
    keputusan: '',
    tindakLanjut: ''
  });
  const [notulenForm, setNotulenForm] = useState(createEmptyNotulenForm);

  useEffect(() => {
    try {
      localStorage.setItem(NOTULEN_STORAGE_KEY, JSON.stringify(notulenList));
    } catch {}
  }, [notulenList]);

  const handleSelectEventForNotulen = (eventId: string) => {
    const evt = events.find((e) => e.id === eventId);
    if (!evt) {
      setNotulenForm((prev) => ({ ...prev, eventId: '' }));
      return;
    }
    const hadirCount = attendanceList.filter(
      (a) =>
        (a.eventId === evt.id ||
          (a.eventTitle && evt.title && a.eventTitle.trim().toLowerCase() === evt.title.trim().toLowerCase())) &&
        (a.status === 'Hadir' || a.status === 'Verifikasi')
    ).length;

    setNotulenForm((prev) => ({
      ...prev,
      eventId: evt.id,
      eventTitle: evt.title,
      waktu: evt.time || prev.waktu,
      tempat: evt.location || prev.tempat,
      jumlahHadir: hadirCount
    }));
  };

  const handleEditNotulen = (item: NotulenItem) => {
    if (!isAdmin) return;
    setEditingNotulenId(item.id);
    setNotulenForm({
      eventId: item.eventId || '',
      eventTitle: item.eventTitle || '',
      tanggal: item.tanggal || new Date().toISOString().split('T')[0],
      waktu: item.waktu || '08.00 - Selesai WIB',
      tempat: item.tempat || 'SDN Gelang 03',
      pimpinanRapat: item.pimpinanRapat || 'Ketua PGRI Ranting Gelang',
      notulis: item.notulis || 'Sekretaris PGRI Ranting Gelang',
      jumlahHadir: item.jumlahHadir || 0,
      agenda: item.agenda || '',
      keputusan: item.keputusan || '',
      tindakLanjut: item.tindakLanjut || ''
    });
    setPreviewNotulenId(null);
    onNotice('success', `Mode edit aktif untuk notulen "${item.eventTitle}".`);
  };

  const handleCancelEditNotulen = () => {
    setEditingNotulenId(null);
    setNotulenForm(createEmptyNotulenForm());
  };

  const handleDeleteNotulen = async (item: NotulenItem) => {
    if (!isAdmin) return;
    if (editingNotulenId === item.id) {
      setEditingNotulenId(null);
      setNotulenForm(createEmptyNotulenForm());
    }
    if (previewNotulenId === item.id) {
      setPreviewNotulenId(null);
    }
    const updated = notulenList.filter((x) => x.id !== item.id);
    setNotulenList(updated);

    const res = await mutateCloudCollection<NotulenItem>(
      'notulen',
      [NOTULEN_STORAGE_KEY],
      (latest) => latest.filter((x) => x.id !== item.id),
      updated,
      'Notulen Rapat'
    );
    setNotulenList(res.items);
    if (res.success) {
      void logAuditEvent('Notulen Rapat', 'Hapus Berita Acara', `Menghapus notulen "${item.eventTitle}" (${item.tanggal}).`);
      onNotice('success', `Notulen "${item.eventTitle}" berhasil dihapus.`);
    } else {
      onNotice('error', res.error || 'Notulen terhapus lokal, namun gagal sinkron ke Cloud.');
    }
  };

  const handleAddNotulen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !notulenForm.eventTitle.trim() || !notulenForm.keputusan.trim()) return;

    const isEditing = Boolean(editingNotulenId);
    const item: NotulenItem = {
      ...notulenForm,
      id: editingNotulenId || `notulen-${Date.now()}`,
      updatedAt: new Date().toISOString()
    };
    const updated = isEditing
      ? notulenList.map((x) => (x.id === item.id ? item : x))
      : [item, ...notulenList];
    setNotulenList(updated);

    const res = await mutateCloudCollection<NotulenItem>(
      'notulen',
      [NOTULEN_STORAGE_KEY],
      (latest) =>
        isEditing
          ? latest.some((x) => x.id === item.id)
            ? latest.map((x) => (x.id === item.id ? item : x))
            : [item, ...latest]
          : [item, ...latest.filter((x) => x.id !== item.id)],
      updated,
      'Notulen Rapat'
    );
    setNotulenList(res.items);
    await logAuditEvent(
      'Notulen Rapat',
      isEditing ? 'Edit Berita Acara' : 'Simpan Berita Acara',
      `${isEditing ? 'Memperbarui' : 'Menyimpan'} notulen "${item.eventTitle}" (${item.jumlahHadir} hadir).`
    );

    setEditingNotulenId(null);
    setNotulenForm(createEmptyNotulenForm());
    onNotice(
      'success',
      isEditing
        ? 'Perubahan Notulen & Berita Acara Rapat berhasil disimpan.'
        : 'Notulen & Berita Acara Rapat berhasil disimpan.'
    );
  };

  const [previewNotulenId, setPreviewNotulenId] = useState<string | null>(null);

  const renderEofficeDeleteModal = () => {
    if (!confirmDeleteTarget) return null;
    const isAgenda = confirmDeleteTarget.type === 'agenda';
    const titleLabel = isAgenda
      ? `Surat ${confirmDeleteTarget.item.direction} No. ${confirmDeleteTarget.item.nomorSurat}`
      : confirmDeleteTarget.item.eventTitle;
    return (
      <div
        className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-stone-950/75 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={() => setConfirmDeleteTarget(null)}
      >
        <div
          className={`w-full max-w-md rounded-2xl p-6 border shadow-2xl space-y-4 ${cardClass}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-3 text-red-700 dark:text-red-400">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isDark ? 'bg-red-950/70 border border-red-800/60' : 'bg-red-50 border border-red-200'}`}>
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-display font-bold text-base">
                {isAgenda ? 'Konfirmasi Hapus Catatan Surat' : 'Konfirmasi Hapus Notulen'}
              </h3>
              <p className="text-xs opacity-80">Data akan dihapus dari perangkat dan Cloud.</p>
            </div>
          </div>
          <p className={`text-sm ${isDark ? 'text-stone-300' : 'text-stone-600'}`}>
            Apakah Anda yakin ingin menghapus <span className="font-bold">&quot;{titleLabel}&quot;</span>?
          </p>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => setConfirmDeleteTarget(null)}
              className={`flex-1 px-4 py-2.5 rounded-xl font-bold text-xs cursor-pointer ${
                isDark ? 'bg-stone-800 hover:bg-stone-700 text-stone-300' : 'bg-stone-100 hover:bg-stone-200 text-stone-700'
              }`}
            >
              Batal
            </button>
            <button
              type="button"
              onClick={() => {
                const target = confirmDeleteTarget;
                setConfirmDeleteTarget(null);
                if (target.type === 'agenda') {
                  void handleDeleteAgenda(target.item.id);
                } else {
                  void handleDeleteNotulen(target.item);
                }
              }}
              className="flex-1 px-4 py-2.5 rounded-xl bg-red-800 hover:bg-red-700 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span>Ya, Hapus</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  const buildNotulenHtml = (item: Omit<NotulenItem, 'id' | 'updatedAt'>) => {
    const logoPgri = localStorage.getItem('logo-pgri') || localStorage.getItem('logo-kombel') || '';
    const ttdKetua = localStorage.getItem('ttd-ketua') || '';
    const ttdKetuaScale = Math.max(0.3, Math.min(2.5, (Number(localStorage.getItem('ttd-ketua-size')) || 100) / 100));
    const ttdSekretaris = localStorage.getItem('ttd-sekretaris') || '';
    const ttdSekretarisScale = Math.max(0.3, Math.min(2.5, (Number(localStorage.getItem('ttd-sekretaris-size')) || 100) / 100));
    const stempel = localStorage.getItem('logo-stempel') || '';
    const stempelScale = Math.max(0.3, Math.min(2.5, (Number(localStorage.getItem('logo-stempel-size')) || 100) / 100));
    const stempelRotation = Number(localStorage.getItem('logo-stempel-rotation')) || 0;
    const { namaKetua, npaKetua, namaSekretaris, npaSekretaris } = resolveEOfficeSigners();
    const formattedTanggalId = (() => {
      if (!item.tanggal) return '';
      const parsed = new Date(`${item.tanggal}T00:00:00`);
      if (!isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      }
      return item.tanggal;
    })();
    const formattedTanggalHariId = (() => {
      if (!item.tanggal) return '';
      const parsed = new Date(`${item.tanggal}T00:00:00`);
      if (!isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString('id-ID', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        });
      }
      return item.tanggal;
    })();
    const verifyText = `NOTULEN RAPAT PGRI RANTING GELANG | ${item.eventTitle || 'Draft Rapat'} | Tgl: ${item.tanggal}`;
    const qrUrl = generateQrSvgDataUrl(verifyText, 140);
    return `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>Notulen - ${escapeHtml(item.eventTitle || 'Draft Rapat')}</title>
      <style>
        @page { size: A4 portrait; margin: 0; }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: transparent; }
        .sheet-a4 {
          width: 210mm;
          min-height: 297mm;
          margin: 0 auto;
          background: #ffffff;
          color: #000000;
          padding: 14mm 18mm 14mm 18mm;
          font-family: 'Times New Roman', Times, serif;
          font-size: 11.5pt;
          line-height: 1.5;
          display: flex;
          flex-direction: column;
        }
        .content-body { flex: 1; }
        .kop { display: flex; align-items: center; gap: 14px; padding-bottom: 6px; position: relative; z-index: 2; font-family: 'Times New Roman', Times, serif; }
        .kop-logo-wrap { width: 94px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
        .kop-logo-wrap img { width: 92px; height: 92px; object-fit: contain; display: block; }
        .kop-logo-placeholder { width: 92px; height: 92px; border: 1.5px dashed #94a3b8; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9pt; color: #64748b; text-align: center; }
        .kop-text { flex: 1; text-align: center; line-height: 1.18; color: #000000; padding-left: 8px; }
        .kop-text .org-main { font-size: 13pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.3px; }
        .kop-text .sub-org { font-size: 10.5pt; font-weight: bold; font-style: italic; margin-top: 1px; }
        .kop-text .ranting-main { font-size: 16.5pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 1px; }
        .kop-text .wilayah { font-size: 12pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.3px; margin-top: 1px; }
        .kop-text .sekretariat { font-size: 8.5pt; font-style: italic; margin-top: 2px; }
        .kop-divider { border-top: 2px solid #000000; border-bottom: 1px solid #000000; height: 2px; margin-bottom: 18px; position: relative; z-index: 2; }
        h3 { text-align: center; text-decoration: underline; margin: 14px 0; }
        .box { border: 1px solid #000; padding: 10px 14px; margin: 8px 0 12px; min-height: 58px; white-space: pre-line; }
        .ttd-grid { display: flex; justify-content: space-between; align-items: flex-end; position: relative; margin-top: 20px; }
        .ttd-col { width: 220px; text-align: center; position: relative; }
        .ttd-space { height: 68px; position: relative; display: flex; align-items: center; justify-content: center; overflow: visible; }
        .stempel-center { position: absolute; left: 50%; transform: translateX(-50%); bottom: 6px; width: 96px; opacity: 0.88; mix-blend-mode: multiply; pointer-events: none; }
        @media print {
          html, body { background: #ffffff; }
          .sheet-a4 { width: 210mm; min-height: 297mm; margin: 0; box-shadow: none; }
        }
      </style></head><body>
      <div class="sheet-a4">
        <div class="content-body">
          <div class="kop">
            <div class="kop-logo-wrap">
              ${logoPgri ? `<img src="${logoPgri}" alt="Logo" />` : `<div class="kop-logo-placeholder">Logo<br/>PGRI</div>`}
            </div>
            <div class="kop-text">
              <div class="org-main">${escapeHtml(orgConfig.kopOrganisasi)}</div>
              <div class="sub-org">(Teachers Association Of Republic Indonesia)</div>
              <div class="ranting-main">${escapeHtml(orgConfig.kopRanting)}</div>
              <div class="wilayah">${escapeHtml(orgConfig.kopWilayah)}</div>
              <div class="sekretariat">${escapeHtml(orgConfig.kopSekretariat)}</div>
            </div>
          </div>
          <div class="kop-divider"></div>
          <h3>NOTULEN &amp; BERITA ACARA RAPAT</h3>
          <table style="width:100%; margin-bottom:14px;">
            <tr><td style="width:160px">Judul Rapat</td><td>: <strong>${escapeHtml(item.eventTitle || '(Judul Rapat Belum Diisi)')}</strong></td></tr>
            <tr><td>Tanggal / Lokasi</td><td>: ${escapeHtml(formattedTanggalHariId)} / ${escapeHtml(item.tempat)}</td></tr>
            <tr><td>Pimpinan Rapat</td><td>: ${escapeHtml(item.pimpinanRapat)}</td></tr>
            <tr><td>Notulis</td><td>: ${escapeHtml(item.notulis)}</td></tr>
            <tr><td>Jumlah Hadir</td><td>: ${item.jumlahHadir} Orang</td></tr>
          </table>
          <strong>1. Agenda &amp; Ringkasan Pembahasan:</strong>
          <div class="box">${escapeHtml(item.agenda || '-')}</div>
          <strong>2. Keputusan Rapat:</strong>
          <div class="box">${escapeHtml(item.keputusan || '(Keputusan rapat belum diisi)')}</div>
          <strong>3. Rencana Tindak Lanjut (RTL):</strong>
          <div class="box">${escapeHtml(item.tindakLanjut || '-')}</div>
        </div>
        <div>
          <div style="text-align:right; margin-bottom:6px; padding-right:24px;">Sumberbaru, ${escapeHtml(formattedTanggalId)}</div>
          <div class="ttd-grid">
            <div class="ttd-col">
              <div>Ketua</div>
              <div>PGRI Ranting Gelang</div>
              <div class="ttd-space">
                ${ttdKetua ? `<img src="${ttdKetua}" style="height:${Math.round(62 * ttdKetuaScale)}px; width:auto; max-width:${Math.round(160 * ttdKetuaScale)}px; object-fit:contain;" alt="TTD Ketua" />` : ''}
              </div>
              <div style="font-weight:bold; text-decoration:underline;">${escapeHtml(namaKetua)}</div>
              <div style="font-size:10pt;">NPA. ${escapeHtml(npaKetua)}</div>
            </div>
            ${stempel ? `<img src="${stempel}" class="stempel-center" style="width:${Math.round(112 * stempelScale)}px; height:${Math.round(112 * stempelScale)}px; object-fit:contain; transform:translateX(-50%) rotate(${stempelRotation}deg);" alt="Stempel" />` : ''}
            <div class="ttd-col">
              <div>Sekretaris</div>
              <div>PGRI Ranting Gelang</div>
              <div class="ttd-space">
                ${ttdSekretaris ? `<img src="${ttdSekretaris}" style="height:${Math.round(62 * ttdSekretarisScale)}px; width:auto; max-width:${Math.round(160 * ttdSekretarisScale)}px; object-fit:contain;" alt="TTD Sekretaris" />` : ''}
              </div>
              <div style="font-weight:bold; text-decoration:underline;">${escapeHtml(namaSekretaris)}</div>
              <div style="font-size:10pt;">NPA. ${escapeHtml(npaSekretaris)}</div>
            </div>
          </div>
          <div style="margin-top:16px; display:flex; justify-content:flex-end;">
            <div style="width:96px; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; font-size:8.5pt; color:#334155;">
              <img src="${qrUrl}" alt="QR Verifikasi" style="width:58px; height:58px; border:1px solid #cbd5e1; padding:3px; background:#fff; display:block; margin:0 auto;" />
              <div style="margin-top:4px; width:100%; text-align:center; line-height:1.2;">Verifikasi Surat</div>
            </div>
          </div>
        </div>
      </div>
      </body></html>`;
  };

  const handleExportNotulen = async (item: Omit<NotulenItem, 'id' | 'updatedAt'>) => {
    if (isExportingEofficePdf) return;
    setIsExportingEofficePdf(true);
    try {
      const html = buildNotulenHtml(item);
      await exportFullHtmlToPdfOrPrint(html, {
        filename: `Notulen_${(item.eventTitle || 'Rapat').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
        orientation: 'portrait'
      });
      onNotice(
        'success',
        isMobileDevice()
          ? 'File PDF Notulen & Berita Acara berhasil diunduh.'
          : 'Jendela cetak Notulen & Berita Acara dibuka.'
      );
    } finally {
      setIsExportingEofficePdf(false);
    }
  };

  if (mode === 'surat_tugas') {
    return (
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* KIRI: KOTAK PENGISIAN */}
        <div className={`xl:col-span-5 rounded-2xl border p-5 space-y-4 ${cardClass}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className={`p-2 rounded-xl border ${isDark ? 'bg-red-950/70 border-red-800/60 text-amber-400' : 'bg-red-50 border-red-200 text-red-800'}`}>
                <FileCheck2 className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-display text-sm font-bold">Editor Surat Tugas / Delegasi</h2>
                <p className={`text-[11px] ${isDark ? 'text-stone-400' : 'text-stone-500'}`}>
                  Isi data di bawah, pratinjau langsung diperbarui.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setStNomor(buildAutoLetterNumber('ST', agendaList.length))}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border shrink-0 cursor-pointer transition-colors ${isDark ? 'bg-stone-800 border-stone-700 text-stone-200 hover:bg-stone-700' : 'bg-[#faf8f5] border-stone-200 text-stone-700 hover:bg-stone-100'}`}
            >
              Auto Nomor
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className={labelClass}>Nomor Surat Tugas</label>
              <input value={stNomor} onChange={(e) => setStNomor(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Dasar Penugasan</label>
              <textarea rows={2} value={stDasar} onChange={(e) => setStDasar(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Keperluan / Tugas</label>
              <textarea rows={2} value={stKeperluan} onChange={(e) => setStKeperluan(e.target.value)} className={inputClass} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Hari</label>
                <input value={stHari} onChange={(e) => setStHari(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Tanggal Pelaksanaan</label>
                <input value={stTanggal} onChange={(e) => setStTanggal(e.target.value)} className={inputClass} />
              </div>
            </div>
            <div>
              <label className={labelClass}>Tempat Pelaksanaan</label>
              <input value={stTempat} onChange={(e) => setStTempat(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Pilih Anggota Delegasi ({selectedDelegates.length} terpilih)</label>
              <div className={`max-h-48 overflow-y-auto rounded-2xl border p-2.5 space-y-1.5 ${isDark ? 'bg-stone-950 border-stone-800' : 'bg-[#faf8f5] border-stone-200'}`}>
                {teachers.map((t) => {
                  const checked = stSelectedIds.includes(t.id);
                  return (
                    <label key={t.id} className={`flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl cursor-pointer text-xs ${checked ? (isDark ? 'bg-red-950/70 text-amber-200 border border-red-800/50' : 'bg-red-50 text-red-900 border border-red-200') : ''}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <input type="checkbox" checked={checked} onChange={() => toggleDelegate(t.id)} className="accent-red-800 dark:accent-amber-500" />
                        <span className="font-semibold truncate">{t.name}</span>
                      </div>
                      <span className="text-[10px] text-stone-400 shrink-0">{t.school}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div>
              <label className={labelClass}>Tambah Nama Delegasi Manual (opsional, 1 nama per baris)</label>
              <textarea rows={2} value={stManualNama} onChange={(e) => setStManualNama(e.target.value)} placeholder="Nama delegasi tambahan..." className={inputClass} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold">Daftar Tembusan</label>
                <button
                  type="button"
                  onClick={() => setStTembusanList([...stTembusanList, ''])}
                  className="text-xs font-semibold text-red-800 dark:text-amber-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Tambah
                </button>
              </div>
              <div className="space-y-2">
                {stTembusanList.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-xs font-bold w-5 text-stone-400">{idx + 1}.</span>
                    <input
                      type="text"
                      className={inputClass}
                      value={item}
                      onChange={(e) => {
                        const next = [...stTembusanList];
                        next[idx] = e.target.value;
                        setStTembusanList(next);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setStTembusanList(stTembusanList.filter((_, i) => i !== idx))
                      }
                      className="p-2 text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* KANAN: KOTAK PREVIEW */}
        <div className={`xl:col-span-7 rounded-2xl border p-5 space-y-3 xl:sticky xl:top-4 ${cardClass}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 font-display text-xs sm:text-sm font-bold">
                <Eye className="w-4 h-4 text-red-800 dark:text-amber-400" />
                <span>Pratinjau Langsung Dokumen Surat Tugas (A4)</span>
              </div>
              <p className={`text-[11px] ${isDark ? 'text-stone-400' : 'text-stone-500'}`}>
                Tampilan di bawah ini identik dengan hasil dokumen yang akan diunduh / dicetak.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setStShowTtdStempel((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border cursor-pointer transition-colors ${
                  stShowTtdStempel
                    ? isDark
                      ? 'bg-emerald-950/50 border-emerald-700/60 text-emerald-300'
                      : 'bg-emerald-50 border-emerald-300 text-emerald-800'
                    : isDark
                      ? 'bg-stone-800 border-stone-700 text-stone-300'
                      : 'bg-[#faf8f5] border-stone-200 text-stone-600'
                }`}
                title="Sembunyikan jika ingin mencetak kosong untuk tanda tangan & stempel basah"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>{stShowTtdStempel ? 'TTD & Stempel: Tampil' : 'TTD & Stempel: Basah'}</span>
              </button>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    const nextNum = buildAutoLetterNumber('ST', archiveCount + agendaList.length);
                    setStNomor(nextNum);
                    onNotice('success', `Nomor Surat Tugas otomatis diterapkan: ${nextNum}`);
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border cursor-pointer transition-colors ${
                    isDark ? 'bg-stone-800 border-stone-700 text-stone-200 hover:bg-stone-700' : 'bg-[#faf8f5] border-stone-200 text-stone-700 hover:bg-stone-100'
                  }`}
                >
                  <Hash className="w-3.5 h-3.5" />
                  <span>Auto No. Surat</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const namaDelegasi = [
                    ...selectedDelegates.map((d) => d.name),
                    ...(stManualNama.trim() ? stManualNama.split('\n').map((s) => s.trim()).filter(Boolean) : [])
                  ].join(', ');
                  const msg =
                    `📄 *SURAT TUGAS PGRI RANTING GELANG*\n` +
                    `Nomor: ${stNomor}\n` +
                    `Hari/Tanggal: ${stHari}, ${stTanggal}\n` +
                    `Tempat: ${stTempat}\n` +
                    `Keperluan: ${stKeperluan}\n` +
                    `Delegasi: ${namaDelegasi || '-'}`;
                  openWhatsAppShare(msg);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/25 transition cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Bagikan WA</span>
              </button>
              {isAdmin && (
                <button
                  type="button"
                  disabled={isRecordingQuickAgenda}
                  onClick={async () => {
                    if (isRecordingQuickAgenda) return;
                    setIsRecordingQuickAgenda(true);
                    try {
                      const namaDelegasi = [
                        ...selectedDelegates.map((d) => d.name),
                        ...(stManualNama.trim() ? stManualNama.split('\n').map((s) => s.trim()).filter(Boolean) : [])
                      ].join(', ');
                      const res = await quickRecordOutgoingAgenda({
                        nomorSurat: stNomor,
                        asalTujuan: namaDelegasi || 'Anggota Delegasi PGRI Ranting Gelang',
                        perihal: `Surat Tugas - ${stKeperluan}`,
                        catatan: `Pelaksanaan: ${stHari}, ${stTanggal} di ${stTempat}`
                      });
                      if (!res.ok) {
                        onNotice('error', res.error || 'Gagal mencatat Surat Tugas ke Surat Keluar.');
                      } else if (res.error) {
                        onNotice('error', `Tercatat lokal, namun sinkron Cloud gagal: ${res.error}`);
                      } else {
                        onNotice(
                          'success',
                          res.updatedExisting
                            ? `Surat Tugas No. ${stNomor} diperbarui di Buku Agenda Surat Keluar.`
                            : `Surat Tugas No. ${stNomor} berhasil dicatat ke Buku Agenda Surat Keluar.`
                        );
                      }
                    } finally {
                      setIsRecordingQuickAgenda(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-amber-600/15 text-amber-800 dark:text-amber-300 border border-amber-500/35 hover:bg-amber-600/25 transition cursor-pointer disabled:opacity-60"
                  title="Catat otomatis nomor dan perihal Surat Tugas ini ke Buku Agenda Surat Keluar"
                >
                  {isRecordingQuickAgenda ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookOpen className="w-3.5 h-3.5" />}
                  <span>Catat ke Surat Keluar</span>
                </button>
              )}
              {isAdmin && onSaveArchiveItem && (
                <button
                  type="button"
                  onClick={() => {
                    const base = createInitialDraft(teachers);
                    onSaveArchiveItem({
                      ...base,
                      id: loadedArchiveItem?.docCategory === 'surat_tugas' ? loadedArchiveItem.id : `inv-st-${Date.now()}`,
                      docCategory: 'surat_tugas',
                      title: `Surat Tugas - ${stKeperluan.slice(0, 50)}`,
                      nomorSurat: stNomor,
                      perihal: 'Surat Tugas',
                      hari: stHari,
                      tanggalAcara: stTanggal,
                      tempatAcara: stTempat,
                      acara: stKeperluan,
                      paragrafPembuka: stDasar,
                      tembusanList: stTembusanList,
                      stSelectedIds,
                      stManualNama,
                      showTtdImages: stShowTtdStempel,
                      showStempel: stShowTtdStempel
                    });
                  }}
                  disabled={isSavingCloud}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-700 hover:bg-emerald-600 text-white transition cursor-pointer disabled:opacity-60"
                >
                  {isSavingCloud ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span>Simpan Arsip</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleExportSuratTugas}
                disabled={isExportingEofficePdf}
                className={`px-4 py-2 rounded-xl text-xs font-bold bg-red-800 hover:bg-red-700 text-white flex items-center gap-1.5 transition-colors ${
                  isExportingEofficePdf ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'
                }`}
              >
                {isExportingEofficePdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                <span>{isExportingEofficePdf ? 'Menyiapkan PDF...' : 'Unduh / Cetak PDF'}</span>
              </button>
            </div>
          </div>
          <div className={`rounded-2xl overflow-x-auto ${isDark ? 'bg-stone-950' : 'bg-stone-200/80'} py-4 px-2 sm:px-6`}>
            <iframe
              title="Pratinjau Surat Tugas"
              srcDoc={buildSuratTugasHtml()}
              style={{ width: '210mm', height: '297mm' }}
              className="bg-transparent border-0 shadow-2xl mx-auto block shrink-0"
            />
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'pengawas_ujian') {
    return (
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* KIRI: KOTAK PENGISIAN PENGAWAS UJIAN SILANG */}
        <div className={`xl:col-span-5 rounded-2xl border p-5 space-y-4 ${cardClass}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className={`p-2 rounded-xl border ${isDark ? 'bg-red-950/70 border-red-800/60 text-amber-400' : 'bg-red-50 border-red-200 text-red-800'}`}>
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-display text-sm font-bold">Editor Pengawas Ujian Silang</h2>
                <p className={`text-[11px] ${isDark ? 'text-stone-400' : 'text-stone-500'}`}>
                  Atur penugasan silang pengawas dari SD A ke SD B.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPuNomor(buildAutoLetterNumber('ST', agendaList.length))}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border shrink-0 cursor-pointer transition-colors ${isDark ? 'bg-stone-800 border-stone-700 text-stone-200 hover:bg-stone-700' : 'bg-[#faf8f5] border-stone-200 text-stone-700 hover:bg-stone-100'}`}
            >
              Auto Nomor
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className={labelClass}>Nomor Surat Tugas</label>
              <input value={puNomor} onChange={(e) => setPuNomor(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Nama Kegiatan Ujian</label>
              <input value={puNamaUjian} onChange={(e) => setPuNamaUjian(e.target.value)} className={inputClass} placeholder="Misal: Sumatif Akhir Semester (SAS) Ganjil" />
            </div>
            <div>
              <label className={labelClass}>Dasar Penugasan</label>
              <textarea rows={2} value={puDasar} onChange={(e) => setPuDasar(e.target.value)} className={inputClass} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>Hari</label>
                <input
                  value={puHari}
                  onChange={(e) => setPuHari(e.target.value)}
                  placeholder="Senin - Sabtu"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Tanggal</label>
                <input
                  value={puTanggalPelaksanaan}
                  onChange={(e) => setPuTanggalPelaksanaan(e.target.value)}
                  placeholder="30 November 2026 - 05 Desember 2026"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Waktu Pelaksanaan</label>
                <input value={puWaktu} onChange={(e) => setPuWaktu(e.target.value)} className={inputClass} />
              </div>
            </div>

            {/* Pemilih Guru & Penempatan Silang */}
            <div className={`rounded-2xl border p-3.5 space-y-3 ${isDark ? 'bg-stone-950/60 border-stone-800' : 'bg-[#faf8f5] border-stone-200'}`}>
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-bold">Daftar Pengawas Silang ({puRows.length} Pengawas)</label>
                <button
                  type="button"
                  onClick={handleAddPengawasManual}
                  className="text-xs font-semibold text-red-800 dark:text-amber-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Baris Manual
                </button>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={puSelectedTeacherId}
                  onChange={(e) => setPuSelectedTeacherId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">-- Pilih Guru dari Data Anggota --</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.school})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleAddPengawasFromTeacher}
                  disabled={!puSelectedTeacherId}
                  className="px-3.5 py-2.5 rounded-xl bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold shrink-0 cursor-pointer transition-colors"
                >
                  Tambah
                </button>
              </div>

              {puRows.length === 0 ? (
                <p className="text-[11px] text-stone-400 text-center py-3">
                  Pilih guru di atas atau klik &quot;Baris Manual&quot; untuk mengatur pengawas silang antar sekolah.
                </p>
              ) : (
                <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                  {puRows.map((row, idx) => (
                    <div
                      key={row.id}
                      className={`p-3 rounded-xl border space-y-2 ${isDark ? 'bg-stone-900 border-stone-800' : 'bg-white border-stone-200/90'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-extrabold text-red-800 dark:text-amber-400">
                          Pengawas #{idx + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => removePuRow(row.id)}
                          className="p-1 text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg cursor-pointer"
                          title="Hapus baris"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-semibold text-stone-400 mb-0.5">Nama Pengawas</label>
                          <input
                            value={row.namaPengawas}
                            onChange={(e) => updatePuRow(row.id, 'namaPengawas', e.target.value)}
                            placeholder="Nama Lengkap & Gelar"
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-stone-400 mb-0.5">NPA / NIP</label>
                          <input
                            value={row.nipNpa}
                            onChange={(e) => updatePuRow(row.id, 'nipNpa', e.target.value)}
                            placeholder="NPA / NIP"
                            className={inputClass}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-semibold text-stone-400 mb-0.5">Asal Sekolah (SD A)</label>
                          <input
                            list={`pu-schools-${row.id}`}
                            value={row.asalSekolah}
                            onChange={(e) => updatePuRow(row.id, 'asalSekolah', e.target.value)}
                            placeholder="Sekolah asal pengawas"
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-stone-400 mb-0.5">Tempat Mengawas (SD B)</label>
                          <input
                            list={`pu-schools-${row.id}`}
                            value={row.tempatMengawas}
                            onChange={(e) => updatePuRow(row.id, 'tempatMengawas', e.target.value)}
                            placeholder="Sekolah tujuan mengawas"
                            className={inputClass}
                          />
                        </div>
                        <datalist id={`pu-schools-${row.id}`}>
                          {schoolOptions.map((sc) => (
                            <option key={sc} value={sc} />
                          ))}
                        </datalist>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Daftar Tembusan */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold">Daftar Tembusan</label>
                <button
                  type="button"
                  onClick={() => setPuTembusanList([...puTembusanList, ''])}
                  className="text-xs font-semibold text-red-800 dark:text-amber-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Tambah
                </button>
              </div>
              <div className="space-y-2">
                {puTembusanList.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-xs font-bold w-5 text-stone-400">{idx + 1}.</span>
                    <input
                      type="text"
                      className={inputClass}
                      value={item}
                      onChange={(e) => {
                        const next = [...puTembusanList];
                        next[idx] = e.target.value;
                        setPuTembusanList(next);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setPuTembusanList(puTembusanList.filter((_, i) => i !== idx))}
                      className="p-2 text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* KANAN: KOTAK PREVIEW PENGAWAS UJIAN SILANG */}
        <div className={`xl:col-span-7 rounded-2xl border p-5 space-y-3 xl:sticky xl:top-4 ${cardClass}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 font-display text-xs sm:text-sm font-bold">
                <Eye className="w-4 h-4 text-red-800 dark:text-amber-400" />
                <span>Pratinjau Langsung Pengawas Ujian Silang (A4)</span>
              </div>
              <p className={`text-[11px] ${isDark ? 'text-stone-400' : 'text-stone-500'}`}>
                Tampilan di bawah ini identik dengan hasil dokumen yang akan diunduh / dicetak.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setPuShowTtdStempel((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border cursor-pointer transition-colors ${
                  puShowTtdStempel
                    ? isDark
                      ? 'bg-emerald-950/50 border-emerald-700/60 text-emerald-300'
                      : 'bg-emerald-50 border-emerald-300 text-emerald-800'
                    : isDark
                      ? 'bg-stone-800 border-stone-700 text-stone-300'
                      : 'bg-[#faf8f5] border-stone-200 text-stone-600'
                }`}
                title="Sembunyikan jika ingin mencetak kosong untuk tanda tangan & stempel basah"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>{puShowTtdStempel ? 'TTD & Stempel: Tampil' : 'TTD & Stempel: Basah'}</span>
              </button>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    const nextNum = buildAutoLetterNumber('ST', archiveCount + agendaList.length);
                    setPuNomor(nextNum);
                    onNotice('success', `Nomor Surat Tugas Pengawas Ujian otomatis diterapkan: ${nextNum}`);
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border cursor-pointer transition-colors ${
                    isDark ? 'bg-stone-800 border-stone-700 text-stone-200 hover:bg-stone-700' : 'bg-[#faf8f5] border-stone-200 text-stone-700 hover:bg-stone-100'
                  }`}
                >
                  <Hash className="w-3.5 h-3.5" />
                  <span>Auto No. Surat</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const daftarText = puRows
                    .map(
                      (r, i) =>
                        `${i + 1}. ${r.namaPengawas || '-'} (${r.asalSekolah || '-'}) ➔ Mengawas di *${r.tempatMengawas || '-'}*`
                    )
                    .join('\n');
                  const msg =
                    `📋 *SURAT TUGAS PENGAWAS UJIAN SILANG*\n` +
                    `PGRI Ranting Gelang\n` +
                    `Nomor: ${puNomor}\n` +
                    `Kegiatan: ${puNamaUjian}\n` +
                    `Hari: ${puHari}\n` +
                    `Tanggal: ${puTanggalPelaksanaan} (${puWaktu})\n\n` +
                    `*Daftar Penempatan Silang:*\n${daftarText || '-'}`;
                  openWhatsAppShare(msg);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/25 transition cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Bagikan WA</span>
              </button>
              {isAdmin && (
                <button
                  type="button"
                  disabled={isRecordingQuickAgenda}
                  onClick={async () => {
                    if (isRecordingQuickAgenda) return;
                    setIsRecordingQuickAgenda(true);
                    try {
                      const res = await quickRecordOutgoingAgenda({
                        nomorSurat: puNomor,
                        asalTujuan: `Pengawas Ujian Silang (${puRows.length} Guru)`,
                        perihal: `Surat Tugas Pengawas Ujian Silang - ${puNamaUjian}`,
                        catatan: `Pelaksanaan: ${puHari}, ${puTanggalPelaksanaan} (${puWaktu})`
                      });
                      if (!res.ok) {
                        onNotice('error', res.error || 'Gagal mencatat Pengawas Ujian ke Surat Keluar.');
                      } else if (res.error) {
                        onNotice('error', `Tercatat lokal, namun sinkron Cloud gagal: ${res.error}`);
                      } else {
                        onNotice(
                          'success',
                          res.updatedExisting
                            ? `Surat Tugas Pengawas Ujian No. ${puNomor} diperbarui di Buku Agenda Surat Keluar.`
                            : `Surat Tugas Pengawas Ujian No. ${puNomor} berhasil dicatat ke Buku Agenda Surat Keluar.`
                        );
                      }
                    } finally {
                      setIsRecordingQuickAgenda(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-amber-600/15 text-amber-800 dark:text-amber-300 border border-amber-500/35 hover:bg-amber-600/25 transition cursor-pointer disabled:opacity-60"
                  title="Catat otomatis Surat Tugas Pengawas Ujian ini ke Buku Agenda Surat Keluar"
                >
                  {isRecordingQuickAgenda ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookOpen className="w-3.5 h-3.5" />}
                  <span>Catat ke Surat Keluar</span>
                </button>
              )}
              {isAdmin && onSaveArchiveItem && (
                <button
                  type="button"
                  onClick={() => {
                    const base = createInitialDraft(teachers);
                    onSaveArchiveItem({
                      ...base,
                      id: loadedArchiveItem?.docCategory === 'pengawas_ujian' ? loadedArchiveItem.id : `inv-pu-${Date.now()}`,
                      docCategory: 'pengawas_ujian',
                      title: `Pengawas Ujian Silang - ${puNamaUjian.slice(0, 45)}`,
                      nomorSurat: puNomor,
                      perihal: 'Surat Tugas Pengawas Ujian Silang',
                      hari: puHari,
                      tanggalAcara: puTanggalPelaksanaan,
                      pukul: puWaktu,
                      puWaktu,
                      acara: puNamaUjian,
                      paragrafPembuka: puDasar,
                      tembusanList: puTembusanList,
                      puRows,
                      showTtdImages: puShowTtdStempel,
                      showStempel: puShowTtdStempel
                    });
                  }}
                  disabled={isSavingCloud}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-700 hover:bg-emerald-600 text-white transition cursor-pointer disabled:opacity-60"
                >
                  {isSavingCloud ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span>Simpan Arsip</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleExportPengawasUjian}
                disabled={isExportingEofficePdf}
                className={`px-4 py-2 rounded-xl text-xs font-bold bg-red-800 hover:bg-red-700 text-white flex items-center gap-1.5 transition-colors ${
                  isExportingEofficePdf ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'
                }`}
              >
                {isExportingEofficePdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                <span>{isExportingEofficePdf ? 'Menyiapkan PDF...' : 'Unduh / Cetak PDF'}</span>
              </button>
            </div>
          </div>
          <div className={`rounded-2xl overflow-x-auto ${isDark ? 'bg-stone-950' : 'bg-stone-200/80'} py-4 px-2 sm:px-6`}>
            <iframe
              title="Pratinjau Pengawas Ujian Silang"
              srcDoc={buildPengawasUjianHtml()}
              style={{ width: '210mm', height: '297mm' }}
              className="bg-transparent border-0 shadow-2xl mx-auto block shrink-0"
            />
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'agenda_surat') {
    return (
      <div className="space-y-5">
        {/* RINGKASAN STATISTIK SURAT MASUK & KELUAR */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <button
            type="button"
            onClick={() => {
              setAgendaFilter('Masuk');
              setAgendaStatusFilter('Semua');
            }}
            className={`text-left rounded-2xl border p-4 transition-all cursor-pointer flex items-center justify-between gap-3 ${
              agendaFilter === 'Masuk' && agendaStatusFilter === 'Semua'
                ? isDark
                  ? 'bg-emerald-950/40 border-emerald-600/60 ring-1 ring-emerald-500/40'
                  : 'bg-emerald-50/80 border-emerald-400 ring-1 ring-emerald-300'
                : `${cardClass} hover:border-emerald-500/40`
            }`}
          >
            <div>
              <p className={`text-[11px] font-bold uppercase tracking-wider ${isDark ? 'text-emerald-400' : 'text-emerald-700'}`}>
                Total Surat Masuk
              </p>
              <p className="font-display text-2xl font-extrabold mt-0.5">{agendaStats.totalMasuk}</p>
              <p className={`text-[11px] mt-0.5 ${isDark ? 'text-stone-400' : 'text-stone-500'}`}>
                Surat diterima dari luar
              </p>
            </div>
            <div className={`p-2.5 rounded-xl ${isDark ? 'bg-emerald-500/15 text-emerald-400' : 'bg-emerald-100 text-emerald-700'}`}>
              <Inbox className="w-5 h-5" />
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setAgendaFilter('Keluar');
              setAgendaStatusFilter('Semua');
            }}
            className={`text-left rounded-2xl border p-4 transition-all cursor-pointer flex items-center justify-between gap-3 ${
              agendaFilter === 'Keluar'
                ? isDark
                  ? 'bg-red-950/40 border-red-600/60 ring-1 ring-red-500/40'
                  : 'bg-red-50/80 border-red-400 ring-1 ring-red-300'
                : `${cardClass} hover:border-red-500/40`
            }`}
          >
            <div>
              <p className={`text-[11px] font-bold uppercase tracking-wider ${isDark ? 'text-amber-400' : 'text-red-800'}`}>
                Total Surat Keluar
              </p>
              <p className="font-display text-2xl font-extrabold mt-0.5">{agendaStats.totalKeluar}</p>
              <p className={`text-[11px] mt-0.5 ${isDark ? 'text-stone-400' : 'text-stone-500'}`}>
                Surat diterbitkan ranting
              </p>
            </div>
            <div className={`p-2.5 rounded-xl ${isDark ? 'bg-amber-500/15 text-amber-400' : 'bg-red-100 text-red-800'}`}>
              <Send className="w-5 h-5" />
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setAgendaFilter('Masuk');
              setAgendaStatusFilter('Baru');
            }}
            className={`text-left rounded-2xl border p-4 transition-all cursor-pointer flex items-center justify-between gap-3 ${
              agendaFilter === 'Masuk' && agendaStatusFilter === 'Baru'
                ? isDark
                  ? 'bg-amber-950/40 border-amber-500/60 ring-1 ring-amber-500/40'
                  : 'bg-amber-50/90 border-amber-400 ring-1 ring-amber-300'
                : `${cardClass} hover:border-amber-500/40`
            }`}
          >
            <div>
              <p className={`text-[11px] font-bold uppercase tracking-wider ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>
                Perlu Tindak Lanjut
              </p>
              <p className="font-display text-2xl font-extrabold mt-0.5">{agendaStats.pendingMasuk}</p>
              <p className={`text-[11px] mt-0.5 ${isDark ? 'text-stone-400' : 'text-stone-500'}`}>
                Surat masuk belum selesai
              </p>
            </div>
            <div className={`p-2.5 rounded-xl ${isDark ? 'bg-amber-500/15 text-amber-400' : 'bg-amber-100 text-amber-700'}`}>
              <Clock className="w-5 h-5" />
            </div>
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* KIRI: KOTAK PENGISIAN & DAFTAR AGENDA */}
          <div className="xl:col-span-5 space-y-5">
            {isAdmin && (
              <form
                onSubmit={handleAddAgenda}
                className={`rounded-2xl border p-5 space-y-3.5 ${cardClass} ${
                  editingAgendaId
                    ? isDark
                      ? 'ring-2 ring-amber-500/60 border-amber-500/50'
                      : 'ring-2 ring-amber-400/70 border-amber-400'
                    : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <BookOpen className="w-5 h-5 text-red-800 dark:text-amber-400" />
                    <div>
                      <h2 className="font-display text-sm font-bold">
                        {editingAgendaId
                          ? `Edit Catatan Surat ${newAgenda.direction}`
                          : 'Catat Surat Masuk / Surat Keluar'}
                      </h2>
                      <p className={`text-[11px] ${isDark ? 'text-stone-400' : 'text-stone-500'}`}>
                        {newAgenda.direction === 'Masuk'
                          ? 'Catat nomor surat asli pengirim, tanggal diterima, & disposisi.'
                          : 'Catat surat resmi yang diterbitkan oleh PGRI Ranting Gelang.'}
                      </p>
                    </div>
                  </div>
                  {editingAgendaId && (
                    <button
                      type="button"
                      onClick={handleCancelEditAgenda}
                      className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer transition-colors ${
                        isDark ? 'bg-stone-800 text-stone-300 hover:bg-stone-700' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                      }`}
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Batal</span>
                    </button>
                  )}
                </div>

                {/* Jenis Surat & Nomor Agenda */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Jenis Surat</label>
                    <select
                      value={newAgenda.direction}
                      onChange={(e) => handleAgendaDirectionChange(e.target.value as 'Masuk' | 'Keluar')}
                      className={inputClass}
                    >
                      <option value="Keluar">Surat Keluar</option>
                      <option value="Masuk">Surat Masuk</option>
                    </select>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className={`text-xs font-semibold ${isDark ? 'text-stone-300' : 'text-stone-700'}`}>
                        {newAgenda.direction === 'Masuk' ? 'No. Agenda Masuk' : 'No. Agenda Keluar'}
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const dirCount = agendaList.filter((x) => x.direction === newAgenda.direction).length;
                          const nextAg = buildAutoAgendaNumber(newAgenda.direction, dirCount);
                          setNewAgenda((prev) => ({ ...prev, nomorAgenda: nextAg }));
                        }}
                        className="text-[11px] font-bold text-red-800 dark:text-amber-400 hover:underline cursor-pointer"
                      >
                        Auto
                      </button>
                    </div>
                    <input
                      value={newAgenda.nomorAgenda || ''}
                      onChange={(e) => setNewAgenda({ ...newAgenda, nomorAgenda: e.target.value })}
                      placeholder={newAgenda.direction === 'Masuk' ? 'SM-001/2026' : 'SK-001/2026'}
                      maxLength={60}
                      className={inputClass}
                    />
                  </div>
                </div>

                {/* Kode Surat Keluar (hanya muncul untuk Surat Keluar) */}
                {newAgenda.direction === 'Keluar' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Kode Jenis Surat Keluar</label>
                      <select
                        value={keluarCodeType}
                        onChange={(e) => {
                          const nextCode = e.target.value as OutgoingLetterCode;
                          setKeluarCodeType(nextCode);
                          if (!editingAgendaId) {
                            const keluarCount = agendaList.filter((x) => x.direction === 'Keluar').length;
                            setNewAgenda((prev) => ({
                              ...prev,
                              nomorSurat: buildAutoLetterNumber(nextCode, keluarCount)
                            }));
                          }
                        }}
                        className={inputClass}
                      >
                        {OUTGOING_CODE_OPTIONS.map((opt) => (
                          <option key={opt.code} value={opt.code}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Tanggal Surat *</label>
                      <input
                        type="date"
                        required
                        value={newAgenda.tanggalSurat}
                        onChange={(e) => setNewAgenda({ ...newAgenda, tanggalSurat: e.target.value })}
                        className={inputClass}
                      />
                    </div>
                  </div>
                )}

                {/* Tanggal Surat & Tanggal Diterima (khusus Surat Masuk) */}
                {newAgenda.direction === 'Masuk' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Tanggal Diterima *</label>
                      <input
                        type="date"
                        required
                        value={newAgenda.tanggalTerima || ''}
                        onChange={(e) => setNewAgenda({ ...newAgenda, tanggalTerima: e.target.value })}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Tanggal Surat (Pengirim) *</label>
                      <input
                        type="date"
                        required
                        value={newAgenda.tanggalSurat}
                        onChange={(e) => setNewAgenda({ ...newAgenda, tanggalSurat: e.target.value })}
                        className={inputClass}
                      />
                    </div>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className={`text-xs font-semibold ${isDark ? 'text-stone-300' : 'text-stone-700'}`}>
                      {newAgenda.direction === 'Masuk' ? 'Nomor Surat Asli (dari Pengirim) *' : 'Nomor Surat Keluar *'}
                    </label>
                    {newAgenda.direction === 'Keluar' && (
                      <button
                        type="button"
                        onClick={() => {
                          const keluarCount = agendaList.filter((x) => x.direction === 'Keluar').length;
                          const nextNum = buildAutoLetterNumber(keluarCodeType, keluarCount);
                          setNewAgenda((prev) => ({ ...prev, nomorSurat: nextNum }));
                        }}
                        className="text-[11px] font-bold text-red-800 dark:text-amber-400 hover:underline cursor-pointer"
                      >
                        Generate Otomatis
                      </button>
                    )}
                  </div>
                  <input
                    required
                    maxLength={120}
                    value={newAgenda.nomorSurat}
                    onChange={(e) => setNewAgenda({ ...newAgenda, nomorSurat: e.target.value })}
                    placeholder={
                      newAgenda.direction === 'Masuk'
                        ? 'Ketik nomor surat asli yang tertera di kertas surat'
                        : '001/Und/PGRI-Rtg.Gelang/XI/2026'
                    }
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className={labelClass}>
                    {newAgenda.direction === 'Masuk' ? 'Pengirim / Asal Surat *' : 'Tujuan Surat (Kepada) *'}
                  </label>
                  <input
                    required
                    maxLength={200}
                    value={newAgenda.asalTujuan}
                    onChange={(e) => setNewAgenda({ ...newAgenda, asalTujuan: e.target.value })}
                    placeholder={
                      newAgenda.direction === 'Masuk'
                        ? 'PGRI Cabang Sumberbaru / Dinas Pendidikan'
                        : 'Seluruh Anggota PGRI Ranting Gelang / Kepala Sekolah'
                    }
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className={labelClass}>Perihal / Isi Ringkas *</label>
                  <input
                    required
                    maxLength={300}
                    value={newAgenda.perihal}
                    onChange={(e) => setNewAgenda({ ...newAgenda, perihal: e.target.value })}
                    placeholder="Undangan Rapat Kerja / Edaran Kontribusi / Surat Tugas"
                    className={inputClass}
                  />
                </div>

                {/* Disposisi & Status Tindak Lanjut (Khusus Surat Masuk) */}
                {newAgenda.direction === 'Masuk' && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className={labelClass}>Disposisi / Arahan Tindak Lanjut</label>
                      <input
                        maxLength={300}
                        value={newAgenda.disposisi || ''}
                        onChange={(e) => setNewAgenda({ ...newAgenda, disposisi: e.target.value })}
                        placeholder="Misal: Dihadiri Ketua & Sekretaris / Diteruskan ke Bendahara"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Status</label>
                      <select
                        value={newAgenda.statusTindakLanjut || 'Baru'}
                        onChange={(e) =>
                          setNewAgenda({
                            ...newAgenda,
                            statusTindakLanjut: e.target.value as 'Baru' | 'Diproses' | 'Selesai'
                          })
                        }
                        className={inputClass}
                      >
                        <option value="Baru">Baru</option>
                        <option value="Diproses">Diproses</option>
                        <option value="Selesai">Selesai</option>
                      </select>
                    </div>
                  </div>
                )}

                <div>
                  <label className={labelClass}>
                    {newAgenda.direction === 'Masuk' ? 'Catatan Tambahan (opsional)' : 'Keterangan / Catatan Pengiriman (opsional)'}
                  </label>
                  <textarea
                    rows={2}
                    maxLength={500}
                    value={newAgenda.catatan || ''}
                    onChange={(e) => setNewAgenda({ ...newAgenda, catatan: e.target.value })}
                    placeholder={
                      newAgenda.direction === 'Masuk'
                        ? 'Catatan arsip, lokasi berkas fisik, atau tindak lanjut rapat...'
                        : 'Misal: Dikirim via Grup WA Ranting • Lampiran 1 berkas'
                    }
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className={labelClass}>Tautan Arsip PDF / Drive (opsional)</label>
                  <input
                    type="url"
                    maxLength={600}
                    value={newAgenda.lampiranUrl || ''}
                    onChange={(e) => setNewAgenda({ ...newAgenda, lampiranUrl: e.target.value })}
                    placeholder="https://drive.google.com/..."
                    className={inputClass}
                  />
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  {editingAgendaId && (
                    <button
                      type="button"
                      onClick={handleCancelEditAgenda}
                      className={`px-4 py-2.5 rounded-xl font-bold text-xs cursor-pointer transition-colors ${
                        isDark ? 'bg-stone-800 text-stone-300 hover:bg-stone-700' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                      }`}
                    >
                      Batal Edit
                    </button>
                  )}
                  <button
                    type="submit"
                    className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-red-800 hover:bg-red-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                  >
                    {editingAgendaId ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                    <span>{editingAgendaId ? 'Simpan Perubahan' : 'Simpan ke Buku Agenda'}</span>
                  </button>
                </div>
              </form>
            )}

            <div className={`rounded-2xl border p-5 space-y-3.5 ${cardClass}`}>
              <div className="flex flex-col gap-2.5">
                <h3 className="font-display font-bold text-sm">
                  Daftar Buku Agenda Surat ({filteredAgenda.length})
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  {(['Semua', 'Masuk', 'Keluar'] as const).map((dir) => (
                    <button
                      key={dir}
                      type="button"
                      onClick={() => {
                        setAgendaFilter(dir);
                        if (dir !== 'Masuk') setAgendaStatusFilter('Semua');
                      }}
                      className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                        agendaFilter === dir
                          ? 'bg-red-800 text-white'
                          : isDark
                            ? 'bg-stone-800 text-stone-300 hover:bg-stone-700'
                            : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                      }`}
                    >
                      {dir}
                    </button>
                  ))}
                  <input
                    type="month"
                    value={agendaMonthFilter}
                    onChange={(e) => setAgendaMonthFilter(e.target.value)}
                    title="Filter berdasarkan bulan surat"
                    className={`px-2.5 py-1 rounded-lg border text-xs focus:outline-none focus:border-red-700 ${
                      isDark ? 'bg-stone-950 border-stone-800 text-stone-200' : 'bg-[#faf8f5] border-stone-200 text-stone-700'
                    }`}
                  />
                  <div className="relative flex-1 min-w-[140px]">
                    <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      value={agendaSearch}
                      onChange={(e) => setAgendaSearch(e.target.value)}
                      placeholder="Cari no / perihal / disposisi..."
                      className={`w-full pl-8 pr-3 py-1 rounded-lg border text-xs focus:outline-none focus:border-red-700 ${
                        isDark ? 'bg-stone-950 border-stone-800 text-white' : 'bg-[#faf8f5] border-stone-200 text-stone-800'
                      }`}
                    />
                  </div>
                </div>

                {/* Filter Status Khusus Surat Masuk */}
                {agendaFilter === 'Masuk' && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span className="text-[11px] font-semibold text-stone-400 mr-1">Status:</span>
                    {(['Semua', 'Baru', 'Diproses', 'Selesai'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setAgendaStatusFilter(st)}
                        className={`px-2.5 py-0.5 rounded-md text-[11px] font-bold cursor-pointer transition-colors ${
                          agendaStatusFilter === st
                            ? 'bg-emerald-700 text-white'
                            : isDark
                              ? 'bg-stone-800 text-stone-300 hover:bg-stone-700'
                              : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {filteredAgenda.length === 0 ? (
                <p className="text-xs text-stone-400 py-6 text-center">Belum ada catatan surat di Buku Agenda.</p>
              ) : (
                <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                  {filteredAgenda.map((item) => {
                    const isEditingThis = editingAgendaId === item.id;
                    const statusVal = item.statusTindakLanjut || 'Baru';
                    const statusBadgeClass =
                      statusVal === 'Selesai'
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                        : statusVal === 'Diproses'
                          ? 'bg-sky-500/15 text-sky-700 dark:text-sky-400'
                          : 'bg-amber-500/15 text-amber-800 dark:text-amber-300';

                    return (
                      <div
                        key={item.id}
                        className={`p-3.5 rounded-2xl border flex items-start justify-between gap-2.5 transition-colors ${
                          isEditingThis
                            ? isDark
                              ? 'bg-amber-950/30 border-amber-500/60'
                              : 'bg-amber-50/70 border-amber-400'
                            : isDark
                              ? 'bg-stone-950/60 border-stone-800'
                              : 'bg-[#faf8f5] border-stone-200/80'
                        }`}
                      >
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase ${
                                item.direction === 'Masuk'
                                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                  : 'bg-red-800/15 text-red-800 dark:bg-amber-500/15 dark:text-amber-300'
                              }`}
                            >
                              {item.direction}
                            </span>
                            {item.nomorAgenda && (
                              <span
                                className={`px-1.5 py-0.5 rounded-md font-mono text-[10px] font-bold ${
                                  isDark ? 'bg-stone-800 text-stone-300' : 'bg-stone-200/80 text-stone-700'
                                }`}
                              >
                                {item.nomorAgenda}
                              </span>
                            )}
                            {item.direction === 'Masuk' && (
                              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${statusBadgeClass}`}>
                                {statusVal}
                              </span>
                            )}
                          </div>
                          <p className="font-mono text-[11px] font-bold break-all">{item.nomorSurat}</p>
                          <p className="font-bold text-xs">{item.perihal}</p>
                          <p className="text-[11px] text-stone-500 dark:text-stone-400">
                            {item.direction === 'Masuk'
                              ? `Diterima: ${formatAgendaDateShort(item.tanggalTerima || item.tanggalSurat)} • Tgl Surat: ${formatAgendaDateShort(item.tanggalSurat)} • Dari: ${item.asalTujuan}`
                              : `${formatAgendaDateShort(item.tanggalSurat)} • Kepada: ${item.asalTujuan}`}
                          </p>
                          {item.direction === 'Masuk' && item.disposisi && (
                            <p className="text-[11px] text-amber-800 dark:text-amber-300 font-medium">
                              Disposisi: {item.disposisi}
                            </p>
                          )}
                          {item.catatan && (
                            <p className="text-[11px] text-stone-500 dark:text-stone-400 italic">
                              Catatan: {item.catatan}
                            </p>
                          )}
                          {isAdmin && item.direction === 'Masuk' && (
                            <div className="flex flex-wrap items-center gap-1 pt-1">
                              {(['Baru', 'Diproses', 'Selesai'] as const).map((st) => (
                                <button
                                  key={st}
                                  type="button"
                                  disabled={statusVal === st}
                                  onClick={() => handleQuickStatusChange(item, st)}
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                                    statusVal === st
                                      ? 'bg-emerald-700 text-white cursor-default'
                                      : isDark
                                        ? 'bg-stone-800 text-stone-400 hover:bg-stone-700 cursor-pointer'
                                        : 'bg-stone-200/70 text-stone-600 hover:bg-stone-200 cursor-pointer'
                                  }`}
                                >
                                  {st}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {isSafeHttpUrl(item.lampiranUrl) && (
                            <a
                              href={item.lampiranUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-400"
                              title="Buka Lampiran"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                          {isAdmin && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleEditAgenda(item)}
                                className="p-1.5 rounded-lg text-amber-700 dark:text-amber-400 hover:bg-amber-500/15 cursor-pointer"
                                title="Edit catatan surat"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteTarget({ type: 'agenda', item })}
                                className="p-1.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-500/15 cursor-pointer"
                                title="Hapus catatan"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* KANAN: KOTAK PREVIEW */}
          <div className={`xl:col-span-7 rounded-2xl border p-5 space-y-3 xl:sticky xl:top-4 ${cardClass}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2 font-display text-xs sm:text-sm font-bold">
                  <Eye className="w-4 h-4 text-red-800 dark:text-amber-400" />
                  <span>
                    {agendaFilter === 'Masuk'
                      ? 'Pratinjau Buku Agenda Surat Masuk (A4)'
                      : agendaFilter === 'Keluar'
                        ? 'Pratinjau Buku Agenda Surat Keluar (A4)'
                        : 'Pratinjau Buku Agenda Surat Gabungan (A4)'}
                  </span>
                </div>
                <p className={`text-[11px] ${isDark ? 'text-stone-400' : 'text-stone-500'}`}>
                  Kolom cetak otomatis menyesuaikan filter aktif ({agendaFilter}
                  {agendaFilter === 'Masuk' && agendaStatusFilter !== 'Semua' ? ` • ${agendaStatusFilter}` : ''}).
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      if (newAgenda.direction === 'Masuk') {
                        const masukCount = agendaList.filter((x) => x.direction === 'Masuk').length;
                        const nextAg = buildAutoAgendaNumber('Masuk', masukCount);
                        setNewAgenda((prev) => ({ ...prev, nomorAgenda: nextAg }));
                        onNotice('success', `Nomor Agenda Surat Masuk otomatis diterapkan: ${nextAg}`);
                      } else {
                        const keluarCount = agendaList.filter((x) => x.direction === 'Keluar').length;
                        const nextNum = buildAutoLetterNumber(keluarCodeType, keluarCount);
                        const nextAg = buildAutoAgendaNumber('Keluar', keluarCount);
                        setNewAgenda((prev) => ({ ...prev, nomorSurat: nextNum, nomorAgenda: nextAg }));
                        onNotice('success', `Nomor Surat Keluar otomatis diterapkan: ${nextNum}`);
                      }
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border cursor-pointer transition-colors ${
                      isDark
                        ? 'bg-stone-800 border-stone-700 text-stone-200 hover:bg-stone-700'
                        : 'bg-[#faf8f5] border-stone-200 text-stone-700 hover:bg-stone-100'
                    }`}
                  >
                    <Hash className="w-3.5 h-3.5" />
                    <span>{newAgenda.direction === 'Masuk' ? 'Auto No. Agenda' : 'Auto No. Surat'}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const summary = filteredAgenda
                      .slice(0, 10)
                      .map(
                        (a, idx) =>
                          `${idx + 1}. [${a.direction}${a.nomorAgenda ? ` ${a.nomorAgenda}` : ''}] ${a.nomorSurat} - ${a.perihal} (${formatAgendaDateShort(a.tanggalSurat)})${a.direction === 'Masuk' && a.statusTindakLanjut ? ` [${a.statusTindakLanjut}]` : ''}`
                      )
                      .join('\n');
                    const titleLabel =
                      agendaFilter === 'Masuk'
                        ? 'SURAT MASUK'
                        : agendaFilter === 'Keluar'
                          ? 'SURAT KELUAR'
                          : 'SURAT MASUK & KELUAR';
                    const msg =
                      `📚 *REKAP BUKU AGENDA ${titleLabel}*\n` +
                      `PGRI Ranting Gelang • Total: ${filteredAgenda.length} Surat\n\n` +
                      `${summary || 'Belum ada data surat.'}`;
                    openWhatsAppShare(msg);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/25 transition cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Bagikan WA</span>
                </button>
                <button
                  type="button"
                  disabled={isExportingEofficePdf}
                  onClick={async () => {
                    if (isExportingEofficePdf) return;
                    setIsExportingEofficePdf(true);
                    try {
                      await exportFullHtmlToPdfOrPrint(buildAgendaRekapHtml(), {
                        filename: `Buku_Agenda_Surat_${agendaFilter}.pdf`,
                        orientation: 'portrait'
                      });
                      onNotice(
                        'success',
                        isMobileDevice()
                          ? `File PDF Buku Agenda Surat (${agendaFilter}) berhasil diunduh.`
                          : `Jendela cetak Buku Agenda Surat (${agendaFilter}) dibuka.`
                      );
                    } finally {
                      setIsExportingEofficePdf(false);
                    }
                  }}
                  className={`px-4 py-2 rounded-xl bg-red-800 hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1.5 transition-colors ${
                    isExportingEofficePdf ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'
                  }`}
                >
                  {isExportingEofficePdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                  <span>{isExportingEofficePdf ? 'Menyiapkan PDF...' : 'Unduh Rekap PDF'}</span>
                </button>
              </div>
            </div>
            <div className={`rounded-2xl overflow-x-auto ${isDark ? 'bg-stone-950' : 'bg-stone-200/80'} py-4 px-2 sm:px-6`}>
              <iframe
                title="Pratinjau Buku Agenda Surat"
                srcDoc={buildAgendaRekapHtml()}
                scrolling="no"
                style={{ width: '210mm', height: '297mm' }}
                className="bg-transparent border-0 shadow-2xl mx-auto block shrink-0"
              />
            </div>
          </div>
        </div>
        {renderEofficeDeleteModal()}
      </div>
    );
  }

  const activePreviewNotulen = notulenList.find((n) => n.id === previewNotulenId) || null;

  // mode === 'notulen'
  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
      {/* KIRI: KOTAK PENGISIAN & ARSIP */}
      <div className="xl:col-span-5 space-y-5">
        {isAdmin && (
          <form onSubmit={handleAddNotulen} className={`rounded-2xl border p-5 space-y-3.5 ${cardClass}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <ClipboardList className="w-5 h-5 text-red-800 dark:text-amber-400" />
                <h2 className="font-display text-sm font-bold">
                  {editingNotulenId ? 'Edit Notulen & Berita Acara Rapat' : 'Buat Notulen & Berita Acara Rapat'}
                </h2>
              </div>
              {editingNotulenId && (
                <button
                  type="button"
                  onClick={handleCancelEditNotulen}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                    isDark ? 'bg-stone-800 text-stone-300 hover:bg-stone-700' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                  }`}
                >
                  Batal Edit
                </button>
              )}
            </div>

            <div>
              <label className={labelClass}>Tautkan dari Jadwal Kegiatan (Auto Jumlah Hadir)</label>
              <select value={notulenForm.eventId} onChange={(e) => handleSelectEventForNotulen(e.target.value)} className={inputClass}>
                <option value="">-- Rapat Baru / Manual --</option>
                {events.map((evt) => (
                  <option key={evt.id} value={evt.id}>{evt.title} ({evt.date})</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Judul Rapat / Kegiatan *</label>
                <input required value={notulenForm.eventTitle} onChange={(e) => setNotulenForm({ ...notulenForm, eventTitle: e.target.value })} placeholder="Rapat Pengurus PGRI" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Tanggal Pelaksanaan *</label>
                <input type="date" required value={notulenForm.tanggal} onChange={(e) => setNotulenForm({ ...notulenForm, tanggal: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Lokasi</label>
                <input value={notulenForm.tempat} onChange={(e) => setNotulenForm({ ...notulenForm, tempat: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Jumlah Hadir (Orang)</label>
                <input type="number" min={0} value={notulenForm.jumlahHadir} onChange={(e) => setNotulenForm({ ...notulenForm, jumlahHadir: Number(e.target.value) || 0 })} className={inputClass} />
              </div>
            </div>

            <div>
              <label className={labelClass}>Pimpinan Rapat</label>
              <input value={notulenForm.pimpinanRapat} onChange={(e) => setNotulenForm({ ...notulenForm, pimpinanRapat: e.target.value })} className={inputClass} />
            </div>

            <div>
              <label className={labelClass}>Agenda &amp; Ringkasan Pembahasan</label>
              <textarea rows={2} value={notulenForm.agenda} onChange={(e) => setNotulenForm({ ...notulenForm, agenda: e.target.value })} className={inputClass} placeholder="Poin-poin pembahasan rapat..." />
            </div>
            <div>
              <label className={labelClass}>Keputusan Rapat *</label>
              <textarea required rows={3} value={notulenForm.keputusan} onChange={(e) => setNotulenForm({ ...notulenForm, keputusan: e.target.value })} className={inputClass} placeholder="1. Menyepakati program kerja HGN...&#10;2. Penyesuaian jadwal..." />
            </div>
            <div>
              <label className={labelClass}>Rencana Tindak Lanjut (RTL)</label>
              <textarea rows={2} value={notulenForm.tindakLanjut} onChange={(e) => setNotulenForm({ ...notulenForm, tindakLanjut: e.target.value })} className={inputClass} placeholder="Penanggung jawab & target waktu pelaksanaan..." />
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {editingNotulenId && (
                <button
                  type="button"
                  onClick={handleCancelEditNotulen}
                  className={`px-4 py-2.5 rounded-xl font-bold text-xs cursor-pointer ${
                    isDark ? 'bg-stone-800 hover:bg-stone-700 text-stone-300' : 'bg-stone-100 hover:bg-stone-200 text-stone-700'
                  }`}
                >
                  Batal
                </button>
              )}
              <button type="submit" className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-red-800 hover:bg-red-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors">
                {editingNotulenId ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                <span>{editingNotulenId ? 'Simpan Perubahan Notulen' : 'Simpan Notulen Rapat'}</span>
              </button>
            </div>
          </form>
        )}

        <div className={`rounded-2xl border p-5 space-y-3.5 ${cardClass}`}>
          <h3 className="font-display font-bold text-sm">Arsip Notulen &amp; Berita Acara ({notulenList.length})</h3>
          {notulenList.length === 0 ? (
            <p className="text-xs text-stone-400 py-6 text-center">Belum ada arsip notulen rapat.</p>
          ) : (
            <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
              {notulenList.map((item) => (
                <div key={item.id} className={`p-3.5 rounded-2xl border space-y-2 ${isDark ? 'bg-stone-950/60 border-stone-800' : 'bg-[#faf8f5] border-stone-200/80'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="font-bold text-xs truncate">{item.eventTitle}</h4>
                      <div className="flex flex-wrap items-center gap-2 text-[10px] text-stone-400 mt-0.5">
                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {item.tanggal}</span>
                        <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {item.tempat}</span>
                        <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {item.jumlahHadir} Hadir</span>
                      </div>
                    </div>
                  </div>
                  <p className={`text-[11px] line-clamp-2 ${isDark ? 'text-stone-300' : 'text-stone-600'}`}>
                    <strong>Keputusan:</strong> {item.keputusan}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        const msg =
                          `📝 *RINGKASAN NOTULEN RAPAT PGRI RANTING GELANG*\n` +
                          `📌 ${item.eventTitle}\n` +
                          `📅 ${item.tanggal} • 📍 ${item.tempat} • 👥 ${item.jumlahHadir} Hadir\n\n` +
                          `*Keputusan Rapat:*\n${item.keputusan}\n\n` +
                          `${item.tindakLanjut ? `*Tindak Lanjut:*\n${item.tindakLanjut}` : ''}`;
                        openWhatsAppShare(msg);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Share2 className="w-3 h-3" />
                      <span>WA</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewNotulenId(previewNotulenId === item.id ? null : item.id)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer ${
                        previewNotulenId === item.id
                          ? 'bg-red-800 text-white'
                          : 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                      }`}
                    >
                      <Eye className="w-3 h-3" />
                      <span>{previewNotulenId === item.id ? 'Draft Form' : 'Pratinjau'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportNotulen(item)}
                      className="px-2.5 py-1 rounded-lg bg-red-800/15 text-red-800 dark:bg-red-950/60 dark:text-amber-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Download className="w-3 h-3" />
                      <span>Cetak</span>
                    </button>
                    {isAdmin && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleEditNotulen(item)}
                          className="px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                          title="Edit notulen rapat"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteTarget({ type: 'notulen', item })}
                          className="p-1.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-500/15 ml-auto cursor-pointer"
                          title="Hapus notulen rapat"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* KANAN: KOTAK PREVIEW */}
      <div className={`xl:col-span-7 rounded-2xl border p-5 space-y-3 xl:sticky xl:top-4 ${cardClass}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 font-display text-xs sm:text-sm font-bold">
              <Eye className="w-4 h-4 text-red-800 dark:text-amber-400" />
              <span>
                Pratinjau Langsung Notulen &amp; Berita Acara{' '}
                {activePreviewNotulen ? '(Arsip Terpilih)' : '(Draft Form)'}
              </span>
            </div>
            <p className={`text-[11px] ${isDark ? 'text-stone-400' : 'text-stone-500'}`}>
              Tampilan dokumen resmi A4 diperbarui secara otomatis saat Anda mengetik.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {activePreviewNotulen && (
              <button
                type="button"
                onClick={() => setPreviewNotulenId(null)}
                className={`px-3 py-2 rounded-xl text-xs font-bold cursor-pointer ${
                  isDark ? 'bg-stone-800 text-stone-300' : 'bg-stone-100 text-stone-700'
                }`}
              >
                Kembali ke Draft
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  const nextNum = buildAutoLetterNumber('BA', archiveCount + notulenList.length);
                  setNotulenForm((prev) => ({
                    ...prev,
                    eventTitle: prev.eventTitle.includes('No.')
                      ? prev.eventTitle.replace(/\(No\..*?\)/, `(No. ${nextNum})`)
                      : `${prev.eventTitle || 'Berita Acara Rapat'} (No. ${nextNum})`
                  }));
                  onNotice('success', `Nomor Berita Acara otomatis diterapkan: ${nextNum}`);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border cursor-pointer transition-colors ${
                  isDark ? 'bg-stone-800 border-stone-700 text-stone-200 hover:bg-stone-700' : 'bg-[#faf8f5] border-stone-200 text-stone-700 hover:bg-stone-100'
                }`}
              >
                <Hash className="w-3.5 h-3.5" />
                <span>Auto No. Surat</span>
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                disabled={isRecordingQuickAgenda}
                onClick={async () => {
                  if (isRecordingQuickAgenda) return;
                  setIsRecordingQuickAgenda(true);
                  try {
                    const target = activePreviewNotulen || notulenForm;
                    const noMatch = target.eventTitle.match(/\(No\.\s*([^)]+)\)/i);
                    const nomorBa = noMatch
                      ? noMatch[1].trim()
                      : buildAutoLetterNumber('BA', archiveCount + notulenList.length);
                    const res = await quickRecordOutgoingAgenda({
                      nomorSurat: nomorBa,
                      tanggalSurat: target.tanggal,
                      asalTujuan: 'Arsip & Pengurus PGRI Ranting Gelang',
                      perihal: `Berita Acara & Notulen - ${target.eventTitle || 'Rapat Ranting'}`,
                      catatan: `Lokasi: ${target.tempat} • Hadir: ${target.jumlahHadir} Orang`
                    });
                    if (!res.ok) {
                      onNotice('error', res.error || 'Gagal mencatat Berita Acara ke Surat Keluar.');
                    } else if (res.error) {
                      onNotice('error', `Tercatat lokal, namun sinkron Cloud gagal: ${res.error}`);
                    } else {
                      onNotice(
                        'success',
                        res.updatedExisting
                          ? `Berita Acara No. ${nomorBa} diperbarui di Buku Agenda Surat Keluar.`
                          : `Berita Acara No. ${nomorBa} berhasil dicatat ke Buku Agenda Surat Keluar.`
                      );
                    }
                  } finally {
                    setIsRecordingQuickAgenda(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-amber-600/15 text-amber-800 dark:text-amber-300 border border-amber-500/35 hover:bg-amber-600/25 transition cursor-pointer disabled:opacity-60"
                title="Catat Berita Acara / Notulen ini ke Buku Agenda Surat Keluar"
              >
                {isRecordingQuickAgenda ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookOpen className="w-3.5 h-3.5" />}
                <span>Catat ke Surat Keluar</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                const target = activePreviewNotulen || notulenForm;
                const msg =
                  `📝 *RINGKASAN NOTULEN RAPAT PGRI RANTING GELANG*\n` +
                  `📌 ${target.eventTitle || 'Rapat Koordinasi'}\n` +
                  `📅 ${target.tanggal} • 📍 ${target.tempat} • 👥 ${target.jumlahHadir} Hadir\n\n` +
                  `*Keputusan Rapat:*\n${target.keputusan || '-'}\n\n` +
                  `${target.tindakLanjut ? `*Tindak Lanjut:*\n${target.tindakLanjut}` : ''}`;
                openWhatsAppShare(msg);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/25 transition cursor-pointer"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Bagikan WA</span>
            </button>
            <button
              type="button"
              disabled={isExportingEofficePdf}
              onClick={() => handleExportNotulen(activePreviewNotulen || notulenForm)}
              className={`px-4 py-2 rounded-xl bg-red-800 hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1.5 transition-colors ${
                isExportingEofficePdf ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'
              }`}
            >
              {isExportingEofficePdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              <span>{isExportingEofficePdf ? 'Menyiapkan PDF...' : 'Unduh Notulen PDF'}</span>
            </button>
          </div>
        </div>
        <div className={`rounded-2xl overflow-x-auto ${isDark ? 'bg-stone-950' : 'bg-stone-200/80'} py-4 px-2 sm:px-6`}>
          <iframe
            title="Pratinjau Notulen & Berita Acara"
            srcDoc={buildNotulenHtml(activePreviewNotulen || notulenForm)}
            style={{ width: '210mm', height: '297mm' }}
            className="bg-transparent border-0 shadow-2xl mx-auto block shrink-0"
          />
        </div>
      </div>
      {renderEofficeDeleteModal()}
    </div>
  );
};

export const BuatUndangan: React.FC<BuatUndanganProps> = ({
  activeRole = 'guru',
  teachers = [],
  events = [],
  attendanceList = [],
  theme
}) => {
  const isAdmin = activeRole === 'admin';
  const [isDark, setIsDark] = useState(() => {
    if (theme) return theme === 'dark';
    return typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false;
  });

  useEffect(() => {
    if (theme) {
      setIsDark(theme === 'dark');
    }
  }, [theme]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const [assets, setAssets] = useState<OrgAssets>(() => readAssetsFromSettings());
  const [draft, setDraft] = useState<InvitationData>(() => createInitialDraft(teachers));

  // Arsip Undangan (tersimpan di Firestore `kombel_data/invitations` & localStorage)
  const [savedInvitations, setSavedInvitations] = useState<InvitationData[]>(() => {
    try {
      const raw = localStorage.getItem(INVITATIONS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  const [viewMode, setViewMode] = useState<'editor' | 'surat_tugas' | 'pengawas_ujian' | 'agenda_surat' | 'notulen'>('editor');
  const [loadedArchiveForSubPanel, setLoadedArchiveForSubPanel] = useState<InvitationData | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isSavingCloud, setIsSavingCloud] = useState(false);
  const [isSyncingArchive, setIsSyncingArchive] = useState(false);
  const [statusNotice, setStatusNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [deleteArchiveTarget, setDeleteArchiveTarget] = useState<InvitationData | null>(null);

  // Collapsible sections in editor
  const [openSection, setOpenSection] = useState<'surat' | 'acara' | 'ttd'>('surat');

  // Sinkronisasi aset & kepengurusan dari localStorage / settings/global
  const refreshOrgDataFromMenus = async (fetchCloudIfMissing = false) => {
    let currentAssets = readAssetsFromSettings();

    if (
      fetchCloudIfMissing &&
      (!currentAssets.logoPgri || !currentAssets.ttdKetua || !currentAssets.logoStempel)
    ) {
      try {
        const docRef = doc(db, 'settings', 'global');
        let snap;
        try {
          snap = await getDocFromServer(docRef);
        } catch {
          snap = await getDoc(docRef);
        }
        if (snap && snap.exists()) {
          const cloudData = snap.data();
          Object.entries(cloudData).forEach(([k, v]) => {
            if (v !== undefined && v !== null) {
              try {
                localStorage.setItem(k, String(v));
              } catch {}
            }
          });
          currentAssets = readAssetsFromSettings();
        }
      } catch (err) {
        console.warn('Info sinkron aset pengaturan:', err);
      }
    }

    setAssets(currentAssets);
    const signers = readSignersFromKepengurusan();
    const latestNpa = resolveSignerNpasFromData(signers.ketuaNama, signers.sekretarisNama);
    setDraft((prev) => ({
      ...prev,
      ketuaNama: signers.ketuaNama,
      sekretarisNama: signers.sekretarisNama,
      ketuaNpa: latestNpa.ketuaNpa,
      sekretarisNpa: latestNpa.sekretarisNpa
    }));
  };

  useEffect(() => {
    refreshOrgDataFromMenus(true);
    const onSettingsChanged = () => {
      setAssets(readAssetsFromSettings());
    };
    window.addEventListener('storage', onSettingsChanged);
    window.addEventListener('kombel-settings-updated', onSettingsChanged);
    return () => {
      window.removeEventListener('storage', onSettingsChanged);
      window.removeEventListener('kombel-settings-updated', onSettingsChanged);
    };
  }, []);

  // Tarik arsip undangan, agenda surat, & notulen rapat dari Firebase saat menu dibuka (cooldown 60 detik + cek versi ringan)
  useEffect(() => {
    let isMounted = true;
    const loadCloudArchive = async () => {
      try {
        const lastSync = sessionStorage.getItem('pgri_eoffice_sync_ts');
        if (lastSync && Date.now() - Number(lastSync) < 60000) {
          return;
        }
      } catch {}

      setIsSyncingArchive(true);
      try {
        const cloudVersions = await fetchCloudVersions(45000);
        if (!isMounted) return;

        const canReadProtected = Boolean(auth.currentUser && auth.currentUser.emailVerified);
        const fetchInv = canReadProtected && shouldFetchByVersion('invitations', cloudVersions);
        const fetchAgenda = canReadProtected && shouldFetchByVersion('suratAgenda', cloudVersions);
        const fetchNotulen = shouldFetchByVersion('notulen', cloudVersions);

        const [invRes, agendaRes, notulenRes] = await Promise.allSettled([
          fetchInv ? syncFromFirebase('invitations') : Promise.resolve(null),
          fetchAgenda ? syncFromFirebase('suratAgenda') : Promise.resolve(null),
          fetchNotulen ? syncFromFirebase('notulen') : Promise.resolve(null)
        ]);

        if (!isMounted) return;

        if (fetchInv && invRes.status === 'fulfilled' && Array.isArray(invRes.value)) {
          setSavedInvitations(invRes.value);
          try {
            localStorage.setItem(INVITATIONS_STORAGE_KEY, JSON.stringify(invRes.value));
          } catch {}
          markLocalVersionSynced('invitations', cloudVersions);
        }

        let updatedSubPanels = false;
        if (fetchAgenda && agendaRes.status === 'fulfilled' && Array.isArray(agendaRes.value)) {
          try {
            localStorage.setItem(AGENDA_STORAGE_KEY, JSON.stringify(agendaRes.value));
            updatedSubPanels = true;
          } catch {}
          markLocalVersionSynced('suratAgenda', cloudVersions);
        }

        if (fetchNotulen && notulenRes.status === 'fulfilled' && Array.isArray(notulenRes.value)) {
          try {
            localStorage.setItem(NOTULEN_STORAGE_KEY, JSON.stringify(notulenRes.value));
            updatedSubPanels = true;
          } catch {}
          markLocalVersionSynced('notulen', cloudVersions);
        }

        if (updatedSubPanels) {
          window.dispatchEvent(new Event('pgri-eoffice-synced'));
        }

        try {
          sessionStorage.setItem('pgri_eoffice_sync_ts', String(Date.now()));
        } catch {}
      } catch (e) {
        // Fallback diam-diam ke localStorage jika offline/kuota
      } finally {
        if (isMounted) setIsSyncingArchive(false);
      }
    };
    loadCloudArchive();
    const handleExternalSync = () => {
      try {
        const raw = localStorage.getItem(INVITATIONS_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setSavedInvitations(parsed);
        }
      } catch {}
    };
    window.addEventListener('pgri-eoffice-synced', handleExternalSync);
    return () => {
      isMounted = false;
      window.removeEventListener('pgri-eoffice-synced', handleExternalSync);
    };
  }, []);

  // Simpan default NPA terakhir secara lokal agar Admin tidak mengetik ulang
  useEffect(() => {
    try {
      localStorage.setItem(
        NPA_STORAGE_KEY,
        JSON.stringify({
          ketuaNpa: draft.ketuaNpa,
          sekretarisNpa: draft.sekretarisNpa
        })
      );
    } catch {}
  }, [draft.ketuaNpa, draft.sekretarisNpa]);

  const showToast = (type: 'success' | 'error', text: string) => {
    setStatusNotice({ type, text });
    setTimeout(() => setStatusNotice(null), 3500);
  };

  // Handler Unduh PDF (PC: Jendela Cetak bawaan browser seperti menu lain | Ponsel / Popup diblokir: Auto Download PDF)
  const handleDownloadPdf = async (targetData: InvitationData = draft) => {
    if (isGeneratingPdf) return;
    setIsGeneratingPdf(true);
    let container: HTMLDivElement | null = null;
    try {
      const freshAssets = readAssetsFromSettings();
      setAssets(freshAssets);
      const invitationHtml = buildInvitationPdfHtml(targetData, freshAssets);

      const safeTitle =
        (targetData.acara || targetData.perihal || 'Undangan_PGRI')
          .replace(/[^a-zA-Z0-9\s_-]/g, '')
          .trim()
          .replace(/\s+/g, '_') || 'Undangan_PGRI';
      const pdfFilename = `Undangan_${safeTitle}_PGRI_Ranting_Gelang.pdf`;

      // JIKA DI PC / LAPTOP: Gunakan pratinjau cetak bawaan browser seperti menu lain
      if (!isMobileDevice()) {
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          const printHtmlContent = `
            <!DOCTYPE html>
            <html lang="id">
              <head>
                <meta charset="UTF-8" />
                <title>${escapeHtml(pdfFilename.replace(/\.pdf$/i, ''))}</title>
                <style>
                  @page {
                    size: A4 portrait;
                    margin: 0;
                  }
                  * {
                    box-sizing: border-box;
                  }
                  html, body {
                    margin: 0;
                    padding: 0;
                    background: #ffffff;
                    color: #000000;
                    font-family: 'Times New Roman', Times, serif;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                  }
                  @media print {
                    html, body {
                      width: 210mm;
                      height: 297mm;
                    }
                  }
                </style>
              </head>
              <body>
                ${invitationHtml}
                <script>
                  window.onload = function() {
                    setTimeout(function() {
                      window.print();
                    }, 500);
                  };
                  window.onafterprint = function() {
                    window.close();
                  };
                </script>
              </body>
            </html>
          `;
          printWindow.document.open();
          printWindow.document.write(printHtmlContent);
          printWindow.document.close();
          return;
        }
      }

      // JIKA DI PONSEL (atau jika popup jendela cetak diblokir): Direct download PDF dengan html2pdf lokal
      container = document.createElement('div');
      container.id = 'undangan-pdf-export-root';
      container.style.width = '794px';
      container.style.backgroundColor = '#ffffff';
      container.style.color = '#000000';
      container.style.margin = '0';
      container.style.padding = '0';
      container.innerHTML = `
        <style data-pdf-style="true">
          * {
            box-sizing: border-box;
            font-family: 'Times New Roman', Times, serif;
          }
          html, body {
            margin: 0;
            padding: 0;
            background-color: #ffffff;
            color: #000000;
          }
        </style>
        ${invitationHtml}
      `;

      await downloadContainerAsPdf(container, {
        filename: pdfFilename,
        orientation: 'portrait',
        margin: [0, 0, 0, 0],
        quality: 0.98,
        scale: 2
      });
      showToast('success', 'File PDF undangan utuh berhasil diunduh.');
    } catch (err: any) {
      console.error('Gagal membuat PDF undangan:', err);
      showToast('error', err?.message || 'Gagal membuat file PDF undangan.');
    } finally {
      if (container && document.body.contains(container)) {
        document.body.removeChild(container);
      }
      setIsGeneratingPdf(false);
    }
  };

  const handleSaveToArchive = async (customItem?: InvitationData) => {
    if (!isAdmin) return;
    setIsSavingCloud(true);
    const source = customItem || draft;
    const toSave: InvitationData = {
      ...source,
      title: source.title.trim() || `${source.perihal} - ${source.acara}`,
      updatedAt: new Date().toISOString()
    };
    const isEditingExisting = savedInvitations.some((item) => item.id === toSave.id);
    const nextCount = isEditingExisting ? savedInvitations.length : savedInvitations.length + 1;

    setSavedInvitations((prev) => {
      const exists = prev.some((item) => item.id === toSave.id);
      const updated = exists
        ? prev.map((item) => (item.id === toSave.id ? toSave : item))
        : [toSave, ...prev];
      try {
        localStorage.setItem(INVITATIONS_STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });

    if (!customItem) {
      const freshNext = createInitialDraft(teachers);
      setDraft({
        ...freshNext,
        nomorSurat: buildAutoLetterNumber('Und', nextCount)
      });
    }

    try {
      const npaPayload = JSON.stringify({
        ketuaNpa: toSave.ketuaNpa,
        sekretarisNpa: toSave.sekretarisNpa
      });
      void syncSettingsToCloud({ [NPA_STORAGE_KEY]: npaPayload }, 'Default NPA Undangan');

      const res = await mutateCloudCollection<InvitationData>(
        'invitations',
        [INVITATIONS_STORAGE_KEY],
        (latest) =>
          latest.some((item) => item.id === toSave.id)
            ? latest.map((item) => (item.id === toSave.id ? toSave : item))
            : [toSave, ...latest],
        savedInvitations,
        'Arsip Undangan'
      );
      setSavedInvitations(res.items);
      showToast(
        'success',
        isEditingExisting
          ? 'Perubahan arsip undangan berhasil diperbarui.'
          : 'Undangan berhasil disimpan ke Arsip & Cloud.'
      );
    } catch {
      showToast('success', 'Undangan tersimpan di perangkat lokal.');
    } finally {
      setIsSavingCloud(false);
    }
  };

  const handleDeleteArchive = async (id: string) => {
    if (!isAdmin) return;
    const deletedInv = savedInvitations.find((item) => item.id === id);
    const nextFallback = savedInvitations.filter((item) => item.id !== id);
    setSavedInvitations((prev) => {
      const updated = prev.filter((item) => item.id !== id);
      try {
        localStorage.setItem(INVITATIONS_STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
    try {
      const res = await mutateCloudCollection<InvitationData>(
        'invitations',
        [INVITATIONS_STORAGE_KEY],
        (latest) => latest.filter((item) => item.id !== id),
        nextFallback,
        'Arsip Undangan'
      );
      setSavedInvitations(res.items);
      if (res.success) {
        if (deletedInv) {
          void logAuditEvent(
            'Arsip Undangan',
            'Hapus Undangan',
            `Menghapus arsip undangan "${deletedInv.title || deletedInv.perihal}" (${deletedInv.nomorSurat || '-'}).`
          );
        }
        showToast('success', 'Undangan dihapus dari arsip.');
      } else {
        showToast('error', res.error || 'Undangan terhapus lokal, namun gagal sinkron ke Cloud.');
      }
    } catch {
      showToast('error', 'Gagal menghapus undangan dari Cloud.');
    }
  };

  const handleCreateNewDraft = () => {
    const fresh = createInitialDraft(teachers);
    setDraft(fresh);
    setViewMode('editor');
    showToast('success', 'Formulir undangan baru siap diisi.');
  };

  const handleLoadIntoEditor = (inv: InvitationData, asDuplicate = false) => {
    const targetItem: InvitationData = asDuplicate
      ? {
          ...inv,
          id: `inv-${Date.now()}`,
          title: `${inv.title} (Salinan)`,
          updatedAt: new Date().toISOString()
        }
      : inv;

    if (targetItem.docCategory === 'surat_tugas') {
      setLoadedArchiveForSubPanel({ ...targetItem });
      setViewMode('surat_tugas');
      return;
    }
    if (targetItem.docCategory === 'pengawas_ujian') {
      setLoadedArchiveForSubPanel({ ...targetItem });
      setViewMode('pengawas_ujian');
      return;
    }

    setDraft(targetItem);
    if (isAdmin) {
      setViewMode('editor');
    }
  };
  
  const previewHtml = useMemo(() => buildInvitationPdfHtml(draft, assets), [draft, assets]);

  const cardClass = isDark
    ? 'bg-stone-900 border-stone-800 text-stone-100'
    : 'bg-white border-stone-200/90 text-stone-900';
  const inputClass = isDark
    ? 'w-full px-3.5 py-2.5 rounded-xl bg-stone-950 border border-stone-800 text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-red-700/50 focus:border-red-700'
    : 'w-full px-3.5 py-2.5 rounded-xl bg-[#faf8f5] border border-stone-200 text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-red-700/35 focus:border-red-700';
  const labelClass = `block text-xs font-semibold mb-1.5 ${isDark ? 'text-stone-300' : 'text-stone-700'}`;

  return (
    <div className="space-y-6">
      {/* Header Banner — Wibawa Kusuma Bangsa */}
      <div className={`relative overflow-hidden rounded-2xl border p-6 sm:p-7 shadow-sm ${
        isDark
          ? 'bg-gradient-to-br from-[#231214] via-stone-900 to-[#1a1112] border-red-900/40 text-stone-100 pgri-batik-pattern-dark'
          : 'bg-gradient-to-br from-[#fdfbf7] via-white to-red-50/50 border-stone-200/90 text-stone-900 pgri-batik-pattern'
      }`}>
        <div className="absolute top-0 inset-x-0 h-[3px] pgri-top-accent pointer-events-none" />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <p className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] mb-1.5 ${
              isAdmin ? 'text-red-800 dark:text-amber-400' : 'text-amber-700 dark:text-amber-400'
            }`}>
              <FileText className="w-3.5 h-3.5" />
              Tata Persuratan • {isAdmin ? 'Mode Admin / Pengurus' : 'Mode Baca Guru'}
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight">E-Office &amp; Pembuatan Undangan</h1>
            <p className={`text-xs sm:text-sm mt-1 ${isDark ? 'text-stone-400' : 'text-stone-600'}`}>
              Buat undangan resmi, Surat Tugas, Buku Agenda Surat Masuk/Keluar, serta Notulen Rapat PGRI Ranting Gelang.
            </p>
          </div>
        </div>

        {/* Switcher Tab Internal */}
        <div className="relative z-10 mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setViewMode('agenda_surat')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
              viewMode === 'agenda_surat'
                ? 'bg-red-800 text-white shadow-sm'
                : isDark
                  ? 'bg-stone-800 text-stone-300 hover:bg-stone-700'
                  : 'bg-white border border-stone-200 text-stone-700 hover:bg-stone-50'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            Agenda Surat
          </button>
          <button
            type="button"
            onClick={() => setViewMode('editor')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
              viewMode === 'editor'
                ? 'bg-red-800 text-white shadow-sm'
                : isDark
                  ? 'bg-stone-800 text-stone-300 hover:bg-stone-700'
                  : 'bg-white border border-stone-200 text-stone-700 hover:bg-stone-50'
            }`}
          >
            <Edit3 className="w-3.5 h-3.5" />
            Undangan
          </button>
          <button
            type="button"
            onClick={() => setViewMode('surat_tugas')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
              viewMode === 'surat_tugas'
                ? 'bg-red-800 text-white shadow-sm'
                : isDark
                  ? 'bg-stone-800 text-stone-300 hover:bg-stone-700'
                  : 'bg-white border border-stone-200 text-stone-700 hover:bg-stone-50'
            }`}
          >
            <FileCheck2 className="w-3.5 h-3.5" />
            Surat Tugas
          </button>
          <button
            type="button"
            onClick={() => setViewMode('pengawas_ujian')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
              viewMode === 'pengawas_ujian'
                ? 'bg-red-800 text-white shadow-sm'
                : isDark
                  ? 'bg-stone-800 text-stone-300 hover:bg-stone-700'
                  : 'bg-white border border-stone-200 text-stone-700 hover:bg-stone-50'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Pengawas Ujian
          </button>
          <button
            type="button"
            onClick={() => setViewMode('notulen')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
              viewMode === 'notulen'
                ? 'bg-red-800 text-white shadow-sm'
                : isDark
                  ? 'bg-stone-800 text-stone-300 hover:bg-stone-700'
                  : 'bg-white border border-stone-200 text-stone-700 hover:bg-stone-50'
            }`}
          >
            <ClipboardList className="w-3.5 h-3.5" />
            Notulen
          </button>
        </div>
      </div>

      {/* Toast Pemberitahuan */}
      {statusNotice && (
        <div
          className={`rounded-2xl border px-4 py-3 text-xs font-semibold flex items-center gap-2.5 ${
            statusNotice.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
          }`}
        >
          {statusNotice.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{statusNotice.text}</span>
        </div>
      )}

      {/* Peringatan jika Guru membuka menu */}
      {!isAdmin && (
        <div className={`rounded-2xl border p-4 flex items-center gap-3 text-xs ${isDark ? 'bg-amber-950/30 border-amber-800/50 text-amber-300' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
          <Lock className="w-4 h-4 shrink-0" />
          <span>
            Pembuatan dan pengeditan dokumen hanya dapat dilakukan melalui <strong>Akses Pengurus (Admin)</strong>. Anda dapat melihat pratinjau dan mengunduh dokumen yang telah diterbitkan pada daftar arsip di bawah ini.
          </span>
        </div>
      )}

      {/* MODE EDITOR + ARSIP TERPADU + LIVE PREVIEW */}
      {viewMode === 'editor' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Kolom Kiri: Form Pengisian Data Admin & Daftar Arsip Undangan */}
          <div className="xl:col-span-5 space-y-5">
            {isAdmin && (
              <div className={`rounded-2xl border p-5 space-y-4 ${cardClass}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <FileText className="w-5 h-5 text-red-800 dark:text-amber-400" />
                    <h2 className="font-display text-sm font-bold">
                      {savedInvitations.some((item) => item.id === draft.id)
                        ? 'Edit Arsip Undangan'
                        : 'Buat Undangan Resmi Baru'}
                    </h2>
                  </div>
                  {savedInvitations.some((item) => item.id === draft.id) && (
                    <button
                      type="button"
                      onClick={handleCreateNewDraft}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer transition-colors ${
                        isDark ? 'bg-stone-800 text-stone-300 hover:bg-stone-700' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                      }`}
                    >
                      <RefreshCw className="w-3 h-3" />
                      Buat Baru
                    </button>
                  )}
                </div>

                {/* Tautkan Jadwal Kegiatan Otomatis */}
                {events.length > 0 && (
                  <div>
                    <label className={labelClass}>Ambil Data dari Jadwal Kegiatan (Opsional)</label>
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const evt = events.find((x) => x.id === e.target.value);
                        if (!evt) return;
                        const parsedDate = new Date(`${evt.date}T00:00:00`);
                        const hariStr = !isNaN(parsedDate.getTime())
                          ? parsedDate.toLocaleDateString('id-ID', { weekday: 'long' })
                          : draft.hari;
                        const tglStr = !isNaN(parsedDate.getTime())
                          ? parsedDate.toLocaleDateString('id-ID', {
                              day: 'numeric',
                              month: 'long',
                              year: 'numeric'
                            })
                          : evt.date;
                        setDraft((prev) => ({
                          ...prev,
                          title: `Undangan - ${evt.title}`,
                          hari: hariStr,
                          tanggalAcara: tglStr,
                          pukul: evt.time || prev.pukul,
                          tempatAcara: evt.location || prev.tempatAcara,
                          acara: evt.title
                        }));
                        showToast('success', `Data kegiatan "${evt.title}" berhasil diisikan.`);
                      }}
                      className={inputClass}
                    >
                      <option value="">-- Pilih Jadwal Kegiatan untuk Isi Otomatis --</option>
                      {events.map((evt) => (
                        <option key={evt.id} value={evt.id}>
                          {evt.title} ({evt.date})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Judul Arsip */}
                <div>
                  <label className={labelClass}>Judul Dokumen (Untuk Arsip Internal)</label>
                  <input
                    type="text"
                    className={inputClass}
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    placeholder="Misal: Undangan Lomba Bola Voli HGN 2026"
                  />
                </div>

                {/* Accordion 1: Nomor, Tanggal & Tujuan */}
                <div className={`rounded-2xl border overflow-hidden ${isDark ? 'border-stone-800 bg-stone-950/40' : 'border-stone-200 bg-[#faf8f5]'}`}>
                  <button
                    type="button"
                    onClick={() => setOpenSection(openSection === 'surat' ? 'acara' : 'surat')}
                    className="w-full px-4 py-3 flex items-center justify-between text-left font-bold text-xs sm:text-sm cursor-pointer"
                  >
                    <span>1. Nomor Surat, Tanggal &amp; Tujuan</span>
                    {openSection === 'surat' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {openSection === 'surat' && (
                    <div className={`p-4 pt-2 border-t space-y-3.5 ${isDark ? 'border-stone-800' : 'border-stone-200/80'}`}>
                      <div className="grid grid-cols-12 gap-3">
                        <div className="col-span-8">
                          <label className={labelClass}>Nomor Surat</label>
                          <input
                            type="text"
                            className={inputClass}
                            value={draft.nomorSurat}
                            onChange={(e) => setDraft({ ...draft, nomorSurat: e.target.value })}
                          />
                        </div>
                        <div className="col-span-4">
                          <label className={labelClass}>Lampiran</label>
                          <input
                            type="text"
                            className={inputClass}
                            value={draft.lampiranText}
                            onChange={(e) => setDraft({ ...draft, lampiranText: e.target.value })}
                          />
                        </div>
                      </div>
                      <div>
                        <label className={labelClass}>Tempat &amp; Tanggal Surat</label>
                        <input
                          type="text"
                          className={inputClass}
                          value={draft.tanggalSurat}
                          onChange={(e) => setDraft({ ...draft, tanggalSurat: e.target.value })}
                          placeholder="Sumberbaru, 16 November 2026"
                        />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-xs font-semibold">Daftar Tujuan (Kepada Yth.)</label>
                          <button
                            type="button"
                            onClick={() => setDraft({ ...draft, kepadaList: [...draft.kepadaList, ''] })}
                            className="text-xs font-semibold text-red-800 dark:text-amber-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" /> Tambah Baris
                          </button>
                        </div>
                        <div className="space-y-2">
                          {draft.kepadaList.map((item, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <input
                                type="text"
                                className={inputClass}
                                value={item}
                                onChange={(e) => {
                                  const next = [...draft.kepadaList];
                                  next[idx] = e.target.value;
                                  setDraft({ ...draft, kepadaList: next });
                                }}
                              />
                              {draft.kepadaList.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDraft({
                                      ...draft,
                                      kepadaList: draft.kepadaList.filter((_, i) => i !== idx)
                                    })
                                  }
                                  className="p-2 text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg cursor-pointer"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Accordion 2: Isi Surat & Rincian Acara */}
                <div className={`rounded-2xl border overflow-hidden ${isDark ? 'border-stone-800 bg-stone-950/40' : 'border-stone-200 bg-[#faf8f5]'}`}>
                  <button
                    type="button"
                    onClick={() => setOpenSection(openSection === 'acara' ? 'ttd' : 'acara')}
                    className="w-full px-4 py-3 flex items-center justify-between text-left font-bold text-xs sm:text-sm cursor-pointer"
                  >
                    <span>2. Isi Surat &amp; Rincian Pelaksanaan</span>
                    {openSection === 'acara' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {openSection === 'acara' && (
                    <div className={`p-4 pt-2 border-t space-y-3.5 ${isDark ? 'border-stone-800' : 'border-stone-200/80'}`}>
                      <div>
                        <label className={labelClass}>
                          Paragraf Pembuka <span className="font-normal text-stone-400">(gunakan **teks** untuk huruf tebal)</span>
                        </label>
                        <textarea
                          rows={4}
                          className={inputClass}
                          value={draft.paragrafPembuka}
                          onChange={(e) => setDraft({ ...draft, paragrafPembuka: e.target.value })}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={labelClass}>Hari</label>
                          <input
                            type="text"
                            className={inputClass}
                            value={draft.hari}
                            onChange={(e) => setDraft({ ...draft, hari: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className={labelClass}>Tanggal Pelaksanaan</label>
                          <input
                            type="text"
                            className={inputClass}
                            value={draft.tanggalAcara}
                            onChange={(e) => setDraft({ ...draft, tanggalAcara: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={labelClass}>Pukul</label>
                          <input
                            type="text"
                            className={inputClass}
                            value={draft.pukul}
                            onChange={(e) => setDraft({ ...draft, pukul: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className={labelClass}>Tempat</label>
                          <input
                            type="text"
                            className={inputClass}
                            value={draft.tempatAcara}
                            onChange={(e) => setDraft({ ...draft, tempatAcara: e.target.value })}
                          />
                        </div>
                      </div>
                      <div>
                        <label className={labelClass}>Catatan</label>
                        <input
                          type="text"
                          className={inputClass}
                          value={draft.acara}
                          onChange={(e) => setDraft({ ...draft, acara: e.target.value })}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Accordion 3: Penandatangan, NPA & Tembusan */}
                <div className={`rounded-2xl border overflow-hidden ${isDark ? 'border-stone-800 bg-stone-950/40' : 'border-stone-200 bg-[#faf8f5]'}`}>
                  <button
                    type="button"
                    onClick={() => setOpenSection(openSection === 'ttd' ? 'surat' : 'ttd')}
                    className="w-full px-4 py-3 flex items-center justify-between text-left font-bold text-xs sm:text-sm cursor-pointer"
                  >
                    <span>3. Penandatangan (Kepengurusan) &amp; Tembusan</span>
                    {openSection === 'ttd' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {openSection === 'ttd' && (
                    <div className={`p-4 pt-2 border-t space-y-4 ${isDark ? 'border-stone-800' : 'border-stone-200/80'}`}>
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-xs font-semibold">Daftar Tembusan</label>
                          <button
                            type="button"
                            onClick={() => setDraft({ ...draft, tembusanList: [...draft.tembusanList, ''] })}
                            className="text-xs font-semibold text-red-800 dark:text-amber-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" /> Tambah
                          </button>
                        </div>
                        <div className="space-y-2">
                          {draft.tembusanList.map((item, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <span className="text-xs font-bold w-5 text-stone-400">{idx + 1}.</span>
                              <input
                                type="text"
                                className={inputClass}
                                value={item}
                                onChange={(e) => {
                                  const next = [...draft.tembusanList];
                                  next[idx] = e.target.value;
                                  setDraft({ ...draft, tembusanList: next });
                                }}
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setDraft({
                                    ...draft,
                                    tembusanList: draft.tembusanList.filter((_, i) => i !== idx)
                                  })
                                }
                                className="p-2 text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Tombol Simpan Merah PGRI */}
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={() => handleSaveToArchive()}
                    disabled={isSavingCloud}
                    className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-red-800 hover:bg-red-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 transition-colors"
                  >
                    {isSavingCloud ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    <span>
                      {savedInvitations.some((item) => item.id === draft.id)
                        ? 'Perbarui Arsip Undangan'
                        : 'Simpan ke Arsip Undangan'}
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* Daftar Arsip Undangan Tersimpan di Kolom Kiri */}
            <div className={`rounded-2xl border p-5 space-y-3.5 ${cardClass}`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display font-bold text-sm">Arsip Undangan Tersimpan ({savedInvitations.length})</h3>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={handleCreateNewDraft}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-red-800/15 text-red-800 dark:bg-amber-500/15 dark:text-amber-300 hover:bg-red-800/25 dark:hover:bg-amber-500/25 cursor-pointer transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    Draft Baru
                  </button>
                )}
              </div>

              {isSyncingArchive ? (
                <div className="py-6 flex items-center justify-center gap-2 text-xs text-stone-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Memuat arsip undangan...
                </div>
              ) : savedInvitations.length === 0 ? (
                <p className="text-xs text-stone-400 py-6 text-center">
                  {isAdmin
                    ? 'Belum ada undangan tersimpan di arsip. Isi formulir di atas lalu klik "Simpan ke Arsip Undangan".'
                    : 'Belum ada surat undangan yang diterbitkan oleh Pengurus.'}
                </p>
              ) : (
                <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                  {savedInvitations.map((inv) => {
                    const isActiveDraft = draft.id === inv.id;
                    return (
                      <div
                        key={inv.id}
                        className={`p-3.5 rounded-2xl border space-y-2 ${
                          isActiveDraft
                            ? isDark
                              ? 'bg-red-950/35 border-red-700/60'
                              : 'bg-red-50/80 border-red-300'
                            : isDark
                              ? 'bg-stone-950/60 border-stone-800'
                              : 'bg-[#faf8f5] border-stone-200/80'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h4 className="font-bold text-xs truncate">{inv.title || inv.acara}</h4>
                            <p className="font-mono text-[11px] text-stone-400 truncate mt-0.5">{inv.nomorSurat}</p>
                            <p className="text-[11px] text-stone-400 mt-0.5">
                              {inv.hari}, {inv.tanggalAcara} • {inv.tempatAcara}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <button
                            type="button"
                            onClick={() => handleLoadIntoEditor(inv, false)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors ${
                              isActiveDraft
                                ? 'bg-red-800 text-white'
                                : 'bg-red-800/15 text-red-800 dark:bg-amber-500/15 dark:text-amber-300 hover:bg-red-800/25'
                            }`}
                          >
                            {isAdmin ? <Edit3 className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                            <span>{isAdmin ? 'Buka & Edit' : 'Lihat Surat'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadPdf(inv)}
                            className="px-2.5 py-1 rounded-lg bg-amber-600/15 text-amber-800 dark:text-amber-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <Download className="w-3 h-3" />
                            <span>PDF</span>
                          </button>
                          {isAdmin && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleLoadIntoEditor(inv, true)}
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer ${
                                  isDark ? 'bg-stone-800 text-stone-300' : 'bg-stone-200/80 text-stone-700'
                                }`}
                              >
                                <Copy className="w-3 h-3" />
                                <span>Duplikat</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteArchiveTarget(inv)}
                                className="p-1 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-500/15 ml-auto cursor-pointer"
                                title="Hapus arsip undangan"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Kolom Kanan: Live Preview A4 */}
          <div className="xl:col-span-7">
            <div className={`rounded-2xl border p-4 sm:p-5 ${cardClass}`}>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="font-display text-sm font-bold flex items-center gap-2">
                    <Printer className="w-4 h-4 text-red-800 dark:text-amber-400" />
                    Pratinjau Langsung Dokumen PDF (1 Halaman A4)
                  </h2>
                  <p className={`text-xs ${isDark ? 'text-stone-400' : 'text-stone-500'}`}>
                    Tampilan di bawah ini identik dengan hasil file PDF utuh yang akan diunduh.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((prev) => {
                        const nextVal = !(prev.showTtdImages && prev.showStempel);
                        return { ...prev, showTtdImages: nextVal, showStempel: nextVal };
                      })
                    }
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border cursor-pointer transition-colors ${
                      draft.showTtdImages && draft.showStempel
                        ? isDark
                          ? 'bg-emerald-950/50 border-emerald-700/60 text-emerald-300'
                          : 'bg-emerald-50 border-emerald-300 text-emerald-800'
                        : isDark
                          ? 'bg-stone-800 border-stone-700 text-stone-300'
                          : 'bg-[#faf8f5] border-stone-200 text-stone-600'
                    }`}
                    title="Sembunyikan jika ingin mencetak kosong untuk tanda tangan & stempel basah"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {draft.showTtdImages && draft.showStempel ? 'TTD & Stempel: Tampil' : 'TTD & Stempel: Basah'}
                  </button>
                  {isAdmin && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          const nextNum = buildAutoLetterNumber('Und', savedInvitations.length);
                          setDraft((prev) => ({ ...prev, nomorSurat: nextNum }));
                          showToast('success', `Nomor surat otomatis diterapkan: ${nextNum}`);
                        }}
                        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border cursor-pointer transition-colors ${
                          isDark ? 'bg-stone-800 border-stone-700 text-stone-200 hover:bg-stone-700' : 'bg-[#faf8f5] border-stone-200 text-stone-700 hover:bg-stone-100'
                        }`}
                        title="Buat nomor surat otomatis sesuai format PGRI Ranting"
                      >
                        <Hash className="w-3.5 h-3.5" />
                        Auto No. Surat
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const tujuanText =
                            draft.kepadaList.map((k) => k.trim()).filter(Boolean).join(', ') ||
                            'Seluruh Anggota PGRI Ranting Gelang';
                          const res = await quickRecordOutgoingAgenda({
                            nomorSurat: draft.nomorSurat,
                            asalTujuan: tujuanText,
                            perihal: draft.perihal || draft.acara || 'Undangan Resmi',
                            catatan: `Acara: ${draft.acara} (${draft.hari}, ${draft.tanggalAcara} • ${draft.tempatAcara})`
                          });
                          if (!res.ok) {
                            showToast('error', res.error || 'Gagal mencatat undangan ke Surat Keluar.');
                          } else if (res.error) {
                            showToast('error', `Tercatat lokal, namun sinkron Cloud gagal: ${res.error}`);
                          } else {
                            showToast(
                              'success',
                              res.updatedExisting
                                ? `Undangan No. ${draft.nomorSurat} diperbarui di Buku Agenda Surat Keluar.`
                                : `Undangan No. ${draft.nomorSurat} berhasil dicatat ke Buku Agenda Surat Keluar.`
                            );
                          }
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-amber-600/15 text-amber-800 dark:text-amber-300 border border-amber-500/35 hover:bg-amber-600/25 transition cursor-pointer"
                        title="Catat otomatis nomor dan perihal undangan ini ke Buku Agenda Surat Keluar"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        Catat ke Surat Keluar
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      const msg =
                        `✉️ *UNDANGAN RESMI PGRI RANTING GELANG*\n` +
                        `Nomor: ${draft.nomorSurat}\n` +
                        `Perihal: *${draft.perihal}*\n\n` +
                        `📅 Hari/Tanggal: ${draft.hari}, ${draft.tanggalAcara}\n` +
                        `⏰ Waktu: ${draft.pukul}\n` +
                        `📍 Tempat: ${draft.tempatAcara}\n` +
                        `📌 Agenda: ${draft.acara}\n\n` +
                        `Mohon kehadiran Bapak/Ibu tepat waktu. Terima kasih.`;
                      try {
                        await navigator.clipboard.writeText(msg);
                        showToast('success', 'Teks pengumuman undangan berhasil disalin ke clipboard.');
                      } catch {
                        showToast('error', 'Gagal menyalin teks ke clipboard.');
                      }
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border cursor-pointer transition-colors ${
                      isDark ? 'bg-stone-800 border-stone-700 text-stone-200 hover:bg-stone-700' : 'bg-[#faf8f5] border-stone-200 text-stone-700 hover:bg-stone-100'
                    }`}
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Salin Teks
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const msg =
                        `✉️ *UNDANGAN RESMI PGRI RANTING GELANG*\n` +
                        `Nomor: ${draft.nomorSurat}\n` +
                        `Perihal: *${draft.perihal}*\n\n` +
                        `📅 Hari/Tanggal: ${draft.hari}, ${draft.tanggalAcara}\n` +
                        `⏰ Waktu: ${draft.pukul}\n` +
                        `📍 Tempat: ${draft.tempatAcara}\n` +
                        `📌 Agenda: ${draft.acara}\n\n` +
                        `Mohon kehadiran Bapak/Ibu tepat waktu. Terima kasih.`;
                      openWhatsAppShare(msg);
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/25 transition cursor-pointer"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    Bagikan WA
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadPdf(draft)}
                    disabled={isGeneratingPdf}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-red-800 hover:bg-red-700 text-white cursor-pointer disabled:opacity-60 transition-colors"
                  >
                    {isGeneratingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                    Unduh PDF
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto pb-2">
                <div className="flex flex-col items-center gap-6 min-w-fit">
                  <div
                    className="shadow-2xl border border-stone-300 rounded-sm overflow-hidden bg-white"
                    style={{ width: '210mm' }}
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* SUB-MODUL E-OFFICE: SURAT TUGAS, PENGAWAS UJIAN, BUKU AGENDA SURAT, NOTULEN RAPAT */}
      {(viewMode === 'surat_tugas' || viewMode === 'pengawas_ujian' || viewMode === 'agenda_surat' || viewMode === 'notulen') && (
        <EOfficeSubPanels
          mode={viewMode}
          isAdmin={isAdmin}
          isDark={isDark}
          teachers={teachers}
          events={events}
          attendanceList={attendanceList}
          onNotice={showToast}
          onSaveArchiveItem={handleSaveToArchive}
          isSavingCloud={isSavingCloud}
          archiveCount={savedInvitations.length}
          loadedArchiveItem={loadedArchiveForSubPanel}
        />
      )}

      {/* Modal Konfirmasi Hapus Arsip Undangan */}
      {deleteArchiveTarget && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-stone-950/75 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setDeleteArchiveTarget(null)}
        >
          <div
            className={`w-full max-w-md rounded-2xl p-6 border shadow-2xl space-y-4 ${cardClass}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 text-red-700 dark:text-red-400">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isDark ? 'bg-red-950/70 border border-red-800/60' : 'bg-red-50 border border-red-200'}`}>
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display font-bold text-base">Konfirmasi Hapus Arsip Undangan</h3>
                <p className="text-xs opacity-80">Data akan dihapus dari perangkat dan Cloud.</p>
              </div>
            </div>
            <p className={`text-sm ${isDark ? 'text-stone-300' : 'text-stone-600'}`}>
              Apakah Anda yakin ingin menghapus arsip undangan{' '}
              <span className="font-bold">&quot;{deleteArchiveTarget.title || deleteArchiveTarget.perihal || deleteArchiveTarget.nomorSurat}&quot;</span>?
            </p>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeleteArchiveTarget(null)}
                className={`flex-1 px-4 py-2.5 rounded-xl font-bold text-xs cursor-pointer ${
                  isDark ? 'bg-stone-800 hover:bg-stone-700 text-stone-300' : 'bg-stone-100 hover:bg-stone-200 text-stone-700'
                }`}
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  const idToDelete = deleteArchiveTarget.id;
                  setDeleteArchiveTarget(null);
                  void handleDeleteArchive(idToDelete);
                }}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-800 hover:bg-red-700 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>Ya, Hapus</span>
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
  );
};

export default BuatUndangan;
