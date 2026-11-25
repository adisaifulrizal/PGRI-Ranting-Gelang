import React, { useState, useEffect, useMemo } from 'react';
import {
  HeartHandshake,
  ShieldAlert,
  Plus,
  Send,
  Lock,
  CheckCircle2,
  Trash2,
  Share2,
  X,
  MessageSquareHeart,
  LogIn,
  Printer,
  Loader2
} from 'lucide-react';
import { AspirasiItem, DanaSosialItem, PengurusRole } from '../../types';
import { auth } from '../../lib/firebase';
import {
  fetchPerDocCollection,
  savePerDocItem,
  deletePerDocItem,
  removeFromOfflineQueue,
  mutateCloudCollection,
  fetchCloudVersions,
  shouldFetchByVersion,
  markLocalVersionSynced
} from '../../lib/sync';
import { canManageConfidentialAspirasi, formatGoogleAuthError, logAuditEvent, signInPengurusWithGoogle } from '../../lib/auth';
import { getOrgConfig, openWhatsAppShare } from '../../lib/orgConfig';
import { isMobileDevice, downloadContainerAsPdf, resolveKetuaSigner, escapePdfHtml } from '../../lib/pdfExport';
import { safeDownloadBlob } from '../../lib/download';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';

interface SosialAspirasiViewProps {
  activeRole: 'guru' | 'admin';
  pengurusRole?: PengurusRole;
  theme?: 'light' | 'dark';
}

const DANA_SOSIAL_KEY = 'pgri-dana-sosial';
const ASPIRASI_KEY = 'pgri-aspirasi-local';

export const SosialAspirasiView: React.FC<SosialAspirasiViewProps> = ({
  activeRole,
  pengurusRole = 'guru' as PengurusRole,
  theme = 'light'
}) => {
  const isDark = theme === 'dark';
  const effectiveRole: PengurusRole = pengurusRole;
  const canManageDana =
    activeRole === 'admin' || ['ketua', 'sekretaris', 'bendahara'].includes(effectiveRole);
  const canDeleteDana =
    activeRole === 'admin' && (effectiveRole === 'ketua' || effectiveRole === 'bendahara');
  const canReadAllAspirasi =
    canManageConfidentialAspirasi(effectiveRole) || (activeRole === 'admin' && effectiveRole === 'ketua');

  const [activeSubTab, setActiveSubTab] = useState<'dana' | 'aspirasi'>('dana');

  // --- DANA SOSIAL STATE ---
  const [danaList, setDanaList] = useState<DanaSosialItem[]>(() => {
    try {
      const saved = localStorage.getItem(DANA_SOSIAL_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });
  const [showDanaModal, setShowDanaModal] = useState(false);
  const [isPrintingDana, setIsPrintingDana] = useState(false);
  const [danaForm, setDanaForm] = useState<Omit<DanaSosialItem, 'id'>>({
    type: 'Penyaluran',
    category: 'Sakit / Rawat Inap',
    recipientName: '',
    recipientSchool: '',
    amount: 0,
    date: new Date().toISOString().split('T')[0],
    notes: '',
    status: 'Tersalurkan'
  });

  // --- ASPIRASI / ADVOKASI LKBH STATE ---
  const [aspirasiList, setAspirasiList] = useState<AspirasiItem[]>(() => {
    try {
      const saved = localStorage.getItem(ASPIRASI_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });
  const [aspForm, setAspForm] = useState({
    senderName: auth.currentUser?.displayName || '',
    senderSchool: '',
    senderPhone: '',
    isAnonymous: false,
    category: 'Aspirasi Organisasi' as AspirasiItem['category'],
    subject: '',
    message: ''
  });
  const [aspNotice, setAspNotice] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<AspirasiItem | null>(null);
  const [replyStatus, setReplyStatus] = useState<AspirasiItem['status']>('Ditindaklanjuti');
  const [replyText, setReplyText] = useState('');

  useEffect(() => {
    let mounted = true;
    const loadDanaSosial = async () => {
      try {
        const lastSync = sessionStorage.getItem('pgri_dana_sosial_sync_ts');
        if (lastSync && Date.now() - Number(lastSync) < 120000) {
          return;
        }
      } catch {}

      try {
        const cloudVersions = await fetchCloudVersions(45000);
        if (!mounted) return;
        if (!shouldFetchByVersion('dana_sosial', cloudVersions)) {
          try {
            sessionStorage.setItem('pgri_dana_sosial_sync_ts', String(Date.now()));
          } catch {}
          return;
        }

        const cloud = await fetchPerDocCollection<DanaSosialItem>('dana_sosial');
        if (!mounted) return;
        if (Array.isArray(cloud)) {
          const hasCloudVersion = Boolean(cloudVersions && Number(cloudVersions.dana_sosial || 0) > 0);
          if (cloud.length > 0 || hasCloudVersion) {
            setDanaList(cloud);
            try {
              localStorage.setItem(DANA_SOSIAL_KEY, JSON.stringify(cloud));
            } catch {}
          }
          markLocalVersionSynced('dana_sosial', cloudVersions);
          try {
            sessionStorage.setItem('pgri_dana_sosial_sync_ts', String(Date.now()));
          } catch {}
        }
      } catch {}
    };
    loadDanaSosial();
    const handleExternalSync = () => {
      try {
        const savedDana = localStorage.getItem(DANA_SOSIAL_KEY);
        if (savedDana) {
          const parsed = JSON.parse(savedDana);
          if (Array.isArray(parsed)) setDanaList(parsed);
        }
        const savedAsp = localStorage.getItem(ASPIRASI_KEY);
        if (savedAsp) {
          const parsedAsp = JSON.parse(savedAsp);
          if (Array.isArray(parsedAsp)) setAspirasiList(parsedAsp);
        }
      } catch {}
    };
    window.addEventListener('pgri-sosial-synced', handleExternalSync);
    return () => {
      mounted = false;
      window.removeEventListener('pgri-sosial-synced', handleExternalSync);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadAspirasi = async () => {
      if (activeSubTab !== 'aspirasi') return;
      const user = auth.currentUser;
      if (!user || !user.emailVerified) return;

      const scopeKey = `${user.uid}_${canReadAllAspirasi ? 'all' : 'own'}`;
      const tsKey = `pgri_aspirasi_sync_ts_${scopeKey}`;
      try {
        const lastSync = sessionStorage.getItem(tsKey);
        if (lastSync && Date.now() - Number(lastSync) < 90000) {
          return;
        }
      } catch {}

      try {
        const cloudVersions = await fetchCloudVersions(45000);
        if (!mounted) return;
        const prevScope = sessionStorage.getItem('pgri_aspirasi_last_scope');
        const scopeChanged = prevScope !== scopeKey;
        if (!scopeChanged && !shouldFetchByVersion('aspirasi_items', cloudVersions)) {
          try {
            sessionStorage.setItem(tsKey, String(Date.now()));
          } catch {}
          return;
        }

        const q = canReadAllAspirasi
          ? collection(db, 'aspirasi_items')
          : query(collection(db, 'aspirasi_items'), where('authorUid', '==', user.uid));
        const snap = await getDocs(q);
        const rows: AspirasiItem[] = [];
        snap.forEach((d) => rows.push(d.data() as AspirasiItem));
        rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        if (mounted) {
          setAspirasiList(rows);
          try {
            localStorage.setItem(ASPIRASI_KEY, JSON.stringify(rows));
            sessionStorage.setItem('pgri_aspirasi_last_scope', scopeKey);
            sessionStorage.setItem(tsKey, String(Date.now()));
          } catch {}
          markLocalVersionSynced('aspirasi_items', cloudVersions);
        }
      } catch (e) {
        console.info('Memuat aspirasi dari penyimpanan lokal.');
      }
    };
    loadAspirasi();
    return () => {
      mounted = false;
    };
  }, [canReadAllAspirasi, activeSubTab]);

  const danaStats = useMemo(() => {
    const masuk = danaList
      .filter((d) => d.type === 'Penggalangan')
      .reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const keluar = danaList
      .filter((d) => d.type === 'Penyaluran')
      .reduce((s, d) => s + (Number(d.amount) || 0), 0);
    return { masuk, keluar, saldo: masuk - keluar };
  }, [danaList]);

  const handlePrintDanaSosial = async () => {
    if (isPrintingDana) return;
    setIsPrintingDana(true);
    let container: HTMLDivElement | null = null;
    try {
      const orgCfg = getOrgConfig();
      const logoPgri = localStorage.getItem('logo-pgri') || localStorage.getItem('logo-kombel') || '';
      const ttdKetua = localStorage.getItem('ttd-ketua') || '';
      const ttdKetuaScale = Math.max(0.3, Math.min(2.5, (Number(localStorage.getItem('ttd-ketua-size')) || 100) / 100));
      const stempel = localStorage.getItem('logo-stempel') || '';
      const stempelScale = Math.max(0.3, Math.min(2.5, (Number(localStorage.getItem('logo-stempel-size')) || 100) / 100));
      const stempelRotation = Number(localStorage.getItem('logo-stempel-rotation')) || 0;
      const ketuaSigner = resolveKetuaSigner();
      const kopOrg = escapePdfHtml(orgCfg.kopOrganisasi || 'PERSATUAN GURU REPUBLIK INDONESIA');
      const kopRanting = escapePdfHtml(orgCfg.kopRanting || 'RANTING GELANG');
      const kopWilayah = escapePdfHtml(orgCfg.kopWilayah || 'KECAMATAN SUMBERBARU - KABUPATEN JEMBER');
      const kopSekretariat = escapePdfHtml(orgCfg.kopSekretariat || 'Sekretariat : Jl. PTPN XII Gunung Gambir Desa Gelang, Kecamatan Sumberbaru - Kabupaten Jember 68156');
      const todayFormatted = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

      const rows = danaList.length === 0
        ? `<tr><td colspan="7" style="text-align:center;font-style:italic;color:#64748b;padding:12px;">Belum ada catatan dana sosial / tali asih.</td></tr>`
        : danaList
            .map(
              (item, idx) => `
          <tr>
            <td style="text-align:center;">${idx + 1}</td>
            <td style="text-align:center;">${escapePdfHtml(item.date || '-')}</td>
            <td style="text-align:center;font-weight:bold;color:${item.type === 'Penggalangan' ? '#047857' : '#b91c1c'};">${escapePdfHtml(item.type)}</td>
            <td>${escapePdfHtml(item.category)}</td>
            <td><strong>${escapePdfHtml(item.recipientName)}</strong>${item.recipientSchool ? `<br/><span style="font-size:9pt;color:#475569;">${escapePdfHtml(item.recipientSchool)}</span>` : ''}</td>
            <td style="text-align:right;font-weight:bold;">Rp ${(Number(item.amount) || 0).toLocaleString('id-ID')}</td>
            <td>${escapePdfHtml(item.notes || '-')}</td>
          </tr>`
            )
            .join('');

      const bodyHtml = `
        <div class="kop-container">
          <div class="kop-logo-wrapper">
            ${logoPgri
              ? `<img src="${logoPgri}" alt="Logo PGRI" class="kop-logo" />`
              : `<div style="width: 86px; height: 86px; border: 1.5px dashed #94a3b8; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9pt; color: #64748b; text-align: center;">Logo<br/>PGRI</div>`}
          </div>
          <div class="kop-text-container">
            <div class="kop-org">${kopOrg}</div>
            <div class="kop-sub-org">(Teachers Association Of Republic Indonesia)</div>
            <div class="kop-ranting">${kopRanting}</div>
            <div class="kop-wilayah">${kopWilayah}</div>
            <div class="kop-sekretariat">${kopSekretariat}</div>
          </div>
          <div style="width: 90px; flex-shrink: 0;"></div>
        </div>
        <div class="kop-divider"></div>
        <h2>LAPORAN DANA SOSIAL &amp; TALI ASIH</h2>
        <p class="sub">Dicetak pada ${escapePdfHtml(todayFormatted)}</p>
        <div class="summary-grid">
          <div class="summary-box">
            <div class="summary-label">Total Penggalangan</div>
            <div class="summary-val" style="color:#047857;">Rp ${danaStats.masuk.toLocaleString('id-ID')}</div>
          </div>
          <div class="summary-box">
            <div class="summary-label">Total Tersalurkan</div>
            <div class="summary-val" style="color:#b91c1c;">Rp ${danaStats.keluar.toLocaleString('id-ID')}</div>
          </div>
          <div class="summary-box">
            <div class="summary-label">Saldo Dana Sosial</div>
            <div class="summary-val" style="color:#b45309;">Rp ${danaStats.saldo.toLocaleString('id-ID')}</div>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th style="width:36px;">No</th>
              <th style="width:92px;">Tanggal</th>
              <th style="width:98px;">Jenis</th>
              <th style="width:140px;">Kategori</th>
              <th>Penerima / Keterangan Sumber</th>
              <th style="width:120px;">Nominal</th>
              <th>Catatan</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="signature-container">
          <div class="signature-box">
            <p style="margin: 0;">Sumberbaru, ${escapePdfHtml(todayFormatted)}</p>
            <p style="margin: 0;">${escapePdfHtml(ketuaSigner.jabatan)}</p>
            <p style="margin: 0;">Kecamatan Sumberbaru</p>
            <div class="signature-space">
              ${stempel ? `<img src="${stempel}" alt="Stempel" style="position: absolute; top: 50%; right: 50%; transform: translateY(-50%) rotate(${stempelRotation}deg); width: ${Math.round(112 * stempelScale)}px; height: ${Math.round(112 * stempelScale)}px; object-fit: contain; opacity: 0.9; z-index: 0; pointer-events: none;" />` : ''}
              ${ttdKetua ? `<img src="${ttdKetua}" alt="TTD Ketua" class="signature-img" />` : ''}
            </div>
            <p style="margin: 0;" class="signature-name">${escapePdfHtml(ketuaSigner.name)}</p>
            <p style="margin: 0;">${escapePdfHtml(ketuaSigner.npaLabel)}</p>
          </div>
        </div>
      `;

      const sharedCss = `
        * { box-sizing: border-box; font-family: 'Times New Roman', Times, serif; }
        .kop-container { display: flex; align-items: center; gap: 12px; padding-bottom: 6px; }
        .kop-logo-wrapper { width: 90px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
        .kop-logo { width: 86px; height: 86px; object-fit: contain; display: block; }
        .kop-text-container { flex: 1; text-align: center; line-height: 1.18; color: #000000; }
        .kop-org { font-size: 13pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.3px; }
        .kop-sub-org { font-size: 10pt; font-weight: bold; font-style: italic; margin-top: 1px; }
        .kop-ranting { font-size: 16pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 1px; }
        .kop-wilayah { font-size: 11.5pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.3px; margin-top: 1px; }
        .kop-sekretariat { font-size: 8.5pt; font-style: italic; margin-top: 2px; }
        .kop-divider { border-top: 2px solid #000000; border-bottom: 1px solid #000000; height: 2px; margin-bottom: 14px; }
        h2 { margin: 0; text-align: center; font-size: 13.5pt; text-decoration: underline; text-underline-offset: 4px; }
        .sub { text-align: center; font-size: 10pt; color: #334155; margin: 6px 0 12px; }
        .summary-grid { display: flex; gap: 10px; margin-bottom: 14px; }
        .summary-box { flex: 1; border: 1px solid #000000; padding: 8px 10px; text-align: center; background: #f8fafc; }
        .summary-label { font-size: 9pt; text-transform: uppercase; color: #334155; font-weight: bold; }
        .summary-val { font-size: 11.5pt; font-weight: bold; margin-top: 2px; }
        table { width: 100%; border-collapse: collapse; font-size: 10pt; }
        th, td { border: 1px solid #000000; padding: 6px 8px; vertical-align: top; }
        th { background: #f1f5f9; text-align: center; }
        .signature-container { margin-top: 22px; display: flex; justify-content: flex-end; page-break-inside: avoid; break-inside: avoid; }
        .signature-box { width: 250px; text-align: center; font-size: 10pt; line-height: 1.3; }
        .signature-space { height: 65px; position: relative; display: flex; align-items: center; justify-content: center; overflow: visible; }
        .signature-img { height: ${Math.round(62 * ttdKetuaScale)}px; width: auto; max-width: ${Math.round(160 * ttdKetuaScale)}px; object-fit: contain; position: relative; z-index: 1; }
        .signature-name { font-weight: bold; text-decoration: underline; }
      `;

      const fullHtml = `
        <!doctype html>
        <html lang="id">
          <head>
            <meta charset="utf-8" />
            <title>Laporan Dana Sosial PGRI Ranting Gelang</title>
            <style>
              @page { size: A4 landscape; margin: 12mm 14mm; }
              body { font-family: 'Times New Roman', Times, serif; padding: 16px; color: #000000; background: #ffffff; }
              ${sharedCss}
            </style>
          </head>
          <body>
            ${bodyHtml}
            <script>window.onload = function() { window.print(); }</script>
          </body>
        </html>
      `;

      const printWin = !isMobileDevice() ? window.open('', '_blank', 'width=960,height=720') : null;
      if (printWin) {
        printWin.document.write(fullHtml);
        printWin.document.close();
        return;
      }

      try {
        container = document.createElement('div');
        container.style.width = '1050px';
        container.style.backgroundColor = '#ffffff';
        container.style.color = '#000000';
        container.style.fontFamily = "'Times New Roman', Times, serif";
        container.style.padding = '16px';
        container.innerHTML = `<style data-pdf-style="true">${sharedCss}</style>${bodyHtml}`;
        const filename = `Laporan_Dana_Sosial_PGRI_${new Date().toISOString().split('T')[0]}.pdf`;
        await downloadContainerAsPdf(container, {
          filename,
          orientation: 'landscape',
          margin: [10, 12, 10, 12],
          quality: 0.96,
          scale: 2
        });
      } catch {
        const htmlBlob = new Blob([fullHtml.replace('<script>window.onload = function() { window.print(); }</script>', '')], {
          type: 'text/html;charset=utf-8'
        });
        await safeDownloadBlob(htmlBlob, `Laporan_Dana_Sosial_PGRI_${new Date().toISOString().split('T')[0]}.html`);
      }
    } finally {
      if (container && document.body.contains(container)) {
        document.body.removeChild(container);
      }
      setIsPrintingDana(false);
    }
  };

  const handleSaveDana = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!danaForm.recipientName.trim()) return;
    const item: DanaSosialItem = {
      id: `ds-${Date.now()}`,
      ...danaForm,
      recipientName: danaForm.recipientName.trim().slice(0, 160),
      recipientSchool: danaForm.recipientSchool.trim().slice(0, 160),
      amount: Math.max(0, Number(danaForm.amount) || 0),
      notes: danaForm.notes.trim().slice(0, 600)
    };
    const next = [item, ...danaList];
    setDanaList(next);
    try {
      localStorage.setItem(DANA_SOSIAL_KEY, JSON.stringify(next));
    } catch {}
    setShowDanaModal(false);

    await savePerDocItem('dana_sosial', item.id, item, 'Dana Sosial');
    try {
      sessionStorage.setItem('pgri_dana_sosial_sync_ts', String(Date.now()));
    } catch {}
    mutateCloudCollection<DanaSosialItem>(
      'danaSosial',
      [DANA_SOSIAL_KEY],
      (latest) => [item, ...latest.filter((d) => d.id !== item.id)],
      next,
      'Dana Sosial & Tali Asih'
    );
    logAuditEvent(
      'Dana Sosial',
      `Catat ${item.type}`,
      `${item.type} ${item.category} a.n. ${item.recipientName} sebesar Rp ${item.amount.toLocaleString('id-ID')}.`
    );
  };

  const handleDeleteDana = async (item: DanaSosialItem) => {
    const prevList = [...danaList];
    const next = danaList.filter((d) => d.id !== item.id);
    setDanaList(next);
    try {
      localStorage.setItem(DANA_SOSIAL_KEY, JSON.stringify(next));
    } catch {}
    removeFromOfflineQueue('dana_sosial', item.id);
    const perDocRes = await deletePerDocItem('dana_sosial', item.id, 'Dana Sosial');
    if (perDocRes.success) {
      try {
        sessionStorage.setItem('pgri_dana_sosial_sync_ts', String(Date.now()));
      } catch {}
    } else if (perDocRes.error?.toLowerCase().includes('permission')) {
      setDanaList(prevList);
      try {
        localStorage.setItem(DANA_SOSIAL_KEY, JSON.stringify(prevList));
      } catch {}
      return;
    }
    await mutateCloudCollection<DanaSosialItem>(
      'danaSosial',
      [DANA_SOSIAL_KEY],
      (latest) => latest.filter((d) => d.id !== item.id),
      next,
      'Dana Sosial & Tali Asih'
    );
    void logAuditEvent(
      'Dana Sosial',
      'Hapus Catatan',
      `Menghapus ${item.type} ${item.category} a.n. ${item.recipientName} (Rp ${(Number(item.amount) || 0).toLocaleString('id-ID')}).`
    );
  };

  const handleSubmitAspirasi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aspForm.subject.trim() || !aspForm.message.trim()) return;

    let user = auth.currentUser;
    if (!user) {
      try {
        const res = await signInPengurusWithGoogle();
        user = res.user;
      } catch (err) {
        setAspNotice(formatGoogleAuthError(err));
        return;
      }
    }

    const record: AspirasiItem = {
      id: `asp-${Date.now()}`,
      authorUid: user.uid,
      senderName: aspForm.isAnonymous
        ? 'Anggota Anonim'
        : (aspForm.senderName.trim() || user.displayName || 'Anggota PGRI').slice(0, 140),
      senderSchool: aspForm.senderSchool.trim().slice(0, 140),
      senderPhone: aspForm.senderPhone.trim().slice(0, 40),
      isAnonymous: aspForm.isAnonymous,
      category: aspForm.category,
      subject: aspForm.subject.trim().slice(0, 200),
      message: aspForm.message.trim().slice(0, 2000),
      status: 'Diterima',
      response: '',
      createdAt: new Date().toISOString()
    };

    const next = [record, ...aspirasiList];
    setAspirasiList(next);
    try {
      localStorage.setItem(ASPIRASI_KEY, JSON.stringify(next));
    } catch {}

    await savePerDocItem('aspirasi_items', record.id, record, 'Aspirasi Anggota');
    setAspForm({
      ...aspForm,
      subject: '',
      message: ''
    });
    setAspNotice('Aspirasi/laporan Anda berhasil dikirim secara rahasia kepada Ketua & Sekretaris PGRI Ranting Gelang.');
  };

  const handleSaveReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyTarget) return;
    const updated: AspirasiItem = {
      ...replyTarget,
      status: replyStatus,
      response: replyText.trim().slice(0, 1500)
    };
    const next = aspirasiList.map((a) => (a.id === updated.id ? updated : a));
    setAspirasiList(next);
    try {
      localStorage.setItem(ASPIRASI_KEY, JSON.stringify(next));
    } catch {}
    await savePerDocItem('aspirasi_items', updated.id, {
      status: updated.status,
      response: updated.response
    }, 'Tindak Lanjut Aspirasi');
    logAuditEvent(
      'Aspirasi & Advokasi',
      'Tindak Lanjut',
      `Memperbarui status aspirasi "${updated.subject}" menjadi ${updated.status}.`
    );
    setReplyTarget(null);
  };

  const cardClass = isDark
    ? 'bg-stone-900 border-stone-800 text-stone-100'
    : 'bg-white border-stone-200/90 text-stone-800';

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header Banner — Wibawa Kusuma Bangsa */}
      <div
        className={`relative overflow-hidden rounded-2xl p-6 sm:p-8 border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
          isDark
            ? 'bg-gradient-to-br from-[#231214] via-stone-900 to-[#1a1112] border-red-900/40 text-stone-100 pgri-batik-pattern-dark'
            : 'bg-gradient-to-br from-[#fdfbf7] via-white to-red-50/50 border-stone-200/90 text-stone-900 pgri-batik-pattern'
        }`}
      >
        <div className="absolute top-0 inset-x-0 h-[3px] pgri-top-accent pointer-events-none" />
        <div className="relative z-10">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-red-800 dark:text-amber-400 mb-1.5">
            <HeartHandshake className="w-3.5 h-3.5" />
            Solidaritas &amp; Perlindungan Profesi
          </p>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight">
            Dana Sosial &amp; Kanal Aspirasi
          </h1>
          <p className={`text-xs sm:text-sm mt-1 ${isDark ? 'text-stone-400' : 'text-stone-600'}`}>
            Transparansi Tali Asih anggota dan layanan pengaduan/advokasi (LKBH) PGRI Ranting Gelang.
          </p>
        </div>

        {/* Sub-tab Switcher */}
        <div
          className={`relative z-10 flex p-1 rounded-xl border ${
            isDark ? 'bg-stone-950/80 border-stone-800' : 'bg-white/90 border-stone-200'
          }`}
        >
          <button
            type="button"
            onClick={() => setActiveSubTab('dana')}
            className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors ${
              activeSubTab === 'dana'
                ? 'bg-red-800 text-white shadow-sm'
                : isDark
                ? 'text-stone-400 hover:text-stone-100'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <MessageSquareHeart className="w-4 h-4" />
            Dana Sosial &amp; Tali Asih
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('aspirasi')}
            className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors ${
              activeSubTab === 'aspirasi'
                ? 'bg-amber-700 text-white shadow-sm'
                : isDark
                ? 'text-stone-400 hover:text-stone-100'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <ShieldAlert className="w-4 h-4" />
            Aspirasi &amp; Advokasi (LKBH)
          </button>
        </div>
      </div>

      {/* TAB 1: DANA SOSIAL & TALI ASIH */}
      {activeSubTab === 'dana' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className={`p-4 rounded-2xl border ${cardClass}`}>
              <span className="text-xs font-semibold text-stone-400">Total Penggalangan</span>
              <p className="text-xl font-black font-display text-emerald-500 mt-1">
                Rp {danaStats.masuk.toLocaleString('id-ID')}
              </p>
            </div>
            <div className={`p-4 rounded-2xl border ${cardClass}`}>
              <span className="text-xs font-semibold text-stone-400">Total Santunan Tersalurkan</span>
              <p className="text-xl font-black font-display text-red-600 dark:text-red-400 mt-1">
                Rp {danaStats.keluar.toLocaleString('id-ID')}
              </p>
            </div>
            <div className={`p-4 rounded-2xl border ${cardClass}`}>
              <span className="text-xs font-semibold text-stone-400">Saldo Dana Sosial</span>
              <p className="text-xl font-black font-display text-amber-600 dark:text-amber-400 mt-1">
                Rp {danaStats.saldo.toLocaleString('id-ID')}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display font-bold text-base">Riwayat Dana Sosial & Tali Asih</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handlePrintDanaSosial}
                disabled={isPrintingDana}
                className={`px-3.5 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-colors ${
                  isPrintingDana ? 'opacity-60 cursor-wait' : 'cursor-pointer'
                } ${
                  isDark
                    ? 'bg-stone-800 hover:bg-stone-700 border-stone-700 text-stone-100'
                    : 'bg-white hover:bg-stone-50 border-stone-300 text-stone-800'
                }`}
              >
                {isPrintingDana ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-red-700 dark:text-amber-400" />
                ) : (
                  <Printer className="w-3.5 h-3.5 text-red-700 dark:text-amber-400" />
                )}
                {isPrintingDana ? 'Menyiapkan...' : 'Cetak / PDF'}
              </button>
              <button
                type="button"
                onClick={() => {
                  const text = `*LAPORAN DANA SOSIAL & TALI ASIH PGRI RANTING GELANG*\n\nTotal Penggalangan: Rp ${danaStats.masuk.toLocaleString('id-ID')}\nTotal Tersalurkan: Rp ${danaStats.keluar.toLocaleString('id-ID')}\nSaldo Dana Sosial: Rp ${danaStats.saldo.toLocaleString('id-ID')}\n\nTerima kasih atas solidaritas seluruh anggota PGRI Ranting Gelang.`;
                  openWhatsAppShare(text);
                }}
                className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5" />
                Bagikan WA
              </button>
              {canManageDana && (
                <button
                  type="button"
                  onClick={() => setShowDanaModal(true)}
                  className="px-4 py-2 rounded-xl bg-red-800 hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Catat Santunan / Penggalangan
                </button>
              )}
            </div>
          </div>

          {danaList.length === 0 ? (
            <div className={`p-8 rounded-2xl border text-center ${cardClass}`}>
              <HeartHandshake className="w-10 h-10 text-red-700 dark:text-amber-400 mx-auto mb-2 opacity-75" />
              <p className="text-sm font-semibold">Belum ada catatan dana sosial / tali asih.</p>
              <p className="text-xs text-stone-400 mt-1">
                Pengurus dapat mencatat penggalangan dan penyaluran santunan anggota sakit, duka cita, maupun purna tugas di sini.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {danaList.map((item) => (
                <div key={item.id} className={`p-4 rounded-2xl border space-y-2 ${cardClass}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`px-2.5 py-0.5 rounded-md text-[11px] font-bold ${
                          item.type === 'Penggalangan'
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            : 'bg-red-500/15 text-red-700 dark:text-red-400'
                        }`}
                      >
                        {item.type}
                      </span>
                      <span className="px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-400">
                        {item.category}
                      </span>
                    </div>
                    {canDeleteDana && (
                      <button
                        type="button"
                        onClick={() => handleDeleteDana(item)}
                        className="p-1 text-stone-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                        title="Hapus"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <h3 className="font-bold text-sm">
                    {item.recipientName}{' '}
                    {item.recipientSchool && (
                      <span className="text-xs font-normal text-stone-400">({item.recipientSchool})</span>
                    )}
                  </h3>
                  <p className="text-lg font-black font-display text-amber-500">
                    Rp {(item.amount || 0).toLocaleString('id-ID')}
                  </p>
                  {item.notes && <p className="text-xs text-stone-400">{item.notes}</p>}
                  <div className="flex items-center justify-between text-[11px] text-stone-400 pt-2 border-t border-stone-500/15">
                    <span>Tanggal: {item.date}</span>
                    <span className="font-bold text-emerald-500">{item.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: KOTAK ASPIRASI & ADVOKASI LKBH */}
      {activeSubTab === 'aspirasi' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Form Kirim Aspirasi */}
          <div className={`lg:col-span-5 p-6 rounded-2xl border space-y-4 ${cardClass}`}>
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-xl bg-red-800/15 text-red-800 dark:text-amber-400">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-display font-bold text-base">Kirim Aspirasi / Advokasi</h2>
                <p className="text-[11px] text-stone-400">
                  Bersifat rahasia — hanya dapat dibaca oleh Ketua & Sekretaris PGRI Ranting.
                </p>
              </div>
            </div>

            {aspNotice && (
              <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{aspNotice}</span>
              </div>
            )}

            <form onSubmit={handleSubmitAspirasi} className="space-y-3">
              <div>
                <label className="block text-xs font-bold mb-1">Kategori</label>
                <select
                  value={aspForm.category}
                  onChange={(e) => setAspForm({ ...aspForm, category: e.target.value as AspirasiItem['category'] })}
                  className={`w-full px-3.5 py-2.5 rounded-xl text-xs border outline-none ${
                    isDark ? 'bg-stone-800 border-stone-700 text-white' : 'bg-[#faf8f5] border-stone-200'
                  }`}
                >
                  <option value="Aspirasi Organisasi">Aspirasi Organisasi</option>
                  <option value="Advokasi / LKBH">Advokasi / Perlindungan Hukum (LKBH)</option>
                  <option value="Administrasi PPPK/PNS">Administrasi PPPK / PNS / GTK</option>
                  <option value="Kesejahteraan & Tunjangan">Kesejahteraan & Tunjangan</option>
                  <option value="Lainnya">Lainnya</option>
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">Nama Pengirim</label>
                  <input
                    type="text"
                    disabled={aspForm.isAnonymous}
                    placeholder="Nama lengkap"
                    value={aspForm.isAnonymous ? 'Anonim (Dirahasiakan)' : aspForm.senderName}
                    onChange={(e) => setAspForm({ ...aspForm, senderName: e.target.value })}
                    className={`w-full px-3.5 py-2 rounded-xl text-xs border outline-none ${
                      isDark ? 'bg-stone-800 border-stone-700 text-white' : 'bg-[#faf8f5] border-stone-200'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">Unit Kerja / Sekolah</label>
                  <input
                    type="text"
                    placeholder="SDN Gelang ..."
                    value={aspForm.senderSchool}
                    onChange={(e) => setAspForm({ ...aspForm, senderSchool: e.target.value })}
                    className={`w-full px-3.5 py-2 rounded-xl text-xs border outline-none ${
                      isDark ? 'bg-stone-800 border-stone-700 text-white' : 'bg-[#faf8f5] border-stone-200'
                    }`}
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={aspForm.isAnonymous}
                  onChange={(e) => setAspForm({ ...aspForm, isAnonymous: e.target.checked })}
                  className="rounded accent-red-800 dark:accent-amber-500"
                />
                <span>Sembunyikan nama saya (Kirim sebagai Anonim)</span>
              </label>

              <div>
                <label className="block text-xs font-bold mb-1">Perihal / Judul *</label>
                <input
                  type="text"
                  required
                  placeholder="Ringkasan aspirasi atau kendala..."
                  value={aspForm.subject}
                  onChange={(e) => setAspForm({ ...aspForm, subject: e.target.value })}
                  className={`w-full px-3.5 py-2.5 rounded-xl text-xs border outline-none ${
                    isDark ? 'bg-stone-800 border-stone-700 text-white' : 'bg-[#faf8f5] border-stone-200'
                  }`}
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">Isi Aspirasi / Laporan *</label>
                <textarea
                  rows={4}
                  required
                  placeholder="Tuliskan aspirasi, saran, atau permohonan pendampingan organisasi secara jelas..."
                  value={aspForm.message}
                  onChange={(e) => setAspForm({ ...aspForm, message: e.target.value })}
                  className={`w-full px-3.5 py-2.5 rounded-xl text-xs border outline-none ${
                    isDark ? 'bg-stone-800 border-stone-700 text-white' : 'bg-[#faf8f5] border-stone-200'
                  }`}
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-red-800 hover:bg-red-700 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
              >
                <Send className="w-4 h-4" />
                Kirim Secara Rahasia
              </button>
            </form>
          </div>

          {/* Daftar Aspirasi (Ketua/Sekretaris: Semua, Anggota: Miliknya Sendiri) */}
          <div className={`lg:col-span-7 p-6 rounded-2xl border space-y-4 ${cardClass}`}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display font-bold text-base">
                  {canReadAllAspirasi ? 'Kotak Masuk Aspirasi (Ketua & Sekretaris)' : 'Riwayat Aspirasi Saya'}
                </h2>
                <p className="text-xs text-stone-400">
                  {canReadAllAspirasi
                    ? 'Seluruh aspirasi anggota terproteksi dan hanya terlihat oleh Ketua & Sekretaris.'
                    : 'Hanya menampilkan aspirasi yang Anda kirim menggunakan akun Google Anda.'}
                </p>
              </div>
              {!auth.currentUser && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await signInPengurusWithGoogle();
                    } catch (err) {
                      setAspNotice(formatGoogleAuthError(err));
                    }
                  }}
                  className="px-3 py-2 rounded-xl bg-red-800 hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  Masuk Google
                </button>
              )}
            </div>

            {aspirasiList.length === 0 ? (
              <div className="py-12 text-center text-stone-400 text-xs">
                Belum ada aspirasi yang tercatat untuk akun ini.
              </div>
            ) : (
              <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
                {aspirasiList.map((item) => (
                  <div
                    key={item.id}
                    className={`p-4 rounded-2xl border space-y-2 ${
                      isDark ? 'bg-stone-800/50 border-stone-700/70' : 'bg-[#faf8f5] border-stone-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-red-800/15 text-red-800 dark:text-amber-400">
                        {item.category}
                      </span>
                      <span
                        className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold ${
                          item.status === 'Selesai'
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            : item.status === 'Ditindaklanjuti'
                            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                            : 'bg-stone-500/20 text-stone-500 dark:text-stone-400'
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>
                    <h4 className="font-bold text-sm">{item.subject}</h4>
                    <p className="text-xs leading-relaxed opacity-85">{item.message}</p>
                    <div className="text-[11px] text-stone-400 flex items-center justify-between pt-1">
                      <span>
                        Pengirim: <strong>{item.senderName}</strong> {item.senderSchool ? `(${item.senderSchool})` : ''}
                      </span>
                      <span>{new Date(item.createdAt).toLocaleDateString('id-ID')}</span>
                    </div>

                    {item.response && (
                      <div className="mt-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs">
                        <span className="font-bold text-emerald-600 dark:text-emerald-400 block mb-0.5">Tanggapan Pengurus:</span>
                        <span>{item.response}</span>
                      </div>
                    )}

                    {canReadAllAspirasi && (
                      <div className="pt-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            setReplyTarget(item);
                            setReplyStatus(item.status);
                            setReplyText(item.response || '');
                          }}
                          className="text-xs font-bold text-red-800 dark:text-amber-400 hover:underline cursor-pointer"
                        >
                          Tindak Lanjuti / Beri Tanggapan
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Catat Dana Sosial */}
      {showDanaModal && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-stone-950/75 backdrop-blur-sm"
          onClick={() => setShowDanaModal(false)}
        >
          <div className={`w-full max-w-md rounded-2xl p-6 border shadow-2xl ${cardClass}`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-stone-500/20">
              <h3 className="font-display font-bold text-base">Catat Dana Sosial / Tali Asih</h3>
              <button type="button" onClick={() => setShowDanaModal(false)} className="p-1 text-stone-400 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveDana} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">Jenis</label>
                  <select
                    value={danaForm.type}
                    onChange={(e) =>
                      setDanaForm({ ...danaForm, type: e.target.value as DanaSosialItem['type'] })
                    }
                    className={`w-full px-3 py-2 rounded-xl text-xs border outline-none ${
                      isDark ? 'bg-stone-800 border-stone-700 text-white' : 'bg-[#faf8f5] border-stone-200'
                    }`}
                  >
                    <option value="Penggalangan">Penggalangan</option>
                    <option value="Penyaluran">Penyaluran</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">Kategori</label>
                  <select
                    value={danaForm.category}
                    onChange={(e) =>
                      setDanaForm({ ...danaForm, category: e.target.value as DanaSosialItem['category'] })
                    }
                    className={`w-full px-3 py-2 rounded-xl text-xs border outline-none ${
                      isDark ? 'bg-stone-800 border-stone-700 text-white' : 'bg-[#faf8f5] border-stone-200'
                    }`}
                  >
                    <option value="Sakit / Rawat Inap">Sakit / Rawat Inap</option>
                    <option value="Duka Cita">Duka Cita</option>
                    <option value="Purna Tugas / Pensiun">Purna Tugas / Pensiun</option>
                    <option value="Pernikahan / Kelahiran">Pernikahan / Kelahiran</option>
                    <option value="Bencana / Lainnya">Bencana / Lainnya</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">Nama Penerima / Kegiatan *</label>
                <input
                  type="text"
                  required
                  value={danaForm.recipientName}
                  onChange={(e) => setDanaForm({ ...danaForm, recipientName: e.target.value })}
                  className={`w-full px-3.5 py-2 rounded-xl text-xs border outline-none ${
                    isDark ? 'bg-stone-800 border-stone-700 text-white' : 'bg-[#faf8f5] border-stone-200'
                  }`}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">Sekolah / Unit Kerja</label>
                  <input
                    type="text"
                    value={danaForm.recipientSchool}
                    onChange={(e) => setDanaForm({ ...danaForm, recipientSchool: e.target.value })}
                    className={`w-full px-3 py-2 rounded-xl text-xs border outline-none ${
                      isDark ? 'bg-stone-800 border-stone-700 text-white' : 'bg-[#faf8f5] border-stone-200'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">Nominal (Rp)</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={danaForm.amount}
                    onChange={(e) => setDanaForm({ ...danaForm, amount: Number(e.target.value) })}
                    className={`w-full px-3 py-2 rounded-xl text-xs border outline-none ${
                      isDark ? 'bg-stone-800 border-stone-700 text-white' : 'bg-[#faf8f5] border-stone-200'
                    }`}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">Tanggal</label>
                  <input
                    type="date"
                    value={danaForm.date}
                    onChange={(e) => setDanaForm({ ...danaForm, date: e.target.value })}
                    className={`w-full px-3 py-2 rounded-xl text-xs border outline-none ${
                      isDark ? 'bg-stone-800 border-stone-700 text-white' : 'bg-[#faf8f5] border-stone-200'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">Status</label>
                  <select
                    value={danaForm.status}
                    onChange={(e) =>
                      setDanaForm({ ...danaForm, status: e.target.value as DanaSosialItem['status'] })
                    }
                    className={`w-full px-3 py-2 rounded-xl text-xs border outline-none ${
                      isDark ? 'bg-stone-800 border-stone-700 text-white' : 'bg-[#faf8f5] border-stone-200'
                    }`}
                  >
                    <option value="Terkumpul">Terkumpul</option>
                    <option value="Proses">Proses</option>
                    <option value="Tersalurkan">Tersalurkan</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">Keterangan</label>
                <textarea
                  rows={2}
                  value={danaForm.notes}
                  onChange={(e) => setDanaForm({ ...danaForm, notes: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl text-xs border outline-none ${
                    isDark ? 'bg-stone-800 border-stone-700 text-white' : 'bg-[#faf8f5] border-stone-200'
                  }`}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowDanaModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-stone-500/15 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-red-800 hover:bg-red-700 text-white cursor-pointer"
                >
                  Simpan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Tanggapi Aspirasi */}
      {replyTarget && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-stone-950/75 backdrop-blur-sm"
          onClick={() => setReplyTarget(null)}
        >
          <div className={`w-full max-w-md rounded-2xl p-6 border shadow-2xl ${cardClass}`} onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display font-bold text-base mb-1">Tindak Lanjut Aspirasi</h3>
            <p className="text-xs text-stone-400 mb-4">{replyTarget.subject}</p>
            <form onSubmit={handleSaveReply} className="space-y-3">
              <div>
                <label className="block text-xs font-bold mb-1">Status Penanganan</label>
                <select
                  value={replyStatus}
                  onChange={(e) => setReplyStatus(e.target.value as AspirasiItem['status'])}
                  className={`w-full px-3 py-2 rounded-xl text-xs border outline-none ${
                    isDark ? 'bg-stone-800 border-stone-700 text-white' : 'bg-[#faf8f5] border-stone-200'
                  }`}
                >
                  <option value="Diterima">Diterima</option>
                  <option value="Ditindaklanjuti">Ditindaklanjuti</option>
                  <option value="Selesai">Selesai</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">Tanggapan Resmi Pengurus</label>
                <textarea
                  rows={4}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  className={`w-full px-3 py-2 rounded-xl text-xs border outline-none ${
                    isDark ? 'bg-stone-800 border-stone-700 text-white' : 'bg-[#faf8f5] border-stone-200'
                  }`}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setReplyTarget(null)}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-stone-500/15 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-red-800 hover:bg-red-700 text-white cursor-pointer"
                >
                  Simpan Tanggapan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
