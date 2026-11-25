import { safeDownloadBlob } from '../../lib/download';
import { mutateCloudCollection, savePerDocItem, deletePerDocItem, syncSettingsToCloud } from '../../lib/sync';
import { buildDefaultProfilCandidates, DEFAULT_KETUA_FALLBACK, getOrgConfig, openWhatsAppShare } from '../../lib/orgConfig';
import { logAuditEvent } from '../../lib/auth';
import { isMobileDevice, downloadContainerAsPdf } from '../../lib/pdfExport';
import { generateQrSvgDataUrl } from '../../lib/qrGenerator';
import React, { useState, useMemo, useEffect } from 'react';
import { FinancialTransaction, CashPayment, Teacher, ActivityEvent } from '../../types';
import {
  Plus,
  ArrowUpCircle,
  ArrowDownCircle,
  Wallet,
  AlertCircle,
  Trash2,
  CheckCircle,
  User,
  Download,
  Pencil,
  X,
  Check,
  ShieldCheck,
  UserX,
  FileText,
  Users,
  Calendar,
  Send,
  CreditCard,
  Copy,
  CheckCheck,
  Image as ImageIcon,
  School,
  Share2,
  FileSpreadsheet,
  UserCheck,
  SlidersHorizontal,
  QrCode,
  Receipt,
  Loader2
} from 'lucide-react';

const POS_ANGGARAN_OPTIONS: NonNullable<FinancialTransaction['category']>[] = [
  'Kontribusi Anggota',
  'Setoran PGRI Cabang',
  'Dana Sosial / Tali Asih',
  'Kegiatan HGN / PORSENI',
  'Operasional Sekretariat',
  'Lainnya'
];

const getCategoryBadgeStyle = (category?: string) => {
  switch (category) {
    case 'Iuran Anggota':
    case 'Kontribusi Anggota':
      return 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/50';
    case 'Setoran PGRI Cabang':
      return 'bg-sky-50 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300 border-sky-200/80 dark:border-sky-800/50';
    case 'Dana Sosial / Tali Asih':
      return 'bg-rose-50 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 border-rose-200/80 dark:border-rose-800/50';
    case 'Kegiatan HGN / PORSENI':
      return 'bg-amber-50 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border-amber-200/80 dark:border-amber-800/50';
    case 'Operasional Sekretariat':
      return 'bg-indigo-50 text-indigo-800 dark:bg-indigo-950/70 dark:text-indigo-300 border-indigo-200/80 dark:border-indigo-800/50';
    default:
      return 'bg-purple-50 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 border-purple-200/80 dark:border-purple-800/50';
  }
};

const escapeHtmlSafe = (val: string) =>
  String(val || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Helper validasi anggota aktif (sesuai logika pada Jadwal Kegiatan)
const isMemberActive = (t: Teacher): boolean => {
  if (!t) return false;
  if ((t as any).isActive !== undefined && (t as any).isActive !== null) {
    if (typeof (t as any).isActive === 'boolean') return (t as any).isActive;
    if (typeof (t as any).isActive === 'string') return (t as any).isActive.toLowerCase() === 'true' || (t as any).isActive === '1' || (t as any).isActive.toLowerCase() === 'aktif';
    if (typeof (t as any).isActive === 'number') return (t as any).isActive === 1;
  }
  if ((t as any).activeStatus !== undefined && (t as any).activeStatus !== null) {
    return String((t as any).activeStatus).trim().toLowerCase() === 'aktif';
  }
  const status = ((t as any).status || '').toLowerCase();
  if (status.includes('mutasi') || status.includes('pensiun') || status.includes('keluar') || status.includes('non-aktif') || status.includes('nonaktif') || status.includes('almarhum')) {
    return false;
  }
  return true;
};

interface KeuanganViewProps {
  transactions: FinancialTransaction[];
  onTransactionsChange: (transactions: FinancialTransaction[]) => void;
  cashPayments: CashPayment[];
  onCashPaymentsChange: (payments: CashPayment[]) => void;
  teachers: Teacher[];
  events?: ActivityEvent[];
  activeRole?: 'guru' | 'admin';
}

// Komponen Hook Animasi Counter Angka Berjalan
const AnimatedCounter: React.FC<{ value: number; duration?: number }> = ({ value, duration = 600 }) => {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    let startTimestamp: number | null = null;
    const startValue = displayValue;
    const endValue = value;

    if (startValue === endValue) return;

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      // Easing out quadratic
      const easeProgress = 1 - (1 - progress) * (1 - progress);
      const current = Math.floor(startValue + (endValue - startValue) * easeProgress);
      setDisplayValue(current);

      if (progress < 1) {
        window.requestAnimationFrame(step);
      } else {
        setDisplayValue(endValue);
      }
    };

    const animFrame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(animFrame);
  }, [value, duration]);

  return (
    <span>
      {new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(displayValue)}
    </span>
  );
};

export const KeuanganView: React.FC<KeuanganViewProps> = ({
  transactions,
  onTransactionsChange,
  cashPayments,
  onCashPaymentsChange,
  teachers,
  events = [],
  activeRole = 'guru'
}) => {
  // Proteksi role murni berdasarkan activeRole dari parent (App.tsx)
  const isAdmin = activeRole === 'admin';

  const [activeTab, setActiveTab] = useState<'transaksi' | 'peserta'>('transaksi');
  const [isWarningModalOpen, setIsWarningModalOpen] = useState(false);
  const [isClosingWarningModal, setIsClosingWarningModal] = useState(false);
  const [copiedBank, setCopiedBank] = useState(false);

  // Daftar 12 Bulan untuk Pembayaran Kontribusi Kas Bulanan
  const MONTH_OPTIONS = useMemo(() => [
    { id: '01', name: 'Januari' },
    { id: '02', name: 'Februari' },
    { id: '03', name: 'Maret' },
    { id: '04', name: 'April' },
    { id: '05', name: 'Mei' },
    { id: '06', name: 'Juni' },
    { id: '07', name: 'Juli' },
    { id: '08', name: 'Agustus' },
    { id: '09', name: 'September' },
    { id: '10', name: 'Oktober' },
    { id: '11', name: 'November' },
    { id: '12', name: 'Desember' }
  ], []);

  const currentYearStr = useMemo(() => String(new Date().getFullYear()), []);
  const currentMonthId = useMemo(() => String(new Date().getMonth() + 1).padStart(2, '0'), []);

  // Periode Mulai Pembayaran Iuran (Default: November 2026 -> "2026-11", tersimpan di localStorage & Cloud)
  const [duesStartPeriod, setDuesStartPeriod] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('pgri-dues-start-period');
      if (saved && /^\d{4}-\d{2}$/.test(saved)) return saved;
    }
    return '2026-11';
  });
  const duesStartYear = useMemo(() => duesStartPeriod.split('-')[0] || '2026', [duesStartPeriod]);
  const duesStartMonth = useMemo(() => duesStartPeriod.split('-')[1] || '11', [duesStartPeriod]);

  const isPeriodActive = (yearStr: string, monthId: string): boolean => {
    if (!yearStr || !monthId) return true;
    return `${yearStr}-${monthId}` >= duesStartPeriod;
  };

  // Daftar Pilihan Tahun (Dimulai dari tahun mulai pembayaran iuran hingga 2 tahun ke depan)
  const YEAR_OPTIONS = useMemo(() => {
    const curYear = new Date().getFullYear();
    const startYear = Math.min(Number(duesStartYear) || 2026, curYear);
    const endYear = Math.max(curYear + 2, startYear + 1);
    const years: string[] = [];
    for (let y = startYear; y <= endYear; y++) {
      years.push(String(y));
    }
    return years;
  }, [duesStartYear]);

  const initialActivePeriod = useMemo(() => {
    const nowCode = `${currentYearStr}-${currentMonthId}`;
    return nowCode < duesStartPeriod ? duesStartPeriod : nowCode;
  }, [currentYearStr, currentMonthId, duesStartPeriod]);

  // Filter State Khusus Tab Daftar Pembayaran
  const [filterSchool, setFilterSchool] = useState<string>('Semua');
  const [filterYear, setFilterYear] = useState<string>(() => initialActivePeriod.split('-')[0]);
  const [filterMonth, setFilterMonth] = useState<string>(() => initialActivePeriod.split('-')[1]);

  // Modal State Konfirmasi Transfer ke WhatsApp
  const [isConfirmTransferModalOpen, setIsConfirmTransferModalOpen] = useState(false);
  const [isClosingConfirmTransferModal, setIsClosingConfirmTransferModal] = useState(false);
  const [selectedConfirmTeacherId, setSelectedConfirmTeacherId] = useState<string>('');

  // Modal State QRIS Pembayaran
  const [isQrisModalOpen, setIsQrisModalOpen] = useState(false);
  const [isClosingQrisModal, setIsClosingQrisModal] = useState(false);
  const [isDownloadingQris, setIsDownloadingQris] = useState(false);
  const [qrisDownloadError, setQrisDownloadError] = useState<string | null>(null);
  const [isExportingLpj, setIsExportingLpj] = useState(false);
  const [isDownloadingKasPdf, setIsDownloadingKasPdf] = useState(false);

  // Deteksi mode gelap dari tag <html> secara real-time (tanpa flicker awal)
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false
  );

  useEffect(() => {
    if (typeof document !== 'undefined') {
      const observer = new MutationObserver(() => {
        setIsDark(document.documentElement.classList.contains('dark'));
      });

      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class']
      });

      return () => observer.disconnect();
    }
  }, []);

  // Modal State Transaksi (Tambah/Edit/Hapus)
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isClosingModal, setIsClosingModal] = useState(false);
  const [editingTx, setEditingTx] = useState<FinancialTransaction | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; desc: string } | null>(null);
  const [isClosingDeleteModal, setIsClosingDeleteModal] = useState(false);

  // Modal State untuk Verifikasi (Default: 'Belum Bayar')
  const [isVerifikasiModalOpen, setIsVerifikasiModalOpen] = useState(false);
  const [isClosingVerifikasiModal, setIsClosingVerifikasiModal] = useState(false);
  const [verifikasiFilter, setVerifikasiFilter] = useState<'Lunas' | 'Belum Bayar'>('Belum Bayar');
  const [verifikasiRoleFilter, setVerifikasiRoleFilter] = useState<'Semua' | 'Pengurus' | 'Anggota'>('Semua');
  const [isSelectingPengurus, setIsSelectingPengurus] = useState(false);
  const [isBulkUpdatingVerifikasi, setIsBulkUpdatingVerifikasi] = useState(false);
  const [selectedVerifikasiYear, setSelectedVerifikasiYear] = useState<string>(() => initialActivePeriod.split('-')[0]);
  const [selectedVerifikasiMonth, setSelectedVerifikasiMonth] = useState<string>(() => initialActivePeriod.split('-')[1]);
  const [verifikasiToast, setVerifikasiToast] = useState<string | null>(null);

  // Konfigurasi Dinamis Organisasi PGRI (Rekening, WA Bendahara, Nominal Kontribusi)
  const [orgConfig, setOrgConfig] = useState(() => getOrgConfig());
  const [previewReceiptUrl, setPreviewReceiptUrl] = useState<string | null>(null);
  const [isClosingPreviewReceipt, setIsClosingPreviewReceipt] = useState(false);
  const [isRekapSekolahOpen, setIsRekapSekolahOpen] = useState(false);
  const [isClosingRekapSekolah, setIsClosingRekapSekolah] = useState(false);
  const [rekapMonth, setRekapMonth] = useState<string>(() => initialActivePeriod.split('-')[1]);
  const [rekapYear, setRekapYear] = useState<string>(() => initialActivePeriod.split('-')[0]);

  useEffect(() => {
    const syncStartPeriod = () => {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('pgri-dues-start-period');
        if (saved && /^\d{4}-\d{2}$/.test(saved)) {
          setDuesStartPeriod(saved);
          const [y, m] = saved.split('-');
          setFilterYear((prevYear) => {
            const nextY = prevYear < y ? y : prevYear;
            setFilterMonth((prevMonth) => (prevMonth !== 'Semua' && `${nextY}-${prevMonth}` < saved ? m : prevMonth));
            return nextY;
          });
          setSelectedVerifikasiYear((prevYear) => {
            const nextY = prevYear < y ? y : prevYear;
            setSelectedVerifikasiMonth((prevMonth) => (`${nextY}-${prevMonth}` < saved ? m : prevMonth));
            return nextY;
          });
          setRekapYear((prevYear) => {
            const nextY = prevYear < y ? y : prevYear;
            setRekapMonth((prevMonth) => (`${nextY}-${prevMonth}` < saved ? m : prevMonth));
            return nextY;
          });
        }
      }
    };
    window.addEventListener('storage', syncStartPeriod);
    window.addEventListener('kombel-settings-updated', syncStartPeriod);
    return () => {
      window.removeEventListener('storage', syncStartPeriod);
      window.removeEventListener('kombel-settings-updated', syncStartPeriod);
    };
  }, []);

  const [receiptPreviewTarget, setReceiptPreviewTarget] = useState<{
    teacher: Teacher;
    month: { id: string; name: string };
    year: string;
    payment: CashPayment;
  } | null>(null);
  const [isClosingReceiptPreview, setIsClosingReceiptPreview] = useState(false);
  const [isDownloadingReceipt, setIsDownloadingReceipt] = useState(false);

  const handleClosePreviewReceipt = () => {
    setIsClosingPreviewReceipt(true);
    setTimeout(() => {
      setPreviewReceiptUrl(null);
      setIsClosingPreviewReceipt(false);
    }, 250);
  };

  const handleCloseRekapSekolah = () => {
    setIsClosingRekapSekolah(true);
    setTimeout(() => {
      setIsRekapSekolahOpen(false);
      setIsClosingRekapSekolah(false);
    }, 250);
  };

  const handleCloseReceiptPreview = () => {
    setIsClosingReceiptPreview(true);
    setTimeout(() => {
      setReceiptPreviewTarget(null);
      setIsClosingReceiptPreview(false);
    }, 250);
  };

  useEffect(() => {
    const syncOrg = () => setOrgConfig(getOrgConfig());
    window.addEventListener('storage', syncOrg);
    window.addEventListener('kombel-settings-updated', syncOrg);
    return () => {
      window.removeEventListener('storage', syncOrg);
      window.removeEventListener('kombel-settings-updated', syncOrg);
    };
  }, []);

  const [formData, setFormData] = useState<{
    date: string;
    type: 'Pemasukan' | 'Pengeluaran';
    amount: string;
    description: string;
    volume: string;
    satuan: string;
    category: NonNullable<FinancialTransaction['category']>;
    receiptImage: string;
  }>({
    date: new Date().toISOString().split('T')[0],
    type: 'Pengeluaran',
    amount: '',
    description: '',
    volume: '',
    satuan: '',
    category: 'Operasional Sekretariat',
    receiptImage: ''
  });
  const [receiptError, setReceiptError] = useState<string>('');

  const handleReceiptFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReceiptError('');
    const reader = new FileReader();
    reader.onload = (ev) => {
      const raw = ev.target?.result as string;
      const img = new Image();
      img.onload = () => {
        try {
          const compressWith = (maxDim: number, quality: number) => {
            let w = img.width;
            let h = img.height;
            if (w > h && w > maxDim) {
              h = Math.round(h * (maxDim / w));
              w = maxDim;
            } else if (h >= w && h > maxDim) {
              w = Math.round(w * (maxDim / h));
              h = maxDim;
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) return '';
            ctx.drawImage(img, 0, 0, w, h);
            return canvas.toDataURL('image/jpeg', quality);
          };

          let compressed = compressWith(560, 0.68);
          if (compressed.length > 350000) {
            compressed = compressWith(560, 0.45);
          }
          if (compressed.length > 350000) {
            compressed = compressWith(400, 0.45);
          }

          if (compressed && compressed.length <= 350000) {
            setFormData((prev) => ({ ...prev, receiptImage: compressed }));
          } else {
            setFormData((prev) => ({ ...prev, receiptImage: '' }));
            setReceiptError('Ukuran gambar nota melebihi batas 350 KB setelah dikompresi. Gunakan foto beresolusi lebih kecil.');
          }
        } catch {
          if (raw && raw.length <= 350000) {
            setFormData((prev) => ({ ...prev, receiptImage: raw }));
          } else {
            setFormData((prev) => ({ ...prev, receiptImage: '' }));
            setReceiptError('Gagal mengompresi foto nota (>350 KB). Silakan pilih foto lain yang lebih ringan.');
          }
        }
      };
      img.onerror = () => {
        setReceiptError('Format gambar nota tidak didukung atau file rusak.');
      };
      img.src = raw;
    };
    reader.readAsDataURL(file);
  };

  // Helper copy rekening (dinamis dari Pengaturan)
  const handleCopyAccount = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(orgConfig.bankAccountNumber);
    setCopiedBank(true);
    setTimeout(() => setCopiedBank(false), 2000);
  };

  // Helper untuk menentukan jenis kelamin anggota
  const getGender = (t: Teacher): 'L' | 'P' => {
    if (t.gender) return t.gender;
    const femaleNames = ['Siti', 'Rina', 'Dewi', 'Sri', 'Nurul', 'Fitriani', 'Lilik', 'Maya', 'Anisa', 'Yulia', 'Titin', 'Dwi', 'Neni', 'Ratna', 'Ika', 'Indah'];
    return femaleNames.some(n => t.name && t.name.includes(n)) ? 'P' : 'L';
  };

  // Memuat seluruh kandidat perorangan dari ProfilKBView (Struktur Pengurus, Penanggung Jawab, Pembina) + fallback lengkap
  const loadAllProfilCandidates = (): (Teacher & { jabatanPengurus?: string; kategoriProfil?: string; isPengurus?: boolean })[] => {
    const fallbackAll = buildDefaultProfilCandidates();

    if (typeof window === 'undefined') return fallbackAll as any;

    const candidates: any[] = [];
    const isCollectiveOrInvalid = (name?: string) => {
      if (!name) return true;
      const lower = name.trim().toLowerCase();
      return lower === '' || lower === '-' || lower.startsWith('semua ');
    };

    try {
      // 1. Struktur Kepengurusan (kombel-pengurus) - gunakan data terbaru dari Pengaturan, fallback hanya jika belum ada
      const savedPengurus = localStorage.getItem('kombel-pengurus');
      const pengurusSource = savedPengurus ? JSON.parse(savedPengurus) : null;
      if (Array.isArray(pengurusSource) && pengurusSource.length > 0) {
        pengurusSource.forEach((p: any, idx: number) => {
          if (isCollectiveOrInvalid(p?.name)) return;
          candidates.push({
            id: p.id || `pengurus-${idx + 1}`,
            name: p.name.trim(),
            nip: p.nip && p.nip !== '-' ? p.nip : '',
            school: p.instansi && p.instansi !== '-' ? p.instansi : 'PGRI Ranting Gelang',
            phone: p.wa && p.wa !== '-' ? p.wa : '',
            jabatanPengurus: p.role || 'Pengurus',
            kategoriProfil: 'Pengurus Ranting',
            isPengurus: true
          });
        });
      } else {
        fallbackAll
          .filter(f => f.kategoriProfil === 'Pengurus Ranting')
          .forEach(f => candidates.push(f));
      }

      // 2. Penanggung Jawab (kombel-penanggungjawab)
      const savedPj = localStorage.getItem('kombel-penanggungjawab');
      const pjSource = savedPj ? JSON.parse(savedPj) : null;
      if (Array.isArray(pjSource) && pjSource.length > 0) {
        pjSource.forEach((p: any, idx: number) => {
          if (isCollectiveOrInvalid(p?.name)) return;
          if (!candidates.some(c => c.name.trim().toLowerCase() === p.name.trim().toLowerCase())) {
            candidates.push({
              id: `pj-${idx + 1}`,
              name: p.name.trim(),
              nip: p.nip && p.nip !== '-' ? p.nip : '',
              school: p.instansi && p.instansi !== '-' ? p.instansi : 'Penanggung Jawab',
              phone: p.wa && p.wa !== '-' ? p.wa : '',
              jabatanPengurus: p.role || 'Penanggung Jawab',
              kategoriProfil: 'Penanggung Jawab',
              isPengurus: true
            });
          }
        });
      } else {
        fallbackAll
          .filter(f => f.kategoriProfil === 'Penanggung Jawab')
          .forEach(f => candidates.push(f));
      }

      // 3. Pembina (kombel-pembina)
      const savedPembina = localStorage.getItem('kombel-pembina');
      const pembinaSource = savedPembina ? JSON.parse(savedPembina) : null;
      if (pembinaSource && !isCollectiveOrInvalid(pembinaSource.name)) {
        if (!candidates.some(c => c.name.trim().toLowerCase() === pembinaSource.name.trim().toLowerCase())) {
          candidates.push({
            id: 'pembina-1',
            name: pembinaSource.name.trim(),
            nip: pembinaSource.nip && pembinaSource.nip !== '-' ? pembinaSource.nip : '',
            school: pembinaSource.instansi && pembinaSource.instansi !== '-' ? pembinaSource.instansi : 'Pembina',
            phone: pembinaSource.wa && pembinaSource.wa !== '-' ? pembinaSource.wa : '',
            jabatanPengurus: pembinaSource.role || 'Pengawas Bina',
            kategoriProfil: 'Pembina',
            isPengurus: true
          });
        }
      } else {
        fallbackAll
          .filter(f => f.kategoriProfil === 'Pembina')
          .forEach(f => candidates.push(f));
      }
    } catch (e) {
      console.warn('Gagal memuat kandidat pengurus dari ProfilKBView:', e);
      return fallbackAll as any;
    }

    return candidates.length > 0 ? candidates : (fallbackAll as any);
  };

  const [allProfilCandidates, setAllProfilCandidates] = useState(() => loadAllProfilCandidates());

  // Daftar nama pengurus yang dipilih untuk ikut diverifikasi (disimpan di localStorage)
  const [selectedPengurusNames, setSelectedPengurusNames] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('pgri-verified-pengurus-names');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch {}
    }
    // Default: otomatis memilih pengurus inti & seksi dari kategori 'Pengurus Ranting'
    return loadAllProfilCandidates()
      .filter(c => c.kategoriProfil === 'Pengurus Ranting')
      .map(c => c.name.trim().toLowerCase());
  });

  const persistSelectedPengurusNames = (next: string[]) => {
    const serialized = JSON.stringify(next);
    try {
      localStorage.setItem('pgri-verified-pengurus-names', serialized);
    } catch {}
    void syncSettingsToCloud({ 'pgri-verified-pengurus-names': serialized }, 'Daftar Pengurus Wajib Kontribusi');
  };

  const handleToggleSelectedPengurus = (memberName: string) => {
    const key = memberName.trim().toLowerCase();
    setSelectedPengurusNames(prev => {
      const exists = prev.includes(key);
      const next = exists ? prev.filter(n => n !== key) : [...prev, key];
      persistSelectedPengurusNames(next);
      return next;
    });
  };

  const pengurusTeachers = useMemo(() => {
    return allProfilCandidates.filter(c =>
      selectedPengurusNames.includes(c.name.trim().toLowerCase())
    );
  }, [allProfilCandidates, selectedPengurusNames]);

  useEffect(() => {
    const handleSyncPengurus = () => {
      setAllProfilCandidates(loadAllProfilCandidates());
      try {
        const saved = localStorage.getItem('pgri-verified-pengurus-names');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) setSelectedPengurusNames(parsed);
        }
      } catch {}
    };
    window.addEventListener('storage', handleSyncPengurus);
    window.addEventListener('kombel-settings-updated', handleSyncPengurus);
    return () => {
      window.removeEventListener('storage', handleSyncPengurus);
      window.removeEventListener('kombel-settings-updated', handleSyncPengurus);
    };
  }, []);

  // Menggabungkan Pengurus Terpilih & Anggota Sekolah tanpa duplikasi (Urut A-Z)
  const sortedTeachers = useMemo(() => {
    let baseTeachers: Teacher[] = Array.isArray(teachers) && teachers.length > 0 ? [...teachers] : [];
    if (baseTeachers.length === 0 && typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('kombel-teachers');
        if (saved) baseTeachers = JSON.parse(saved);
      } catch (e) {
        console.warn('Gagal memuat fallback teachers:', e);
      }
    }

    const normalizeName = (name?: string) =>
      (name || '').replace(/(,?\s*(S\.Pd\.I|S\.Pd|M\.Pd|S\.Kom|M\.Si|Dr|Dra|Drs)\.?)/gi, '').trim().toLowerCase();

    const combined: any[] = baseTeachers.map(t => ({ ...t, isPengurus: false }));

    pengurusTeachers.forEach(p => {
      const pNorm = normalizeName(p.name);
      const existingIdx = combined.findIndex(
        c =>
          c.id === p.id ||
          (p.nip && c.nip && String(c.nip).trim() === String(p.nip).trim()) ||
          (pNorm && normalizeName(c.name) === pNorm)
      );

      if (existingIdx !== -1) {
        // Jika sudah ada di daftar anggota sekolah, tempelkan jabatan pengurusnya tanpa membuat baris ganda
        combined[existingIdx] = {
          ...combined[existingIdx],
          isPengurus: true,
          jabatanPengurus: p.jabatanPengurus
        };
      } else {
        combined.push({ ...p, isPengurus: true });
      }
    });

    return combined
      .filter(isMemberActive)
      .sort((a, b) =>
        (a.name || '').localeCompare(b.name || '', 'id', { sensitivity: 'base' })
      );
  }, [teachers, pengurusTeachers]);

  // Set default guru yang terpilih di modal konfirmasi saat daftar guru dimuat
  useEffect(() => {
    if (sortedTeachers.length > 0 && !selectedConfirmTeacherId) {
      setSelectedConfirmTeacherId(sortedTeachers[0].id);
    }
  }, [sortedTeachers, selectedConfirmTeacherId]);

  const selectedConfirmTeacher = useMemo(() => {
    return (
      sortedTeachers.find(t => t.id === selectedConfirmTeacherId) ||
      teachers.find(t => t.id === selectedConfirmTeacherId) ||
      sortedTeachers[0] ||
      null
    );
  }, [teachers, sortedTeachers, selectedConfirmTeacherId]);

  // Modal Handlers dengan animasi Smooth Closing
  const handleOpenConfirmTransferModal = () => {
    setIsClosingConfirmTransferModal(false);
    setIsConfirmTransferModalOpen(true);
  };

  const handleCloseConfirmTransferModal = () => {
    setIsClosingConfirmTransferModal(true);
    setTimeout(() => {
      setIsConfirmTransferModalOpen(false);
      setIsClosingConfirmTransferModal(false);
    }, 250);
  };

  const handleOpenQrisModal = () => {
    setQrisDownloadError(null);
    setIsClosingQrisModal(false);
    setIsQrisModalOpen(true);
  };

  const handleCloseQrisModal = () => {
    setIsClosingQrisModal(true);
    setTimeout(() => {
      setIsQrisModalOpen(false);
      setIsClosingQrisModal(false);
      setQrisDownloadError(null);
    }, 250);
  };

  // Sumber gambar QRIS (prioritas: gambar QRIS kustom dari pengaturan/localStorage, fallback: generator QR dinamis sesuai rekening bank aktif)
  const customQrisImage = useMemo(() => {
    if (typeof window !== 'undefined') {
      return (
        orgConfig?.qrisImage ||
        localStorage.getItem('pgri-qris-image') ||
        localStorage.getItem('kombel-qris-image') ||
        ''
      );
    }
    return orgConfig?.qrisImage || '';
  }, [orgConfig]);

  const isOfficialQris = Boolean(customQrisImage);

  const qrisImageSrc = useMemo(() => {
    if (customQrisImage) return customQrisImage;
    const payload = `QRIS|${orgConfig.bankName}|${orgConfig.bankAccountNumber}|${orgConfig.bankAccountHolder}`;
    return generateQrSvgDataUrl(payload, 480, 3);
  }, [customQrisImage, orgConfig]);

  // Download kartu QRIS lengkap (Header Bank + QR + No Rekening) dalam format PNG
  const handleDownloadQrisPng = async () => {
    if (isDownloadingQris) return;
    setIsDownloadingQris(true);
    setQrisDownloadError(null);
    try {
      const img = new Image();
      if (!qrisImageSrc.startsWith('data:')) {
        img.crossOrigin = 'anonymous';
      }
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Gagal memuat gambar QRIS'));
        img.src = qrisImageSrc;
      });

      const canvas = document.createElement('canvas');
      const width = 640;
      const height = 820;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Kanvas tidak tersedia');

      // Latar belakang putih bersih
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      // Bingkai tepi kartu QRIS
      ctx.strokeStyle = '#e7e5e4';
      ctx.lineWidth = 4;
      ctx.strokeRect(16, 16, width - 32, height - 32);

      // Header Merah Tua PGRI
      ctx.fillStyle = '#991b1b';
      ctx.fillRect(16, 16, width - 32, 118);

      // Judul QRIS & Organisasi
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.font = 'bold 30px sans-serif';
      ctx.fillText('QRIS PEMBAYARAN KAS', width / 2, 68);
      ctx.font = 'bold 17px sans-serif';
      ctx.fillStyle = '#fde68a';
      ctx.fillText('PGRI RANTING GELANG • KEC. SUMBERBARU', width / 2, 102);

      // Nama Bank & Pemilik Rekening
      ctx.fillStyle = '#1c1917';
      ctx.font = 'bold 22px sans-serif';
      ctx.fillText(String(orgConfig.bankAccountHolder || '').toUpperCase(), width / 2, 182);

      ctx.fillStyle = '#57534e';
      ctx.font = '600 18px sans-serif';
      ctx.fillText(`${orgConfig.bankName} • No. Rek: ${orgConfig.bankAccountNumber}`, width / 2, 214);

      // Kotak Bingkai Kode QR
      const qrSize = 410;
      const qrX = (width - qrSize) / 2;
      const qrY = 248;
      ctx.strokeStyle = '#d6d3d1';
      ctx.lineWidth = 2;
      ctx.strokeRect(qrX - 14, qrY - 14, qrSize + 28, qrSize + 28);

      // Gambar QR Code
      ctx.drawImage(img, qrX, qrY, qrSize, qrSize);

      // Footer Keterangan Scan
      ctx.fillStyle = '#292524';
      ctx.font = 'bold 17px sans-serif';
      ctx.fillText(
        isOfficialQris
          ? 'Scan menggunakan Mobile Banking / E-Wallet'
          : 'QR Informasi Rekening Resmi PGRI Ranting Gelang',
        width / 2,
        718
      );

      ctx.fillStyle = '#78716c';
      ctx.font = '14px sans-serif';
      ctx.fillText('Dicetak otomatis dari Sistem Keuangan PGRI Ranting Gelang', width / 2, 748);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Gagal membuat file PNG QRIS');
      const safeBank = String(orgConfig.bankName || 'Bank').replace(/[^a-zA-Z0-9]/g, '_');
      await safeDownloadBlob(blob, `QRIS_${safeBank}_${orgConfig.bankAccountNumber}.png`);
    } catch (err) {
      console.error('Gagal mengunduh PNG QRIS:', err);
      setQrisDownloadError('Gagal mengunduh gambar QRIS. Pastikan koneksi internet aktif lalu coba lagi.');
    } finally {
      setIsDownloadingQris(false);
    }
  };

  const [downloadingSchoolPdf, setDownloadingSchoolPdf] = useState<string | null>(null);

  // Helper format tanggal pembayaran: "Senin, 23 November 2026"
  const formatReceiptPaidDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    const parts = String(dateStr).split('-');
    let d: Date;
    if (parts.length === 3 && parts[0].length === 4) {
      d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    } else {
      d = new Date(dateStr);
    }
    if (isNaN(d.getTime())) return dateStr;
    return new Intl.DateTimeFormat('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(d);
  };

  // Helper terbilang nominal Rupiah: "(Sepuluh ribu rupiah)"
  const formatTerbilangRupiah = (amount: number): string => {
    const satuan = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
    const konversi = (n: number): string => {
      n = Math.floor(Math.abs(n));
      if (n === 0) return '';
      if (n < 12) return satuan[n];
      if (n < 20) return `${konversi(n - 10)} belas`;
      if (n < 100) return `${konversi(Math.floor(n / 10))} puluh ${konversi(n % 10)}`.trim();
      if (n < 200) return `seratus ${konversi(n - 100)}`.trim();
      if (n < 1000) return `${konversi(Math.floor(n / 100))} ratus ${konversi(n % 100)}`.trim();
      if (n < 2000) return `seribu ${konversi(n - 1000)}`.trim();
      if (n < 1000000) return `${konversi(Math.floor(n / 1000))} ribu ${konversi(n % 1000)}`.trim();
      if (n < 1000000000) return `${konversi(Math.floor(n / 1000000))} juta ${konversi(n % 1000000)}`.trim();
      return `${konversi(Math.floor(n / 1000000000))} miliar ${konversi(n % 1000000000)}`.trim();
    };
    const hasil = amount === 0 ? 'nol' : konversi(amount);
    const kapitalAwal = hasil.charAt(0).toUpperCase() + hasil.slice(1).toLowerCase();
    return `(${kapitalAwal} rupiah)`;
  };

  // Helper nomor kuitansi: "KWT.01.08/PGRI.Rtg.Gelang/2026"
  const buildReceiptNumber = (teacher: Teacher, monthId: string, year: string, customSeq?: number) => {
    const idx =
      customSeq !== undefined
        ? customSeq
        : Math.max(
            1,
            sortedTeachers.findIndex(
              (t) =>
                String(t.id).trim() === String(teacher.id).trim() ||
                (t.name && teacher.name && t.name.trim().toLowerCase() === teacher.name.trim().toLowerCase())
            ) + 1
          );
    const seqStr = String(idx).padStart(2, '0');
    const cleanPrefix = (orgConfig.letterCodePrefix || 'PGRI.Rtg.Gelang').replace(/^\/+|\/+$/g, '');
    return `KWT.${seqStr}.${monthId}/${cleanPrefix}/${year}`;
  };

  // Helper resolver Nama & NPA Ketua / Bendahara dari Kepengurusan + Daftar Anggota (menjaga default NPA resmi)
  const resolveSignersFromPengurus = () => {
    let ketuaName = DEFAULT_KETUA_FALLBACK.name;
    let ketuaNpa = '13301500431';
    let bendaharaName = 'Atik Andriyati, S.Pd';
    let bendaharaNpa = '1330230358';

    try {
      const savedPengurus = localStorage.getItem('kombel-pengurus');
      const parsedPengurus = savedPengurus ? JSON.parse(savedPengurus) : null;
      const findTeacherNpa = (personName: string): string => {
        const norm = (personName || '').trim().toLowerCase();
        if (!norm) return '';
        const match = teachers.find((t) => (t.name || '').trim().toLowerCase() === norm);
        return match && (match as any).npa ? String((match as any).npa).trim() : '';
      };

      if (Array.isArray(parsedPengurus)) {
        const ketua = parsedPengurus.find(
          (p: any) => p?.role && p.role.toLowerCase().includes('ketua') && !p.role.toLowerCase().includes('wakil')
        );
        if (ketua?.name && ketua.name !== '-') {
          const resolvedName = String(ketua.name).trim();
          const isDefaultKetua = resolvedName.toLowerCase().includes(DEFAULT_KETUA_FALLBACK.name.toLowerCase());
          ketuaName = isDefaultKetua ? DEFAULT_KETUA_FALLBACK.name : resolvedName;
          const explicitNpa = (ketua.npa ? String(ketua.npa).trim() : '') || findTeacherNpa(resolvedName);
          if (explicitNpa) {
            ketuaNpa = explicitNpa;
          } else if (!isDefaultKetua) {
            ketuaNpa = ketua.nip && ketua.nip !== '-' ? String(ketua.nip) : '-';
          }
        }

        const bendahara = parsedPengurus.find(
          (p: any) => p?.role && p.role.toLowerCase().includes('bendahara')
        );
        if (bendahara?.name && bendahara.name !== '-') {
          const resolvedName = String(bendahara.name).trim();
          const isDefaultBendahara = resolvedName.toLowerCase().includes('atik andriyati');
          bendaharaName = resolvedName;
          const explicitNpa = (bendahara.npa ? String(bendahara.npa).trim() : '') || findTeacherNpa(resolvedName);
          if (explicitNpa) {
            bendaharaNpa = explicitNpa;
          } else if (!isDefaultBendahara) {
            bendaharaNpa = bendahara.nip && bendahara.nip !== '-' ? String(bendahara.nip) : '-';
          }
        }
      }
    } catch {}

    return {
      ketuaName,
      ketuaNpaLabel: ketuaNpa && ketuaNpa !== '-' ? `NPA. ${ketuaNpa}` : '-',
      bendaharaName,
      bendaharaNpaRaw: bendaharaNpa,
      bendaharaNpaLabel: bendaharaNpa && bendaharaNpa !== '-' ? `NPA. ${bendaharaNpa}` : '-'
    };
  };

  // Helper render kuitansi ke HTMLCanvasElement (tanpa stempel, Bendahara di atas PGRI Ranting Gelang, terbilang)
  const renderReceiptCanvas = async (
    teacher: Teacher,
    month: { id: string; name: string },
    year: string,
    payment: CashPayment,
    customSeq?: number
  ): Promise<HTMLCanvasElement> => {
    const receiptNo = buildReceiptNumber(teacher, month.id, year, customSeq);
    const signers = resolveSignersFromPengurus();
    const bendaharaDisplay = signers.bendaharaName;
    const bendaharaNpa = signers.bendaharaNpaLabel;
    const logoPgri = localStorage.getItem('logo-pgri') || localStorage.getItem('logo-kombel') || '';
    const ttdBendahara = localStorage.getItem('ttd-bendahara') || '';
    const ttdBendaharaScale = Math.max(0.3, Math.min(2.5, (Number(localStorage.getItem('ttd-bendahara-size')) || 100) / 100));

    const loadOptionalImg = (src: string) =>
      new Promise<HTMLImageElement | null>((resolve) => {
        if (!src) return resolve(null);
        const image = new Image();
        if (!src.startsWith('data:')) image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = src;
      });

    const [logoImg, ttdImg] = await Promise.all([
      loadOptionalImg(logoPgri),
      loadOptionalImg(ttdBendahara)
    ]);

    const canvas = document.createElement('canvas');
    const width = 900;
    const height = 560;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Kanvas tidak tersedia');

    // Latar kartu putih bersih
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Bingkai luar
    ctx.strokeStyle = '#d6d3d1';
    ctx.lineWidth = 3;
    ctx.strokeRect(16, 16, width - 32, height - 32);

    // Header Merah Tua PGRI + Aksen Emas
    ctx.fillStyle = '#991b1b';
    ctx.fillRect(16, 16, width - 32, 108);
    ctx.fillStyle = '#d97706';
    ctx.fillRect(16, 124, width - 32, 4);

    if (logoImg) {
      ctx.drawImage(logoImg, 40, 32, 74, 74);
    }

    ctx.textAlign = logoImg ? 'left' : 'center';
    const headerTextX = logoImg ? 134 : width / 2;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText('KUITANSI PEMBAYARAN KONTRIBUSI', headerTextX, 64);
    ctx.fillStyle = '#fde68a';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText(`${orgConfig.kopRanting || 'RANTING GELANG'} • ${orgConfig.kopWilayah || 'KECAMATAN SUMBERBARU - KABUPATEN JEMBER'}`, headerTextX, 94);
    
    // Tabel Metadata Kuitansi
    const rows: [string, string][] = [
      ['Nomor Kuitansi', receiptNo],
      ['Nama Anggota', teacher.name || '-'],
      ['NIP / NPA', (teacher as any).nip || (teacher as any).npa || '-'],
      ['Asal Sekolah / Unit', teacher.school || '-'],
      ['Periode Kontribusi', `${month.name} ${year}`],
      ['Tanggal Pembayaran', formatReceiptPaidDate(payment?.datePaid)]
    ];

    let yPos = 166;
    rows.forEach(([label, val], idx) => {
      if (idx % 2 === 0) {
        ctx.fillStyle = '#faf8f5';
        ctx.fillRect(36, yPos - 22, width - 72, 34);
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = '#78716c';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText(label, 52, yPos);

      ctx.fillStyle = '#1c1917';
      ctx.font = idx === 1 ? 'bold 16px sans-serif' : '600 15px sans-serif';
      ctx.fillText(`:  ${val}`, 245, yPos);
      yPos += 36;
    });

    // Kotak Nominal di Kiri Bawah + Terbilang
    ctx.fillStyle = '#fef2f2';
    ctx.strokeStyle = '#fecaca';
    ctx.lineWidth = 2;
    ctx.fillRect(36, 392, 430, 104);
    ctx.strokeRect(36, 392, 430, 104);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#991b1b';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('Jumlah Kontribusi Diterima', 56, 418);
    ctx.fillStyle = '#1c1917';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(formatRupiah(orgConfig.monthlyDuesAmount), 56, 454);
    ctx.fillStyle = '#57534e';
    ctx.font = 'italic 600 13px sans-serif';
    ctx.fillText(formatTerbilangRupiah(orgConfig.monthlyDuesAmount), 56, 480);

    // Area Tanda Tangan Bendahara di Kanan Bawah (Tanpa Stempel, Bendahara di atas PGRI Ranting Gelang)
    const signCenterX = 710;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#57534e';
    ctx.font = '600 13px sans-serif';
    ctx.fillText('Bendahara', signCenterX, 394);
    ctx.fillText('PGRI Ranting Gelang', signCenterX, 412);

    if (ttdImg) {
      const aspect = ttdImg.naturalWidth && ttdImg.naturalHeight ? ttdImg.naturalWidth / ttdImg.naturalHeight : 104 / 50;
      let drawH = 50 * ttdBendaharaScale;
      let drawW = drawH * aspect;
      const maxW = 140 * ttdBendaharaScale;
      if (drawW > maxW) {
        drawW = maxW;
        drawH = drawW / aspect;
      }
      const drawCenterY = 440;
      ctx.drawImage(ttdImg, signCenterX - drawW / 2, drawCenterY - drawH / 2, drawW, drawH);
    }

    // Stempel LUNAS hijau miring dengan efek tekstur stempel tepat di atas area tanda tangan
    ctx.save();
    ctx.translate(signCenterX, 442);
    ctx.rotate((-13 * Math.PI) / 180);
    ctx.globalAlpha = 0.85;

    const stampW = 146;
    const stampH = 44;
    const stampColor = '#15803d';

    // Bingkai luar stempel
    ctx.strokeStyle = stampColor;
    ctx.lineWidth = 3.5;
    ctx.strokeRect(-stampW / 2, -stampH / 2, stampW, stampH);

    // Teks LUNAS tebal
    ctx.fillStyle = stampColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 26px sans-serif';
    ctx.fillText('LUNAS', 0, 1);

    // Efek tekstur distress / grunge khas stempel tinta
    ctx.fillStyle = '#ffffff';
    const distressDots = [
      [-62, -16, 3, 2], [-45, -19, 4, 2], [-18, -17, 2, 2], [22, -18, 4, 2], [54, -15, 3, 2],
      [-58, 16, 4, 2], [-25, 18, 3, 2], [12, 17, 5, 2], [48, 16, 3, 2], [65, 10, 2, 3],
      [-38, -4, 3, 2], [-14, 5, 2, 3], [8, -6, 3, 2], [32, 4, 3, 2], [44, -5, 2, 2],
      [-50, 3, 2, 2], [-4, -3, 2, 2], [20, 6, 2, 2], [-28, 7, 2, 2], [55, 2, 2, 2]
    ];
    distressDots.forEach(([dx, dy, dw, dh]) => {
      ctx.fillRect(dx, dy, dw, dh);
    });

    ctx.restore();
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = '#1c1917';
    ctx.font = 'bold 14px sans-serif';
    const nameY = 480;
    ctx.fillText(bendaharaDisplay, signCenterX, nameY);

    // Garis bawah nama bendahara dengan jarak renggang yang rapi
    const nameTextWidth = ctx.measureText(bendaharaDisplay).width;
    const underlineY = nameY + 5;
    ctx.beginPath();
    ctx.moveTo(signCenterX - nameTextWidth / 2, underlineY);
    ctx.lineTo(signCenterX + nameTextWidth / 2, underlineY);
    ctx.strokeStyle = '#1c1917';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.fillStyle = '#44403c';
    ctx.font = '600 12px sans-serif';
    ctx.fillText(bendaharaNpa, signCenterX, underlineY + 16);

    // Footer
    ctx.textAlign = 'left';
    ctx.fillStyle = '#78716c';
    ctx.font = '12px sans-serif';
    ctx.fillText('Bukti pembayaran sah diterbitkan oleh Sistem Keuangan PGRI Ranting Gelang', 36, 526);

    return canvas;
  };

  // Download Kuitansi Digital Pembayaran Kontribusi dalam format PNG
  const handleDownloadReceiptPng = async () => {
    if (!receiptPreviewTarget || isDownloadingReceipt) return;
    setIsDownloadingReceipt(true);
    try {
      const { teacher, month, year, payment } = receiptPreviewTarget;
      const canvas = await renderReceiptCanvas(teacher, month, year, payment);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Gagal membuat file PNG Kuitansi');
      const safeName = (teacher.name || 'anggota').replace(/[^a-zA-Z0-9]/g, '_');
      await safeDownloadBlob(blob, `Kuitansi_Kontribusi_${safeName}_${year}-${month.id}.png`);
    } catch (err) {
      console.error('Gagal mengunduh kuitansi PNG:', err);
    } finally {
      setIsDownloadingReceipt(false);
    }
  };

  // Download Kuitansi Per Sekolah dalam format PDF (PC: Tab Baru Siap Print/PDF | Ponsel: Auto Download PDF)
  const handleDownloadSchoolReceiptsPdf = async (schoolName: string, paidTeachers: Teacher[]) => {
    if (downloadingSchoolPdf || paidTeachers.length === 0) return;

    // Buka tab baru seketika saat klik di PC agar tidak terblokir popup blocker browser
    const isMobile = isMobileDevice();
    const printWindow = !isMobile ? window.open('', '_blank') : null;
    if (printWindow) {
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head><title>Menyiapkan Kuitansi ${escapeHtmlSafe(schoolName)}...</title></head>
          <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; color: #44403c;">
            <p>Menyiapkan dokumen kuitansi PDF untuk <strong>${escapeHtmlSafe(schoolName)}</strong>...</p>
          </body>
        </html>
      `);
    }

    setDownloadingSchoolPdf(schoolName);
    let container: HTMLDivElement | null = null;
    try {
      const monthObj = MONTH_OPTIONS.find((m) => m.id === rekapMonth) || { id: rekapMonth, name: rekapMonth };

      const imgDataUrls: string[] = [];
      for (let i = 0; i < paidTeachers.length; i++) {
        const teacher = paidTeachers[i];
        const payment = getPayment(teacher.id, rekapMonth, teacher.name, rekapYear);
        if (!payment) continue;
        const canvas = await renderReceiptCanvas(teacher, monthObj, rekapYear, payment, i + 1);
        imgDataUrls.push(canvas.toDataURL('image/png'));
      }

      if (imgDataUrls.length === 0) {
        if (printWindow) printWindow.close();
        return;
      }

      // Susun 2 kuitansi per halaman A4 Portrait agar rapi, tajam, dan hemat kertas
      const pagesHtml: string[] = [];
      for (let i = 0; i < imgDataUrls.length; i += 2) {
        const firstImg = imgDataUrls[i];
        const secondImg = imgDataUrls[i + 1];
        const isLastPage = i + 2 >= imgDataUrls.length;
        pagesHtml.push(`
          <div class="receipt-page ${!isLastPage ? 'page-break' : ''}">
            <img src="${firstImg}" class="receipt-img" />
            ${secondImg ? `<img src="${secondImg}" class="receipt-img" />` : ''}
          </div>
        `);
      }

      const safeSchool = schoolName.replace(/[^a-zA-Z0-9]/g, '_');
      const docTitle = `Kuitansi_${safeSchool}_${monthObj.name}_${rekapYear}`;

      // JIKA DI PONSEL ATAU POP-UP DIBLOKIR: Direct download PDF menggunakan html2pdf lokal
      if (isMobile || !printWindow) {
        container = document.createElement('div');
        container.style.width = '760px';
        container.style.backgroundColor = '#ffffff';
        container.style.padding = '8px';

        container.innerHTML = `
          <style data-pdf-style="true">
            .receipt-page { display: flex; flex-direction: column; gap: 18px; padding: 6px 0; }
            .page-break { page-break-after: always; break-after: page; }
            .receipt-img { width: 100%; height: auto; display: block; border: 1px solid #e7e5e4; }
          </style>
          ${pagesHtml.join('')}
        `;

        await downloadContainerAsPdf(container, {
          filename: `${docTitle}.pdf`,
          orientation: 'portrait',
          margin: [8, 10, 8, 10],
          quality: 0.98,
          scale: 2,
          pagebreak: { mode: ['css', 'legacy'] }
        });
        return;
      }

      // JIKA DI PC / LAPTOP: Tampilkan di tab baru siap cetak / simpan sebagai PDF
      if (printWindow) {
        const htmlContent = `
          <!DOCTYPE html>
          <html>
            <head>
              <title>${escapeHtmlSafe(docTitle)}</title>
              <style>
                @page {
                  size: A4 portrait;
                  margin: 0.8cm 1cm;
                }
                * { box-sizing: border-box; }
                html, body {
                  margin: 0;
                  padding: 0;
                  background: #ffffff;
                  -webkit-print-color-adjust: exact;
                  print-color-adjust: exact;
                }
                .receipt-page {
                  display: flex;
                  flex-direction: column;
                  gap: 16px;
                  padding: 4px 0;
                }
                .page-break {
                  page-break-after: always;
                  break-after: page;
                }
                .receipt-img {
                  width: 100%;
                  max-height: 13.2cm;
                  object-fit: contain;
                  display: block;
                  border: 1px solid #e7e5e4;
                }
              </style>
            </head>
            <body>
              ${pagesHtml.join('')}
              <script>
                window.onload = function() {
                  window.print();
                };
                window.onafterprint = function() {
                  window.close();
                };
              </script>
            </body>
          </html>
        `;
        printWindow.document.open();
        printWindow.document.write(htmlContent);
        printWindow.document.close();
      }
    } catch (err) {
      console.error('Gagal menyiapkan PDF kuitansi per sekolah:', err);
      if (printWindow) printWindow.close();
    } finally {
      if (container && document.body.contains(container)) {
        document.body.removeChild(container);
      }
      setDownloadingSchoolPdf(null);
    }
  };

  const handleCloseModal = () => {
    setIsClosingModal(true);
    setTimeout(() => {
      setIsModalOpen(false);
      setIsClosingModal(false);
    }, 250);
  };

  const handleCloseDeleteModal = () => {
    setIsClosingDeleteModal(true);
    setTimeout(() => {
      setDeleteTarget(null);
      setIsClosingDeleteModal(false);
    }, 250);
  };

  const handleOpenVerifikasiModal = () => {
    if (!selectedVerifikasiYear) {
      setSelectedVerifikasiYear(currentYearStr);
    }
    if (!selectedVerifikasiMonth) {
      setSelectedVerifikasiMonth(currentMonthId);
    }
    setVerifikasiFilter('Belum Bayar');
    setIsClosingVerifikasiModal(false);
    setIsVerifikasiModalOpen(true);
  };

  const handleCloseVerifikasiModal = () => {
    setIsClosingVerifikasiModal(true);
    setTimeout(() => {
      setIsVerifikasiModalOpen(false);
      setIsClosingVerifikasiModal(false);
    }, 250);
  };

  const handleCloseWarningModal = () => {
    setIsClosingWarningModal(true);
    setTimeout(() => {
      setIsWarningModalOpen(false);
      setIsClosingWarningModal(false);
    }, 250);
  };

  // Handler kirim pesan konfirmasi ke WhatsApp Bendahara PGRI
  const handleSendWhatsAppConfirmation = () => {
    if (!selectedConfirmTeacher) return;

    const teacherNip = (selectedConfirmTeacher as any).nip || '-';
    const teacherName = selectedConfirmTeacher.name || '-';
    const teacherSchool = selectedConfirmTeacher.school || '-';

    const message =
      `Mohon untuk mengkonfirmasi pembayaran,\n` +
      `PGRI Ranting Gelang Kecamatan Sumberbaru.\n\n` +
      `Nama : *${teacherName}*\n` +
      `NIP : ${teacherNip}\n` +
      `Sekolah : ${teacherSchool}\n\n` +
      `Atas waktu dan kerjasamanya, kami ucapkan terimakasih.`;

    openWhatsAppShare(message, orgConfig.bendaharaWa);
    handleCloseConfirmTransferModal();
  };

  // Daftar unik sekolah untuk dropdown filter
  const schoolOptions = useMemo(() => {
    const schools = teachers.map(t => t.school).filter(Boolean) as string[];
    return Array.from(new Set(schools)).sort((a, b) => a.localeCompare(b, 'id'));
  }, [teachers]);

  // Helper mencari data pembayaran spesifik teacher, bulan & tahun secara ketat (YYYY-MM)
  const getPayment = (teacherId: string, monthId?: string, teacherName?: string, yearStr?: string) => {
    if (monthId) {
      const targetYear = yearStr || filterYear || currentYearStr;
      const yearMonthCode = `${targetYear}-${monthId}`;
      const targetKey = `month-${yearMonthCode}`;

      return cashPayments.find(cp => {
        const isSameTeacher =
          (cp.teacherId && String(cp.teacherId).trim() === String(teacherId).trim()) ||
          (teacherName && (cp as any).teacherName && (cp as any).teacherName.trim().toLowerCase() === teacherName.trim().toLowerCase());
        const cpKey = String((cp as any).month || (cp as any).eventId || '').trim();
        return isSameTeacher && (cpKey === targetKey || cpKey === yearMonthCode);
      });
    }
    return cashPayments.find(cp =>
      (cp.teacherId && String(cp.teacherId).trim() === String(teacherId).trim()) ||
      (teacherName && (cp as any).teacherName && (cp as any).teacherName.trim().toLowerCase() === teacherName.trim().toLowerCase())
    );
  };

  // Daftar Item Pembayaran per Bulan & Tahun (hanya bulan mulai berlaku iuran ke depan)
  const paymentItems = useMemo(() => {
    const items: { teacher: Teacher; month: { id: string; name: string }; year: string }[] = [];
    MONTH_OPTIONS.forEach(month => {
      if (!isPeriodActive(filterYear, month.id)) return;
      sortedTeachers.forEach(teacher => {
        items.push({ teacher, month, year: filterYear });
      });
    });

    return items.filter(item => {
      if (filterSchool !== 'Semua' && item.teacher.school !== filterSchool) {
        return false;
      }
      if (filterMonth !== 'Semua' && item.month.id !== filterMonth) {
        return false;
      }
      return true;
    });
  }, [MONTH_OPTIONS, sortedTeachers, filterSchool, filterMonth, filterYear, duesStartPeriod]);

  // Pengelompokan Data Pembayaran berdasarkan Bulan & Tahun untuk Kotak Pembungkus
  const groupedPaymentItems = useMemo(() => {
    const groups: { month: { id: string; name: string }; year: string; items: typeof paymentItems }[] = [];

    paymentItems.forEach(item => {
      const existingGroup = groups.find(g => g.month.id === item.month.id && g.year === item.year);
      if (existingGroup) {
        existingGroup.items.push(item);
      } else {
        groups.push({
          month: item.month,
          year: item.year,
          items: [item]
        });
      }
    });

    return groups;
  }, [paymentItems]);

  // Kalkulasi Saldo Kumulatif urut dari Tanggal Terlama ke Tanggal Terbaru (Ascending)
  const transactionsWithRunningBalance = useMemo(() => {
    let currentBalance = 0;
    
    // Simpan index awal & pastikan transaksi Dana Masuk selalu menggunakan tanggal 02 pada bulannya
    const itemsWithIndex = transactions.map((tx, idx) => {
      const isDanaMasuk =
        tx.id.startsWith('tx-kas-event-') ||
        /^dana masuk pada bulan/i.test((tx.description || '').trim());
      let normalizedDate = tx.date;
      if (isDanaMasuk && typeof tx.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(tx.date)) {
        normalizedDate = `${tx.date.slice(0, 7)}-02`;
      }
      return { ...tx, date: normalizedDate, _originalIndex: idx };
    });

    const sorted = itemsWithIndex.sort((a, b) => {
      const timeA = new Date(a.date).getTime();
      const timeB = new Date(b.date).getTime();
      
      // 1. Urutkan berdasarkan tanggal terlama ke terbaru
      if (timeA !== timeB && !isNaN(timeA) && !isNaN(timeB)) {
        return timeA - timeB;
      }

      // 2. Jika tanggal sama, utamakan Pemasukan di urutan teratas
      if (a.type !== b.type) {
        return a.type === 'Pemasukan' ? -1 : 1;
      }

      // 3. Jika tanggal & jenis sama, urutkan berdasarkan waktu entry (lama ke baru)
      const extractTimestamp = (id: string) => {
        const match = id.match(/\d+/);
        return match ? parseInt(match[0], 10) : 0;
      };

      const tsA = extractTimestamp(a.id);
      const tsB = extractTimestamp(b.id);

      if (tsA !== tsB && tsA > 0 && tsB > 0) {
        return tsA - tsB;
      }

      return a._originalIndex - b._originalIndex;
    });

    return sorted.map(tx => {
      if (tx.type === 'Pemasukan') {
        currentBalance += tx.amount;
      } else {
        currentBalance -= tx.amount;
      }
      return { ...tx, runningBalance: currentBalance };
    });
  }, [transactions]);

  // Stats
  const totalPemasukan = transactions
    .filter(t => t.type === 'Pemasukan')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalPengeluaran = transactions
    .filter(t => t.type === 'Pengeluaran')
    .reduce((sum, t) => sum + t.amount, 0);

  const saldoAkhir = totalPemasukan - totalPengeluaran;

  const formatRupiah = (amount: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const handleActionClick = (callback: () => void) => {
    if (!isAdmin) {
      setIsClosingWarningModal(false);
      setIsWarningModalOpen(true);
    } else {
      callback();
    }
  };

  // Open Modal Tambah
  const handleOpenAdd = () => {
    handleActionClick(() => {
      setEditingTx(null);
      setFormData({
        date: new Date().toISOString().split('T')[0],
        type: 'Pengeluaran',
        amount: '',
        description: '',
        volume: '',
        satuan: '',
        category: 'Operasional Sekretariat',
        receiptImage: ''
      });
      setReceiptError('');
      setIsClosingModal(false);
      setIsModalOpen(true);
    });
  };

  // Open Modal Edit
  const handleOpenEdit = (tx: FinancialTransaction) => {
    handleActionClick(() => {
      setEditingTx(tx);
      const rawDesc = String(tx.description || '').trim();
      const match = rawDesc.match(/^(.*?)\s+(\d+(?:[.,]\d+)?)\s+(pcs|dus|botol|buah|lembar|rim|pack|pak|box|kotak|set|unit|eksemplar|kali|kegiatan|orang|org|paket)$/i);
      const savedVol = (tx as any).volume !== undefined && (tx as any).volume !== null ? String((tx as any).volume) : (match ? match[2] : '');
      const savedSat = (tx as any).satuan ? String((tx as any).satuan) : (match ? match[3] : '');
      const cleanDesc = !(tx as any).volume && !(tx as any).satuan && match ? match[1].trim() : rawDesc;
      const normalizedCategory = tx.category === 'Iuran Anggota' ? 'Kontribusi Anggota' : tx.category;

      const parsedVolNum = savedVol ? parseFloat(savedVol.replace(',', '.')) : 1;
      const validVolNum = !isNaN(parsedVolNum) && parsedVolNum > 0 ? parsedVolNum : 1;
      const unitNominal = tx.amount > 0 ? Math.round(tx.amount / validVolNum) : 0;

      setFormData({
        date: tx.date,
        type: tx.type,
        amount: unitNominal > 0 ? `Rp. ${unitNominal.toLocaleString('id-ID')}` : '',
        description: cleanDesc,
        volume: savedVol,
        satuan: savedSat,
        category: normalizedCategory || (tx.type === 'Pemasukan' ? 'Kontribusi Anggota' : 'Operasional Sekretariat'),
        receiptImage: tx.receiptImage || ''
      });
      setReceiptError('');
      setIsClosingModal(false);
      setIsModalOpen(true);
    });
  };

  // Simpan Transaksi (Tambah/Edit) + Dual-Write Per-Doc & Audit Log
  const handleSaveTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedUnitNominal = parseInt(formData.amount.replace(/[^0-9]/g, ''), 10);
    if (isNaN(parsedUnitNominal) || parsedUnitNominal <= 0) return;
    if (!formData.description.trim()) return;

    const targetEditId = editingTx?.id;
    const trimmedVol = formData.volume.trim();
    const trimmedSat = formData.satuan.trim();
    const parsedVol = trimmedVol ? parseFloat(trimmedVol.replace(',', '.')) : 1;
    const effectiveVol = !isNaN(parsedVol) && parsedVol > 0 ? parsedVol : 1;
    const computedTotalAmount = Math.round(parsedUnitNominal * effectiveVol);

    const editedValues: any = {
      date: formData.date,
      type: formData.type,
      amount: computedTotalAmount,
      description: formData.description.trim(),
      volume: trimmedVol,
      satuan: trimmedSat,
      category: formData.category,
      ...(formData.receiptImage ? { receiptImage: formData.receiptImage } : {})
    };
    const newTx: FinancialTransaction | null = editingTx
      ? null
      : {
          id: `tx-${Date.now()}`,
          ...editedValues
        };

    const updated: FinancialTransaction[] = editingTx
      ? transactions.map(t => (t.id === editingTx.id ? { ...t, ...editedValues } : t))
      : [newTx!, ...transactions];

    onTransactionsChange(updated);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('kombel-financialTransactions', JSON.stringify(updated));
      } catch (err) {}
    }
    handleCloseModal();

    const savedItem: FinancialTransaction = targetEditId ? { id: targetEditId, ...editedValues } : newTx!;
    savePerDocItem('transaction_docs', savedItem.id, {
      id: savedItem.id,
      date: savedItem.date,
      type: savedItem.type,
      amount: savedItem.amount,
      description: savedItem.description,
      volume: trimmedVol,
      satuan: trimmedSat,
      category: savedItem.category || 'Lainnya',
      ...(savedItem.receiptImage && savedItem.receiptImage.length <= 350000 ? { receiptImage: savedItem.receiptImage } : {}),
      updatedAt: new Date().toISOString()
    });
    logAuditEvent(
      'Catatan Keuangan',
      targetEditId ? 'Edit Transaksi' : 'Tambah Transaksi',
      `${savedItem.type} Rp ${savedItem.amount.toLocaleString('id-ID')} [${savedItem.category || 'Lainnya'}] — ${savedItem.description}`
    );

    const res = await mutateCloudCollection<FinancialTransaction>(
      'financialTransactions',
      ['kombel-financialTransactions'],
      (latest) => {
        if (targetEditId) {
          return latest.some(t => t.id === targetEditId)
            ? latest.map(t => (t.id === targetEditId ? { ...t, ...editedValues } : t))
            : [{ id: targetEditId, ...editedValues }, ...latest];
        }
        return [newTx!, ...latest.filter(t => t.id !== newTx!.id)];
      },
      updated,
      'Catatan Keuangan'
    );
    onTransactionsChange(res.items);
  };

  // Rekap Tunggakan per Sekolah (untuk pengingat WA koordinator sekolah)
  const schoolDuesSummary = useMemo(() => {
    const groups: Record<string, { school: string; total: number; paid: Teacher[]; unpaid: Teacher[] }> = {};
    sortedTeachers.forEach((t) => {
      const sch = (t.school || 'Lainnya').trim().toUpperCase();
      if (!groups[sch]) {
        groups[sch] = { school: sch, total: 0, paid: [], unpaid: [] };
      }
      groups[sch].total += 1;
      const payment = getPayment(t.id, rekapMonth, t.name, rekapYear);
      if (payment?.status === 'Lunas') {
        groups[sch].paid.push(t);
      } else {
        groups[sch].unpaid.push(t);
      }
    });
    return Object.values(groups).sort((a, b) => {
      const aIsSdNu = a.school.startsWith('SD NU');
      const bIsSdNu = b.school.startsWith('SD NU');
      if (aIsSdNu && !bIsSdNu) return 1;
      if (!aIsSdNu && bIsSdNu) return -1;
      return a.school.localeCompare(b.school, 'id');
    });
  }, [sortedTeachers, cashPayments, rekapMonth, rekapYear]);

  // Cetak / Unduh LPJ Keuangan Resmi PGRI Ranting Gelang (PC: Jendela Cetak | Ponsel: Auto Download PDF)
  const handleExportOfficialLPJ = async () => {
    if (isExportingLpj) return;
    setIsExportingLpj(true);
    try {
    const printWindow = !isMobileDevice() ? window.open('', '_blank') : null;
    const logoPgri = localStorage.getItem('logo-pgri') || localStorage.getItem('logo-kombel') || '';
    const ttdKetua = localStorage.getItem('ttd-ketua') || '';
    const ttdKetuaScale = Math.max(0.3, Math.min(2.5, (Number(localStorage.getItem('ttd-ketua-size')) || 100) / 100));
    const ttdBendahara = localStorage.getItem('ttd-bendahara') || '';
    const ttdBendaharaScale = Math.max(0.3, Math.min(2.5, (Number(localStorage.getItem('ttd-bendahara-size')) || 100) / 100));
    const stempel = localStorage.getItem('logo-stempel') || '';
    const stempelScale = Math.max(0.3, Math.min(2.5, (Number(localStorage.getItem('logo-stempel-size')) || 100) / 100));
    const stempelRotation = Number(localStorage.getItem('logo-stempel-rotation')) || 0;
    const lpjSigners = resolveSignersFromPengurus();
    const todayStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

    logAuditEvent('Catatan Keuangan', 'Cetak LPJ Resmi', `Mencetak / mengunduh LPJ Keuangan resmi (Saldo akhir ${formatRupiah(saldoAkhir)}).`);

    // Kelompokkan transaksi BKU secara kronologis per Bulan (YYYY-MM) dengan Buka/Tutup Bulan
    const monthlyBkuGroups: {
      key: string;
      monthName: string;
      yearStr: string;
      firstDateShort: string;
      lastDateShort: string;
      lastDateFull: string;
      lastDateWithDay: string;
      openingBalance: number;
      items: typeof transactionsWithRunningBalance;
      totalMasuk: number;
      totalKeluar: number;
      endingBalance: number;
    }[] = [];

    transactionsWithRunningBalance.forEach((tx) => {
      const d = new Date(tx.date);
      const isValidDate = !isNaN(d.getTime());
      const yearNum = isValidDate ? d.getFullYear() : new Date().getFullYear();
      const monthIdx = isValidDate ? d.getMonth() : 0;
      const monthKey = isValidDate
        ? `${yearNum}-${String(monthIdx + 1).padStart(2, '0')}`
        : 'Lainnya';

      let group = monthlyBkuGroups.find((g) => g.key === monthKey);
      if (!group) {
        const prevGroup = monthlyBkuGroups[monthlyBkuGroups.length - 1];
        const openingBalance = prevGroup ? prevGroup.endingBalance : 0;

        const firstDayDate = new Date(yearNum, monthIdx, 1);
        const lastDayDate = new Date(yearNum, monthIdx + 1, 0);

        const monthName = isValidDate
          ? firstDayDate.toLocaleDateString('id-ID', { month: 'long' })
          : 'Tanpa Bulan';
        const yearStr = isValidDate ? String(yearNum) : '';

        const firstDateShort = isValidDate
          ? firstDayDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
          : '-';
        const lastDateShort = isValidDate
          ? lastDayDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
          : '-';
        const lastDateFull = isValidDate
          ? lastDayDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
          : todayStr;
        const lastDayName = isValidDate
          ? lastDayDate.toLocaleDateString('id-ID', { weekday: 'long' })
          : '';
        const lastDateWithDay = isValidDate ? `${lastDayName} ${lastDateFull}` : todayStr;

        group = {
          key: monthKey,
          monthName,
          yearStr,
          firstDateShort,
          lastDateShort,
          lastDateFull,
          lastDateWithDay,
          openingBalance,
          items: [],
          totalMasuk: 0,
          totalKeluar: 0,
          endingBalance: openingBalance
        };
        monthlyBkuGroups.push(group);
      }

      group.items.push(tx);
      if (tx.type === 'Pemasukan') group.totalMasuk += tx.amount;
      else group.totalKeluar += tx.amount;
      group.endingBalance = tx.runningBalance;
    });

    const parseTxVolumeUnit = (tx: FinancialTransaction) => {
      if (tx.type !== 'Pengeluaran') {
        return { volume: '-', satuan: '-', harga: '-', jumlah: '-' };
      }
      const explicitVol = String((tx as any).volume || '').trim();
      const explicitSat = String((tx as any).satuan || '').trim();

      if (explicitVol || explicitSat) {
        const volNum = explicitVol ? parseFloat(explicitVol.replace(',', '.')) : 1;
        const validVol = !isNaN(volNum) && volNum > 0 ? volNum : 1;
        const unitPrice = Math.round(tx.amount / validVol);
        return {
          volume: explicitVol || '1',
          satuan: explicitSat ? explicitSat.charAt(0).toUpperCase() + explicitSat.slice(1) : 'Paket',
          harga: escapeHtmlSafe(formatRupiah(unitPrice)),
          jumlah: escapeHtmlSafe(formatRupiah(tx.amount))
        };
      }

      const rawDesc = String(tx.description || '').trim();
      const match = rawDesc.match(/\b(\d+(?:[.,]\d+)?)\s*(pcs|dus|botol|buah|lembar|rim|pack|pak|box|kotak|set|unit|eksemplar|kali|kegiatan|orang|org|paket)\b/i);
      const volNum = match ? parseFloat(match[1].replace(',', '.')) : 1;
      const satuanStr = match
        ? match[2].charAt(0).toUpperCase() + match[2].slice(1).toLowerCase()
        : 'Paket';
      const unitPrice = volNum > 0 ? Math.round(tx.amount / volNum) : tx.amount;

      return {
        volume: match ? match[1] : '1',
        satuan: satuanStr,
        harga: escapeHtmlSafe(formatRupiah(unitPrice)),
        jumlah: escapeHtmlSafe(formatRupiah(tx.amount))
      };
    };

    const kopHeaderHtml = `
      <div class="kop-container">
        <div class="kop-logo-wrapper">
          ${logoPgri
            ? `<img src="${logoPgri}" alt="Logo PGRI" class="kop-logo" />`
            : `<div style="width: 92px; height: 92px; border: 1.5px dashed #94a3b8; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9pt; color: #64748b; text-align: center;">Logo<br/>PGRI</div>`}
        </div>
        <div class="kop-text-container">
          <div class="kop-org">${escapeHtmlSafe(orgConfig.kopOrganisasi)}</div>
          <div class="kop-sub-org">(Teachers Association Of Republic Indonesia)</div>
          <div class="kop-ranting">${escapeHtmlSafe(orgConfig.kopRanting)}</div>
          <div class="kop-wilayah">${escapeHtmlSafe(orgConfig.kopWilayah)}</div>
          <div class="kop-sekretariat">Sekretariat : ${escapeHtmlSafe(orgConfig.kopSekretariat)}</div>
        </div>
        <div style="width: 94px; flex-shrink: 0;"></div>
      </div>
      <div class="kop-divider"></div>
    `;

    const rantingTitleCase = escapeHtmlSafe(
      orgConfig.kopRanting.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    );

    const lpjBodyInnerHtml = monthlyBkuGroups.length > 0
      ? monthlyBkuGroups
          .map((grp, groupIdx) => {
            const isLastMonth = groupIdx === monthlyBkuGroups.length - 1;
            const openingRowHtml = `
              <tr style="background:#f8fafc !important; font-weight:bold;">
                <td style="text-align:center;">1</td>
                <td style="text-align:center;">${escapeHtmlSafe(grp.firstDateShort)}</td>
                <td style="text-transform:capitalize;">Saldo Awal Bulan</td>
                <td style="text-align:right; color:#059669; font-family:monospace;">${grp.openingBalance > 0 ? escapeHtmlSafe(formatRupiah(grp.openingBalance)) : '-'}</td>
                <td style="text-align:center;">-</td>
                <td style="text-align:center;">-</td>
                <td style="text-align:right; font-family:monospace;">-</td>
                <td style="text-align:right; font-family:monospace;">-</td>
                <td style="text-align:right; font-family:monospace;">${escapeHtmlSafe(formatRupiah(grp.openingBalance))}</td>
              </tr>
            `;

            const rowsHtml = grp.items
              .map((tx, idx) => {
                const detail = parseTxVolumeUnit(tx);
                return `<tr>
                    <td style="text-align:center">${idx + 2}</td>
                    <td style="text-align:center">${new Date(tx.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                    <td style="text-transform:capitalize;">${escapeHtmlSafe(tx.description)}</td>
                    <td style="text-align:right; color:#059669; font-weight:bold; font-family:monospace;">${tx.type === 'Pemasukan' ? escapeHtmlSafe(formatRupiah(tx.amount)) : '-'}</td>
                    <td style="text-align:center;">${escapeHtmlSafe(detail.volume)}</td>
                    <td style="text-align:center;">${escapeHtmlSafe(detail.satuan)}</td>
                    <td style="text-align:right; font-family:monospace;">${detail.harga}</td>
                    <td style="text-align:right; color:#dc2626; font-weight:bold; font-family:monospace;">${detail.jumlah}</td>
                    <td style="text-align:right; font-weight:bold; font-family:monospace;">${escapeHtmlSafe(formatRupiah(tx.runningBalance))}</td>
                  </tr>`;
              })
              .join('');

            const closingRowHtml = `
              <tr style="background:#f8fafc !important; font-weight:bold;">
                <td style="text-align:center;">${grp.items.length + 2}</td>
                <td style="text-align:center;">${escapeHtmlSafe(grp.lastDateShort)}</td>
                <td style="text-transform:capitalize;">Saldo Akhir Bulan</td>
                <td style="text-align:right; font-family:monospace;">-</td>
                <td style="text-align:center;">-</td>
                <td style="text-align:center;">-</td>
                <td style="text-align:right; font-family:monospace;">-</td>
                <td style="text-align:right; font-family:monospace;">-</td>
                <td style="text-align:right; font-family:monospace;">${escapeHtmlSafe(formatRupiah(grp.endingBalance))}</td>
              </tr>
            `;

            const totalPenerimaanBulan = grp.openingBalance + grp.totalMasuk;

            return `
              <div class="month-page-section ${!isLastMonth ? 'page-break-after-month' : ''}">
                ${kopHeaderHtml}

                <div class="bku-header-title">
                  <div class="bku-header-box">
                    <div class="bku-main-title">BUKU KAS UMUM</div>
                    <div class="bku-sub-title">BULAN : ${escapeHtmlSafe(grp.monthName.toUpperCase())} ${escapeHtmlSafe(grp.yearStr)}</div>
                  </div>
                </div>

                <table class="data-table" style="table-layout: fixed;">
                  <thead>
                    <tr>
                      <th style="width:26px;">No</th>
                      <th style="width:78px;">Tanggal</th>
                      <th>Uraian</th>
                      <th style="width:92px;">Penerimaan</th>
                      <th style="width:62px;">Volume</th>
                      <th style="width:66px;">Satuan</th>
                      <th style="width:88px;">Harga</th>
                      <th style="width:92px;">Jumlah</th>
                      <th style="width:95px;">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${openingRowHtml}
                    ${rowsHtml}
                    ${closingRowHtml}
                    <tr style="background:#f1f5f9 !important; font-weight:bold;">
                      <td colspan="3" style="text-align:center;">Jumlah</td>
                      <td style="text-align:right; color:#059669; font-family:monospace;">${escapeHtmlSafe(formatRupiah(totalPenerimaanBulan))}</td>
                      <td colspan="3" style="text-align:center;">-</td>
                      <td style="text-align:right; color:#dc2626; font-family:monospace;">${escapeHtmlSafe(formatRupiah(grp.totalKeluar))}</td>
                      <td style="text-align:right; font-family:monospace;">${escapeHtmlSafe(formatRupiah(grp.endingBalance))}</td>
                    </tr>
                  </tbody>
                </table>

                <div class="bku-closing-summary">
                  <p class="bku-closing-intro">
                    Pada hari ini ${escapeHtmlSafe(grp.lastDateWithDay)} Buku Kas Umum Ditutup dengan keadaan/posisi buku sebagai berikut :
                  </p>
                  <table class="bku-closing-table">
                    <tr class="bold-row">
                      <td class="label-col">Saldo &nbsp;Buku Kas Umum</td>
                      <td class="colon-col">:</td>
                      <td class="val-col">${escapeHtmlSafe(formatRupiah(grp.endingBalance))}</td>
                    </tr>
                    <tr>
                      <td colspan="3" style="padding-top: 3px; padding-bottom: 3px;">Terdiri Dari :</td>
                    </tr>
                    <tr>
                      <td class="label-col">- <em>Saldo Bank</em></td>
                      <td class="colon-col">:</td>
                      <td class="val-col bold-text">${escapeHtmlSafe(formatRupiah(0))}</td>
                    </tr>
                    <tr>
                      <td class="label-col">- <em>Saldo Kas Tunai</em></td>
                      <td class="colon-col">:</td>
                      <td class="val-col bold-text">${escapeHtmlSafe(formatRupiah(grp.endingBalance))}</td>
                    </tr>
                    <tr class="bold-row">
                      <td class="label-col">Jumlah</td>
                      <td class="colon-col">:</td>
                      <td class="val-col">${escapeHtmlSafe(formatRupiah(grp.endingBalance))}</td>
                    </tr>
                  </table>
                </div>

                <div class="ttd-grid">
                  <div class="ttd-col">
                    <p>Menyetujui,</p>
                    <p>Ketua PGRI ${rantingTitleCase}</p>
                    <p>Kecamatan Sumberbaru</p>
                    <div class="ttd-signature-area">
                      ${stempel ? `<img src="${stempel}" class="stempel-img" alt="Stempel" />` : ''}
                      ${ttdKetua ? `<img src="${ttdKetua}" class="ttd-ketua-img" alt="TTD Ketua" />` : ''}
                    </div>
                    <p class="ttd-name">${escapeHtmlSafe(lpjSigners.ketuaName)}</p>
                    <p class="ttd-nip">${escapeHtmlSafe(lpjSigners.ketuaNpaLabel)}</p>
                  </div>
                  <div class="ttd-col">
                    <p>Sumberbaru, ${escapeHtmlSafe(grp.lastDateFull)}</p>
                    <p>Bendahara PGRI ${rantingTitleCase}</p>
                    <p>Kecamatan Sumberbaru</p>
                    <div class="ttd-signature-area">
                      ${ttdBendahara ? `<img src="${ttdBendahara}" class="ttd-bendahara-img" alt="TTD Bendahara" />` : ''}
                    </div>
                    <p class="ttd-name">${escapeHtmlSafe(lpjSigners.bendaharaName)}</p>
                    <p class="ttd-nip">${escapeHtmlSafe(lpjSigners.bendaharaNpaLabel)}</p>
                  </div>
                </div>
              </div>
            `;
          })
          .join('')
      : `<div class="month-page-section">
          ${kopHeaderHtml}
          <div class="bku-header-title">
            <div class="bku-header-box">
              <div class="bku-main-title">BUKU KAS UMUM</div>
              <div class="bku-sub-title">BULAN : - TAHUN : ${new Date().getFullYear()}</div>
            </div>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th style="width:26px;">No</th>
                <th style="width:78px;">Tanggal</th>
                <th>Uraian</th>
                <th style="width:92px;">Penerimaan</th>
                <th style="width:62px;">Volume</th>
                <th style="width:66px;">Satuan</th>
                <th style="width:88px;">Harga</th>
                <th style="width:92px;">Jumlah</th>
                <th style="width:95px;">Saldo</th>
              </tr>
            </thead>
            <tbody><tr><td colspan="9" style="text-align:center;">Belum ada data transaksi.</td></tr></tbody>
          </table>
        </div>`;

    const lpjStyles = `
      * { box-sizing: border-box; font-family: 'Times New Roman', Times, serif; }
      .kop-container { display: flex; align-items: center; gap: 14px; padding-bottom: 6px; position: relative; z-index: 2; }
      .kop-logo-wrapper { width: 94px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
      .kop-logo { width: 92px; height: 92px; object-fit: contain; display: block; }
      .kop-text-container { flex: 1; text-align: center; line-height: 1.18; color: #000; padding-left: 8px; }
      .kop-org { font-size: 13pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.3px; }
      .kop-sub-org { font-size: 10.5pt; font-weight: bold; font-style: italic; margin-top: 1px; }
      .kop-ranting { font-size: 16.5pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 1px; }
      .kop-wilayah { font-size: 12pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.3px; margin-top: 1px; }
      .kop-sekretariat { font-size: 8pt; font-style: italic; margin-top: 2px; white-space: nowrap; }
      .kop-divider { border-top: 2px solid #000; border-bottom: 1px solid #000; height: 2px; margin-bottom: 12px; position: relative; z-index: 2; }
      .bku-header-title { text-align: center; margin-top: 10px; margin-bottom: 14px; position: relative; z-index: 1; }
      .bku-header-box { display: inline-block; text-align: center; }
      .bku-main-title {
        font-family: 'Times New Roman', Times, serif !important;
        font-size: 13pt;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        border-bottom: 1.5px solid #000;
        padding-bottom: 2px;
        margin-bottom: 4px;
        color: #000;
      }
      .bku-sub-title {
        font-family: 'Times New Roman', Times, serif !important;
        font-size: 10pt;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        color: #000;
      }
      .month-page-section { position: relative; z-index: 1; }
      .page-break-after-month { page-break-after: always; break-after: page; }
      table.data-table { width: 100%; border-collapse: collapse; font-size: 8pt; position: relative; z-index: 1; margin-bottom: 12px; }
      table.data-table tr { page-break-inside: avoid; break-inside: avoid; }
      table.data-table th, table.data-table td { padding: 4px 6px; border: 1px solid #333; line-height: 1.2; }
      table.data-table th { background-color: #f1f5f9 !important; color: #000 !important; text-align: center; font-weight: bold; font-size: 8pt; text-transform: uppercase; }
      table.data-table tr:nth-child(even) { background-color: #fafafa !important; }
      .bku-closing-summary {
        font-family: 'Times New Roman', Times, serif !important;
        font-size: 9pt;
        color: #000;
        margin-top: 10px;
        margin-bottom: 6px;
        page-break-inside: avoid;
        break-inside: avoid;
        position: relative;
        z-index: 1;
      }
      .bku-closing-summary * { font-family: 'Times New Roman', Times, serif !important; }
      .bku-closing-intro { margin: 0 0 6px 0; }
      .bku-closing-table { border-collapse: collapse; font-size: 8.5pt; }
      .bku-closing-table td { border: none !important; padding: 1.5px 4px 1.5px 0; line-height: 1.3; white-space: nowrap; }
      .bku-closing-table td.label-col { width: 155px; }
      .bku-closing-table td.colon-col { width: 12px; text-align: center; }
      .bku-closing-table tr.bold-row td, .bku-closing-table td.bold-text { font-weight: bold; }
      .ttd-grid { display: flex; justify-content: space-between; margin-top: 18px; page-break-inside: avoid; break-inside: avoid; position: relative; z-index: 1; }
      .ttd-col { width: 42%; text-align: center; font-size: 8.8pt; position: relative; }
      .ttd-col p { margin: 1px 0; line-height: 1.25; }
      .ttd-signature-area { height: 65px; display: flex; align-items: center; justify-content: center; position: relative; overflow: visible; }
      .stempel-img { position: absolute; right: 50%; top: 50%; transform: translateY(-50%) rotate(${stempelRotation}deg); width: ${Math.round(112 * stempelScale)}px; height: ${Math.round(112 * stempelScale)}px; opacity: 0.85; object-fit: contain; pointer-events: none; z-index: 2; }
      .ttd-ketua-img { height: ${Math.round(62 * ttdKetuaScale)}px; width: auto; max-width: ${Math.round(160 * ttdKetuaScale)}px; object-fit: contain; position: relative; z-index: 1; }
      .ttd-bendahara-img { height: ${Math.round(62 * ttdBendaharaScale)}px; width: auto; max-width: ${Math.round(160 * ttdBendaharaScale)}px; object-fit: contain; }
      .ttd-name { font-weight: bold; text-decoration: underline; text-underline-offset: 4px; text-decoration-thickness: 1px; color: #000; margin-top: 2px; }
      .ttd-nip { font-size: 8pt; color: #111; }
    `;

    // JIKA DI PONSEL ATAU POP-UP DIBLOKIR: Gunakan html2pdf lokal untuk direct download PDF yang presisi
    if (!printWindow) {
      let container: HTMLDivElement | null = null;
      try {
        container = document.createElement('div');
        container.style.width = '1050px';
        container.style.backgroundColor = '#ffffff';
        container.style.color = '#000000';
        container.style.fontFamily = "'Times New Roman', Times, serif";
        container.style.padding = '0';
        container.style.margin = '0';

        container.innerHTML = `<style data-pdf-style="true">${lpjStyles}</style><div style="position: relative;">${lpjBodyInnerHtml}</div>`;

        await downloadContainerAsPdf(container, {
          filename: `LPJ_Keuangan_PGRI_Ranting_Gelang_${new Date().toISOString().split('T')[0]}.pdf`,
          orientation: 'landscape',
          margin: [8, 12, 6, 12],
          quality: 0.98,
          scale: 2,
          pagebreak: { mode: ['css', 'legacy'], after: '.page-break-after-month' }
        });
      } catch (err) {
        console.error('Gagal mengunduh PDF LPJ di ponsel:', err);
      } finally {
        if (container && document.body.contains(container)) {
          document.body.removeChild(container);
        }
      }
      return;
    }

    // JIKA DI PC / LAPTOP: Gunakan pratinjau cetak bawaan browser
    if (!printWindow) return;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>LPJ Keuangan PGRI Ranting Gelang</title>
          <style>
            @page { size: A4 landscape; margin: 0.8cm 1.2cm 0.6cm 1.2cm; }
            html, body {
              font-family: 'Times New Roman', Times, serif;
              margin: 0; padding: 0; color: #000; position: relative; min-height: 100%;
              -webkit-print-color-adjust: exact; print-color-adjust: exact;
            }
            ${lpjStyles}
          </style>
        </head>
        <body>
          ${lpjBodyInnerHtml}
          <script>
            window.onload = function() { window.print(); };
            window.onafterprint = function() { window.close(); };
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
    } finally {
      setIsExportingLpj(false);
    }
  };

  // Confirm Hapus
  const handleDeleteClick = (id: string, description: string) => {
    handleActionClick(() => {
      setIsClosingDeleteModal(false);
      setDeleteTarget({ id, desc: description });
    });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    const targetDesc = deleteTarget.desc;
    const deletedTx = transactions.find(t => t.id === targetId);
    const updated = transactions.filter(t => t.id !== targetId);
    onTransactionsChange(updated);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('kombel-financialTransactions', JSON.stringify(updated));
      } catch (err) {}
    }
    handleCloseDeleteModal();

    await deletePerDocItem('transaction_docs', targetId, 'Catatan Keuangan');
    const res = await mutateCloudCollection<FinancialTransaction>(
      'financialTransactions',
      ['kombel-financialTransactions'],
      (latest) => latest.filter(t => t.id !== targetId),
      updated,
      'Catatan Keuangan'
    );
    onTransactionsChange(res.items);
    const amountSuffix = deletedTx ? ` (${deletedTx.type} ${formatRupiah(Number(deletedTx.amount) || 0)})` : '';
    void logAuditEvent('Catatan Keuangan', 'Hapus Transaksi', `Menghapus transaksi "${targetDesc}"${amountSuffix}.`);
  };

  // Set spesifik status pembayaran & sinkronisasi otomatis transaksi kas secara agregat (1 baris per bulan & tahun)
  const handleSetPaymentStatus = async (teacherId: string, status: 'Lunas' | 'Belum Bayar', monthId?: string, teacherName?: string, yearStr?: string) => {
    const targetMonthId = monthId || selectedVerifikasiMonth;
    const targetYearStr = yearStr || selectedVerifikasiYear || currentYearStr;
    if (!targetMonthId || !targetYearStr) return;

    const monthObj = MONTH_OPTIONS.find(m => m.id === targetMonthId);
    const monthName = monthObj ? monthObj.name : 'Januari';
    const yearMonthCode = `${targetYearStr}-${targetMonthId}`;
    const targetEventKey = `month-${yearMonthCode}`;

    // Tanggal transaksi dana masuk selalu tanggal 02 pada tahun & bulan yang diverifikasi
    const now = new Date();
    const currentDay = String(now.getDate()).padStart(2, '0');
    const isoDate = `${targetYearStr}-${targetMonthId}-${currentDay}`;
    const danaMasukDate = `${targetYearStr}-${targetMonthId}-02`;
    const autoTxId = `tx-kas-event-${targetEventKey}`;

    // Cari referensi guru
    const tObj = sortedTeachers.find(t =>
      (teacherId && String(t.id).trim() === String(teacherId).trim()) ||
      (teacherName && t.name.trim().toLowerCase() === teacherName.trim().toLowerCase())
    );
    const resolvedTeacherId = tObj ? String(tObj.id).trim() : String(teacherId).trim();
    const resolvedTeacherName = tObj ? tObj.name : (teacherName || '');

    const applyPaymentMutation = (sourcePayments: CashPayment[]): CashPayment[] => {
      const result: CashPayment[] = [];
      let updated = false;

      for (const cp of sourcePayments) {
        const cpKey = String((cp as any).month || (cp as any).eventId || '').trim();
        const isSamePeriod = cpKey === targetEventKey || cpKey === yearMonthCode;
        const isSameTeacher = (
          (cp.teacherId && String(cp.teacherId).trim() === resolvedTeacherId) ||
          (resolvedTeacherName && (cp as any).teacherName && (cp as any).teacherName.trim().toLowerCase() === resolvedTeacherName.trim().toLowerCase())
        );

        if (isSamePeriod && isSameTeacher) {
          if (!updated) {
            const newRec: any = {
              ...cp,
              teacherId: resolvedTeacherId,
              teacherName: resolvedTeacherName,
              eventId: targetEventKey,
              month: yearMonthCode,
              year: targetYearStr,
              status
            };
            if (status === 'Lunas') {
              newRec.datePaid = cp.datePaid || isoDate;
            } else {
              delete newRec.datePaid;
            }
            result.push(newRec);
            updated = true;
          }
        } else {
          result.push(cp);
        }
      }

      if (!updated) {
        const newRec: any = {
          teacherId: resolvedTeacherId,
          teacherName: resolvedTeacherName,
          eventId: targetEventKey,
          month: yearMonthCode,
          year: targetYearStr,
          status,
          ...(status === 'Lunas' ? { datePaid: isoDate } : {})
        };
        result.push(newRec);
      }

      return result;
    };

    const computeLunasCount = (paymentsList: CashPayment[]) =>
      sortedTeachers.filter(teacher => {
        const p = paymentsList.find(cp => {
          const cpKey = String((cp as any).month || (cp as any).eventId || '').trim();
          const isSamePeriod = cpKey === targetEventKey || cpKey === yearMonthCode;
          const isSameTeacher = (
            (cp.teacherId && String(cp.teacherId).trim() === String(teacher.id).trim()) ||
            (teacher.name && (cp as any).teacherName && (cp as any).teacherName.trim().toLowerCase() === teacher.name.trim().toLowerCase())
          );
          return isSamePeriod && isSameTeacher;
        });
        return p?.status === 'Lunas';
      }).length;

    const applyAutoTxMutation = (sourceTransactions: FinancialTransaction[], totalAmount: number): FinancialTransaction[] => {
      if (totalAmount > 0) {
        const isTxExist = sourceTransactions.some(t => t.id === autoTxId);
        if (isTxExist) {
          return sourceTransactions.map(t =>
            t.id === autoTxId ? { ...t, amount: totalAmount, date: danaMasukDate, description: `Dana Masuk Pada Bulan ${monthName} ${targetYearStr}`, category: 'Kontribusi Anggota' } : t
          );
        }
        const newTx: FinancialTransaction = {
          id: autoTxId,
          date: danaMasukDate,
          type: 'Pemasukan',
          amount: totalAmount,
          description: `Dana Masuk Pada Bulan ${monthName} ${targetYearStr}`,
          category: 'Kontribusi Anggota'
        };
        return [newTx, ...sourceTransactions];
      }
      return sourceTransactions.filter(t => t.id !== autoTxId);
    };

    // 1. Update Optimistis UI & LocalStorage segera
    const updatedCashPayments = applyPaymentMutation(cashPayments);
    onCashPaymentsChange(updatedCashPayments);
    setVerifikasiToast(`${resolvedTeacherName || 'Anggota'} ditandai ${status === 'Lunas' ? 'Sudah Bayar' : 'Belum Bayar'}`);
    setTimeout(() => setVerifikasiToast(null), 2500);

    const optimisticTotalAmount = computeLunasCount(updatedCashPayments) * 10000;
    const updatedTransactions = applyAutoTxMutation(transactions, optimisticTotalAmount);
    onTransactionsChange(updatedTransactions);

    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('kombel-cashPayments', JSON.stringify(updatedCashPayments));
        localStorage.setItem('kombel-financialTransactions', JSON.stringify(updatedTransactions));
      } catch (err) {}
    }

    // 2. Fetch-Before-Write ke Cloud Firestore agar perubahan perangkat lain tidak tertimpa
    const cashRes = await mutateCloudCollection<CashPayment>(
      'cashPayments',
      ['kombel-cashPayments'],
      (latestPayments) => applyPaymentMutation(latestPayments),
      updatedCashPayments,
      'Pembayaran Kas'
    );
    onCashPaymentsChange(cashRes.items);

    const latestTotalAmount = computeLunasCount(cashRes.items) * 10000;
    const txRes = await mutateCloudCollection<FinancialTransaction>(
      'financialTransactions',
      ['kombel-financialTransactions'],
      (latestTransactions) => applyAutoTxMutation(latestTransactions, latestTotalAmount),
      updatedTransactions,
      'Catatan Keuangan'
    );
    onTransactionsChange(txRes.items);
  };

  // Set massal status pembayaran seluruh anggota/pengurus sesuai filter kategori yang aktif
  const handleBulkSetPaymentStatus = async (status: 'Lunas' | 'Belum Bayar') => {
    const targetMonthId = selectedVerifikasiMonth;
    const targetYearStr = selectedVerifikasiYear || currentYearStr;
    if (!targetMonthId || !targetYearStr || isBulkUpdatingVerifikasi) return;

    const targetTeachers = sortedTeachers.filter((t: any) => {
      if (verifikasiRoleFilter === 'Pengurus') return Boolean(t.isPengurus);
      if (verifikasiRoleFilter === 'Anggota') return !t.isPengurus;
      return true;
    });

    if (targetTeachers.length === 0) return;

    setIsBulkUpdatingVerifikasi(true);
    try {
      const monthObj = MONTH_OPTIONS.find(m => m.id === targetMonthId);
      const monthName = monthObj ? monthObj.name : 'Januari';
      const yearMonthCode = `${targetYearStr}-${targetMonthId}`;
      const targetEventKey = `month-${yearMonthCode}`;

      const now = new Date();
      const currentDay = String(now.getDate()).padStart(2, '0');
      const isoDate = `${targetYearStr}-${targetMonthId}-${currentDay}`;
      const danaMasukDate = `${targetYearStr}-${targetMonthId}-02`;
      const autoTxId = `tx-kas-event-${targetEventKey}`;

      const applyBulkMutation = (sourcePayments: CashPayment[]): CashPayment[] => {
        let nextList = [...sourcePayments];

        targetTeachers.forEach((teacher) => {
          const resolvedTeacherId = String(teacher.id).trim();
          const resolvedTeacherName = teacher.name || '';
          let found = false;

          nextList = nextList.map((cp) => {
            const cpKey = String((cp as any).month || (cp as any).eventId || '').trim();
            const isSamePeriod = cpKey === targetEventKey || cpKey === yearMonthCode;
            const isSameTeacher =
              (cp.teacherId && String(cp.teacherId).trim() === resolvedTeacherId) ||
              (resolvedTeacherName && (cp as any).teacherName && (cp as any).teacherName.trim().toLowerCase() === resolvedTeacherName.trim().toLowerCase());

            if (isSamePeriod && isSameTeacher) {
              found = true;
              const updatedRec: any = {
                ...cp,
                teacherId: resolvedTeacherId,
                teacherName: resolvedTeacherName,
                eventId: targetEventKey,
                month: yearMonthCode,
                year: targetYearStr,
                status
              };
              if (status === 'Lunas') {
                updatedRec.datePaid = cp.datePaid || isoDate;
              } else {
                delete updatedRec.datePaid;
              }
              return updatedRec;
            }
            return cp;
          });

          if (!found) {
            const newRec: any = {
              teacherId: resolvedTeacherId,
              teacherName: resolvedTeacherName,
              eventId: targetEventKey,
              month: yearMonthCode,
              year: targetYearStr,
              status,
              ...(status === 'Lunas' ? { datePaid: isoDate } : {})
            };
            nextList.push(newRec);
          }
        });

        return nextList;
      };

      const computeLunasCount = (paymentsList: CashPayment[]) =>
        sortedTeachers.filter(teacher => {
          const p = paymentsList.find(cp => {
            const cpKey = String((cp as any).month || (cp as any).eventId || '').trim();
            const isSamePeriod = cpKey === targetEventKey || cpKey === yearMonthCode;
            const isSameTeacher = (
              (cp.teacherId && String(cp.teacherId).trim() === String(teacher.id).trim()) ||
              (teacher.name && (cp as any).teacherName && (cp as any).teacherName.trim().toLowerCase() === teacher.name.trim().toLowerCase())
            );
            return isSamePeriod && isSameTeacher;
          });
          return p?.status === 'Lunas';
        }).length;

      const applyAutoTxMutation = (sourceTransactions: FinancialTransaction[], totalAmount: number): FinancialTransaction[] => {
        if (totalAmount > 0) {
          const isTxExist = sourceTransactions.some(t => t.id === autoTxId);
          if (isTxExist) {
            return sourceTransactions.map(t =>
              t.id === autoTxId ? { ...t, amount: totalAmount, date: danaMasukDate, description: `Dana Masuk Pada Bulan ${monthName} ${targetYearStr}`, category: 'Kontribusi Anggota' } : t
            );
          }
          const newTx: FinancialTransaction = {
            id: autoTxId,
            date: danaMasukDate,
            type: 'Pemasukan',
            amount: totalAmount,
            description: `Dana Masuk Pada Bulan ${monthName} ${targetYearStr}`,
            category: 'Kontribusi Anggota'
          };
          return [newTx, ...sourceTransactions];
        }
        return sourceTransactions.filter(t => t.id !== autoTxId);
      };

      const updatedCashPayments = applyBulkMutation(cashPayments);
      onCashPaymentsChange(updatedCashPayments);

      const labelTarget =
        verifikasiRoleFilter === 'Semua'
          ? `Semua anggota & pengurus (${targetTeachers.length} orang)`
          : `Semua ${verifikasiRoleFilter.toLowerCase()} (${targetTeachers.length} orang)`;
      setVerifikasiToast(`${labelTarget} ditandai ${status === 'Lunas' ? 'Sudah Bayar' : 'Belum Bayar'}`);
      setTimeout(() => setVerifikasiToast(null), 2800);

      const optimisticTotalAmount = computeLunasCount(updatedCashPayments) * 10000;
      const updatedTransactions = applyAutoTxMutation(transactions, optimisticTotalAmount);
      onTransactionsChange(updatedTransactions);

      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('kombel-cashPayments', JSON.stringify(updatedCashPayments));
          localStorage.setItem('kombel-financialTransactions', JSON.stringify(updatedTransactions));
        } catch (err) {}
      }

      const cashRes = await mutateCloudCollection<CashPayment>(
        'cashPayments',
        ['kombel-cashPayments'],
        (latestPayments) => applyBulkMutation(latestPayments),
        updatedCashPayments,
        'Pembayaran Kas'
      );
      onCashPaymentsChange(cashRes.items);

      const latestTotalAmount = computeLunasCount(cashRes.items) * 10000;
      const txRes = await mutateCloudCollection<FinancialTransaction>(
        'financialTransactions',
        ['kombel-financialTransactions'],
        (latestTransactions) => applyAutoTxMutation(latestTransactions, latestTotalAmount),
        updatedTransactions,
        'Catatan Keuangan'
      );
      onTransactionsChange(txRes.items);
    } finally {
      setIsBulkUpdatingVerifikasi(false);
    }
  };

  // Helper memuat pengaturan visual & data Bendahara dari Profil Kombel
  const fetchPrintSettingsAndSigner = async () => {
    let settingsData: Record<string, string> = {};
    try {
      if (typeof window !== 'undefined') {
        const keys = [
          'logo-pgri', 'logo-kombel',
          'ttd-bendahara', 'ttd-bendahara-size'
        ];
        keys.forEach(k => {
          const val = localStorage.getItem(k);
          if (val) settingsData[k] = val;
        });
      }
    } catch (e) {
      console.warn('Gagal memuat setting cetak:', e);
    }

    const signers = resolveSignersFromPengurus();
    return {
      settingsData,
      bendaharaName: signers.bendaharaName,
      bendaharaNip: signers.bendaharaNpaRaw,
      bendaharaNpaLabel: signers.bendaharaNpaLabel
    };
  };

  // Handler Unduh PDF Daftar Pembayaran Uang Kas Anggota (PC: Jendela Cetak | Ponsel: Auto Download PDF)
  const handleDownloadDaftarPembayaranPDF = async () => {
    if (isDownloadingKasPdf) return;
    setIsDownloadingKasPdf(true);
    try {
    const printWindow = !isMobileDevice() ? window.open('', '_blank') : null;
    const { settingsData, bendaharaName, bendaharaNpaLabel } = await fetchPrintSettingsAndSigner();

    const logoPgri = settingsData['logo-pgri'] || settingsData['logo-kombel'] || '';
    const ttdBendahara = settingsData['ttd-bendahara'] || '';
    const ttdBendaharaScale = Math.max(0.3, Math.min(2.5, (Number(settingsData['ttd-bendahara-size']) || 100) / 100));
    const kopOrg = escapeHtmlSafe(orgConfig.kopOrganisasi || 'PERSATUAN GURU REPUBLIK INDONESIA');
    const kopRanting = escapeHtmlSafe(orgConfig.kopRanting || 'RANTING GELANG');
    const kopWilayah = escapeHtmlSafe(orgConfig.kopWilayah || 'KECAMATAN SUMBERBARU - KABUPATEN JEMBER');
    const kopSekretariat = escapeHtmlSafe(orgConfig.kopSekretariat || 'Sekretariat : Jl. PTPN XII Gunung Gambir Desa Gelang, Kecamatan Sumberbaru - Kabupaten Jember 68156');

    // Tanggal cetak hari ini (contoh: Jember, 18 Agustus 2026)
    const todayFormatted = new Date().toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    const selectedMonthObj = filterMonth !== 'Semua' ? MONTH_OPTIONS.find(m => m.id === filterMonth) : null;
    const periodeSubtitle = selectedMonthObj
      ? `BULAN : ${selectedMonthObj.name.toUpperCase()} ${filterYear}`
      : `TAHUN : ${filterYear}`;

    const formatSchoolTitleCase = (schoolRaw?: string) => {
      const trimmed = String(schoolRaw || '').trim();
      if (!trimmed) return '-';
      const words = trimmed.toLowerCase().split(/\s+/);
      return words
        .map((word, idx) => {
          if (word === 'sdn') return 'SDN';
          if (word === 'sd') return 'SD';
          if (word === 'nu' && idx > 0 && words[idx - 1] === 'sd') return 'NU';
          return word.charAt(0).toUpperCase() + word.slice(1);
        })
        .join(' ');
    };

    const formatPhoneZeroPrefix = (phoneRaw?: string) => {
      const cleaned = String(phoneRaw || '').replace(/^'+/, '').replace(/[^0-9]/g, '');
      if (!cleaned) return '-';
      if (cleaned.startsWith('62')) return `0${cleaned.slice(2)}`;
      if (!cleaned.startsWith('0')) return `0${cleaned}`;
      return cleaned;
    };

    const sudahBayarCount = paymentItems.filter(item => {
      const payment = getPayment(item.teacher.id, item.month.id, item.teacher.name, item.year);
      return payment?.status === 'Lunas';
    }).length;
    const belumBayarCount = paymentItems.length - sudahBayarCount;

    const rows = paymentItems.map((item, index) => {
      const payment = getPayment(item.teacher.id, item.month.id, item.teacher.name, item.year);
      const isLunas = payment?.status === 'Lunas';
      const gender = getGender(item.teacher);
      const nipOnly = String((item.teacher as any).nip || '').trim() || '-';
      const formattedSchool = formatSchoolTitleCase(item.teacher.school);
      const formattedPhone = formatPhoneZeroPrefix((item.teacher as any).phone);

      return `
        <tr>
          <td style="text-align: center;">${index + 1}</td>
          <td style="text-align: left; font-weight: bold;">${escapeHtmlSafe(item.teacher.name)}</td>
          <td style="text-align: center; font-family: monospace;">${escapeHtmlSafe(nipOnly)}</td>
          <td style="text-align: center; font-weight: bold;">${escapeHtmlSafe(gender)}</td>
          <td style="text-align: left;">${escapeHtmlSafe(formattedSchool)}</td>
          <td style="text-align: center; font-family: monospace;">${escapeHtmlSafe(formattedPhone)}</td>
          <td style="text-align: center;">${escapeHtmlSafe(item.month.name)} ${escapeHtmlSafe(item.year)}</td>
          <td style="text-align: center; font-weight: bold; color: ${isLunas ? '#059669' : '#dc2626'};">
            ${isLunas ? 'Lunas' : 'Belum Bayar'}
          </td>
        </tr>
      `;
    }).join('');

    // JIKA DI PONSEL ATAU POP-UP DIBLOKIR: Gunakan html2pdf lokal untuk direct download PDF yang presisi
    if (!printWindow) {
      let container: HTMLDivElement | null = null;
      try {
        container = document.createElement('div');
        container.style.width = '1050px';
        container.style.backgroundColor = '#ffffff';
        container.style.color = '#000000';
        container.style.fontFamily = "'Times New Roman', Times, serif";
        container.style.padding = '0';
        container.style.margin = '0';

        container.innerHTML = `
          <style data-pdf-style="true">
            * { box-sizing: border-box; font-family: 'Times New Roman', Times, serif; }
            .kop-container {
              display: flex;
              align-items: center;
              gap: 14px;
              padding-bottom: 6px;
              position: relative;
              z-index: 2;
            }
            .kop-logo-wrapper {
              width: 94px;
              flex-shrink: 0;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .kop-logo {
              width: 92px;
              height: 92px;
              object-fit: contain;
              display: block;
            }
            .kop-text-container {
              flex: 1;
              text-align: center;
              line-height: 1.18;
              color: #000000;
              padding-left: 8px;
            }
            .kop-org {
              font-size: 13pt;
              font-weight: bold;
              text-transform: uppercase;
              letter-spacing: 0.3px;
            }
            .kop-sub-org {
              font-size: 10.5pt;
              font-weight: bold;
              font-style: italic;
              margin-top: 1px;
            }
            .kop-ranting {
              font-size: 16.5pt;
              font-weight: bold;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              margin-top: 1px;
            }
            .kop-wilayah {
              font-size: 12pt;
              font-weight: bold;
              text-transform: uppercase;
              letter-spacing: 0.3px;
              margin-top: 1px;
            }
            .kop-sekretariat {
              font-size: 8pt;
              font-style: italic;
              margin-top: 2px;
              white-space: nowrap;
            }
            .kop-divider {
              border-top: 2px solid #000000;
              border-bottom: 1px solid #000000;
              height: 2px;
              margin-bottom: 12px;
              position: relative;
              z-index: 2;
            }
            .document-title {
              text-align: center;
              margin-top: 16px;
              margin-bottom: 20px;
              position: relative;
              z-index: 1;
            }
            .document-title-container {
              display: inline-block;
              text-align: center;
            }
            .document-title h3 {
              margin: 0;
              font-size: 11.5pt;
              font-weight: bold;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .title-divider {
              width: 100%;
              border-top: 1px solid #000;
              margin: 2px 0 3px 0;
            }
            .document-title p {
              margin: 0;
              font-size: 8.5pt;
              font-weight: bold;
            }
            table.data-table { 
              width: 100%; 
              border-collapse: collapse; 
              font-size: 7.8pt;
              position: relative;
              z-index: 1;
            }
            table.data-table tr {
              page-break-inside: avoid;
              break-inside: avoid;
            }
            table.data-table th, table.data-table td { 
              padding: 3px 5px; 
              border: 1px solid #333; 
              white-space: nowrap;
              line-height: 1.15;
            }
            table.data-table th { 
              background-color: #f1f5f9; 
              color: #000; 
              text-align: center; 
              font-weight: bold; 
              font-size: 8pt; 
              text-transform: uppercase;
            }
            table.data-table tr:nth-child(even) { 
              background-color: #fafafa; 
            }
            .footer-section {
              margin-top: 28px;
              width: 100%;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
              display: table;
              position: relative;
              z-index: 1;
            }
            .footer-row {
              display: table-row;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
            .keterangan-col {
              display: table-cell;
              width: 38%;
              vertical-align: top;
            }
            .keterangan-box {
              border: 1.2px solid #000;
              padding: 5px 10px;
              font-size: 8.5pt;
              background-color: rgba(255, 255, 255, 0.9);
              display: inline-block;
              min-width: 190px;
            }
            .keterangan-title {
              margin: 0 0 5px 0;
              font-weight: bold;
              text-decoration: underline;
              text-underline-offset: 4px;
              text-decoration-thickness: 1px;
            }
            .keterangan-table {
              border-collapse: collapse;
              width: 100%;
              font-size: 8pt;
            }
            .keterangan-table td {
              border: none !important;
              padding: 0.5px 2px !important;
              line-height: 1.15;
              white-space: nowrap;
            }
            .keterangan-table td.label-col { width: 85px; }
            .keterangan-table td.colon-col { width: 10px; text-align: center; }
            .keterangan-table td.val-col { font-weight: bold; text-align: left; }
            .spacer-col {
              display: table-cell;
              width: 27%;
            }
            .ttd-col {
              display: table-cell;
              width: 35%;
              text-align: center;
              position: relative;
              font-size: 8.8pt;
              vertical-align: top;
            }
            .ttd-col p {
              margin: 1px 0;
              line-height: 1.25;
            }
            .ttd-signature-area {
              height: 65px;
              display: flex;
              align-items: center;
              justify-content: center;
              overflow: visible;
            }
            .ttd-signature-area img {
              height: ${Math.round(62 * ttdBendaharaScale)}px;
              width: auto;
              max-width: ${Math.round(160 * ttdBendaharaScale)}px;
              object-fit: contain;
            }
            .ttd-name {
              font-weight: bold;
              text-decoration: underline;
              text-underline-offset: 4px;
              text-decoration-thickness: 1px;
              color: #000;
              margin-top: 2px;
            }
            .ttd-nip {
              font-size: 8pt;
              color: #111;
            }
          </style>

          <div style="position: relative; min-height: 650px;">
            <div class="kop-container">
              <div class="kop-logo-wrapper">
                ${logoPgri
                  ? `<img src="${logoPgri}" alt="Logo PGRI" class="kop-logo" />`
                  : `<div style="width: 92px; height: 92px; border: 1.5px dashed #94a3b8; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9pt; color: #64748b; text-align: center;">Logo<br/>PGRI</div>`}
              </div>
              <div class="kop-text-container">
                <div class="kop-org">${kopOrg}</div>
                <div class="kop-sub-org">(Teachers Association Of Republic Indonesia)</div>
                <div class="kop-ranting">${kopRanting}</div>
                <div class="kop-wilayah">${kopWilayah}</div>
                <div class="kop-sekretariat">${kopSekretariat}</div>
              </div>
              <div style="width: 94px; flex-shrink: 0;"></div>
            </div>
            <div class="kop-divider"></div>

            <div class="document-title">
              <div class="document-title-container">
                <h3>STATUS PEMBAYARAN</h3>
                <div class="title-divider"></div>
                <p>${periodeSubtitle}</p>
              </div>
            </div>

            <table class="data-table">
              <thead>
                <tr>
                  <th style="width: 26px;">No</th>
                  <th>Nama Anggota</th>
                  <th style="width: 115px;">NIP</th>
                  <th style="width: 35px;">L/P</th>
                  <th>Nama Sekolah</th>
                  <th style="width: 95px;">WhatsApp</th>
                  <th>Bulan</th>
                  <th style="width: 80px;">Status</th>
                </tr>
              </thead>
              <tbody>
                ${rows.length > 0 ? rows : '<tr><td colSpan="8" style="text-align:center;">Belum ada data anggota.</td></tr>'}
              </tbody>
            </table>

            <div class="footer-section">
              <div class="footer-row">
                <div class="keterangan-col">
                  <div class="keterangan-box">
                    <p class="keterangan-title">Keterangan :</p>
                    <table class="keterangan-table">
                      <tr>
                        <td class="label-col">Sudah Bayar</td>
                        <td class="colon-col">:</td>
                        <td class="val-col" style="color: #059669;">${sudahBayarCount}</td>
                      </tr>
                      <tr>
                        <td class="label-col">Belum Bayar</td>
                        <td class="colon-col">:</td>
                        <td class="val-col" style="color: #dc2626;">${belumBayarCount}</td>
                      </tr>
                    </table>
                  </div>
                </div>

                <div class="spacer-col"></div>

                <div class="ttd-col">
                  <p>Sumberbaru, ${todayFormatted}</p>
                  <p>Bendahara PGRI Ranting Gelang</p>
                  <p>Kecamatan Sumberbaru</p>
                  
                  <div class="ttd-signature-area">
                    ${ttdBendahara ? `<img src="${ttdBendahara}" alt="TTD Bendahara" />` : ''}
                  </div>

                  <p class="ttd-name">${bendaharaName}</p>
                  <p class="ttd-nip">${bendaharaNpaLabel}</p>
                </div>
              </div>
            </div>
          </div>
        `;

        await downloadContainerAsPdf(container, {
          filename: `Rekap_Daftar_Pembayaran_Uang_Kas_${new Date().toISOString().split('T')[0]}.pdf`,
          orientation: 'landscape',
          margin: [8, 12, 6, 12],
          quality: 0.98,
          scale: 2
        });
      } catch (err) {
        console.error('Gagal mengunduh PDF di ponsel:', err);
      } finally {
        if (container && document.body.contains(container)) {
          document.body.removeChild(container);
        }
      }
      return;
    }

    // JIKA DI PC / LAPTOP: Gunakan pratinjau cetak bawaan browser
    if (!printWindow) return;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Rekap Daftar Pembayaran Uang Kas</title>
          <style>
            @page { 
              size: A4 landscape; 
              margin: 0.8cm 1.2cm 0.6cm 1.2cm; 
            }
            * {
              box-sizing: border-box;
              font-family: 'Times New Roman', Times, serif;
            }
            html, body { 
              font-family: 'Times New Roman', Times, serif; 
              margin: 0; 
              padding: 0; 
              color: #000; 
              position: relative;
              min-height: 100%;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }

            /* Kop Surat PGRI Ranting Gelang */
            .kop-container {
              display: flex;
              align-items: center;
              gap: 14px;
              padding-bottom: 6px;
              position: relative;
              z-index: 2;
            }
            .kop-logo-wrapper {
              width: 94px;
              flex-shrink: 0;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .kop-logo {
              width: 92px;
              height: 92px;
              object-fit: contain;
              display: block;
            }
            .kop-text-container {
              flex: 1;
              text-align: center;
              line-height: 1.18;
              color: #000000;
              padding-left: 8px;
            }
            .kop-org {
              font-size: 13pt;
              font-weight: bold;
              text-transform: uppercase;
              letter-spacing: 0.3px;
            }
            .kop-sub-org {
              font-size: 10.5pt;
              font-weight: bold;
              font-style: italic;
              margin-top: 1px;
            }
            .kop-ranting {
              font-size: 16.5pt;
              font-weight: bold;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              margin-top: 1px;
            }
            .kop-wilayah {
              font-size: 12pt;
              font-weight: bold;
              text-transform: uppercase;
              letter-spacing: 0.3px;
              margin-top: 1px;
            }
            .kop-sekretariat {
              font-size: 8pt;
              font-style: italic;
              margin-top: 2px;
              white-space: nowrap;
            }
            .kop-divider {
              border-top: 2px solid #000000;
              border-bottom: 1px solid #000000;
              height: 2px;
              margin-bottom: 12px;
              position: relative;
              z-index: 2;
            }

            /* Judul Dokumen */
            .document-title {
              text-align: center;
              margin-top: 20px;
              margin-bottom: 24px;
            }
            .document-title-container {
              display: inline-block;
              text-align: center;
            }
            .document-title h3 {
              margin: 0;
              font-size: 13pt;
              font-weight: bold;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .title-divider {
              width: 100%;
              border-top: 1px solid #000;
              margin: 3px 0 4px 0;
            }
            .document-title p {
              margin: 0;
              font-size: 9.5pt;
              font-weight: bold;
            }

            /* Tabel */
            table.data-table { 
              width: 100%; 
              border-collapse: collapse; 
              font-size: 7.8pt;
              page-break-inside: auto;
            }
            table.data-table tr {
              page-break-inside: avoid;
              break-inside: avoid;
            }
            table.data-table th, table.data-table td { 
              padding: 2.5px 5px; 
              border: 1px solid #333; 
              white-space: nowrap;
              line-height: 1.15;
            }
            table.data-table th { 
              background-color: #f1f5f9 !important; 
              color: #000 !important; 
              text-align: center; 
              font-weight: bold; 
              font-size: 8pt; 
              text-transform: uppercase;
            }
            table.data-table tr:nth-child(even) { 
              background-color: #fafafa !important; 
            }

            /* Area Bawah: Kotak Keterangan & TTD */
            .footer-section {
              margin-top: 28px;
              width: 100%;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
              display: table;
            }
            .footer-row {
              display: table-row;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }

            /* Kotak Keterangan Pojok Kiri Bawah */
            .keterangan-col {
              display: table-cell;
              width: 38%;
              vertical-align: top;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
            .keterangan-box {
              border: 1.2px solid #000;
              padding: 5px 10px;
              font-size: 8.5pt;
              background-color: rgba(255, 255, 255, 0.85);
              display: inline-block;
              min-width: 190px;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
            .keterangan-title {
              margin: 0 0 5px 0;
              font-weight: bold;
              text-decoration: underline;
              text-underline-offset: 4px;
              text-decoration-thickness: 1px;
            }
            .keterangan-table {
              border-collapse: collapse;
              width: 100%;
              font-size: 8pt;
            }
            .keterangan-table td {
              border: none !important;
              padding: 0.5px 2px !important;
              line-height: 1.15;
              white-space: nowrap;
            }
            .keterangan-table td.label-col {
              width: 85px;
            }
            .keterangan-table td.colon-col {
              width: 10px;
              text-align: center;
            }
            .keterangan-table td.val-col {
              font-weight: bold;
              text-align: left;
            }

            /* Spacer Tengah */
            .spacer-col {
              display: table-cell;
              width: 27%;
            }

            /* Kotak Tanda Tangan Pojok Kanan Bawah */
            .ttd-col {
              display: table-cell;
              width: 35%;
              text-align: center;
              position: relative;
              font-size: 8.8pt;
              vertical-align: top;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
            .ttd-col p {
              margin: 1px 0;
              line-height: 1.25;
            }
            .ttd-signature-area {
              height: 65px;
              display: flex;
              align-items: center;
              justify-content: center;
              overflow: visible;
            }
            .ttd-signature-area img {
              height: ${Math.round(62 * ttdBendaharaScale)}px;
              width: auto;
              max-width: ${Math.round(160 * ttdBendaharaScale)}px;
              object-fit: contain;
            }
            .ttd-name {
              font-weight: bold;
              text-decoration: underline;
              text-underline-offset: 4px;
              text-decoration-thickness: 1px;
              color: #000;
              margin-top: 2px;
            }
            .ttd-nip {
              font-size: 8pt;
              color: #111;
            }
          </style>
        </head>
        <body>

          <!-- Kop Surat PGRI Ranting Gelang -->
          <div class="kop-container">
            <div class="kop-logo-wrapper">
              ${logoPgri
                ? `<img src="${logoPgri}" alt="Logo PGRI" class="kop-logo" />`
                : `<div style="width: 92px; height: 92px; border: 1.5px dashed #94a3b8; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9pt; color: #64748b; text-align: center;">Logo<br/>PGRI</div>`}
            </div>
            <div class="kop-text-container">
              <div class="kop-org">${kopOrg}</div>
              <div class="kop-sub-org">(Teachers Association Of Republic Indonesia)</div>
              <div class="kop-ranting">${kopRanting}</div>
              <div class="kop-wilayah">${kopWilayah}</div>
              <div class="kop-sekretariat">${kopSekretariat}</div>
            </div>
            <div style="width: 94px; flex-shrink: 0;"></div>
          </div>
          <div class="kop-divider"></div>

          <!-- Judul Dokumen -->
          <div class="document-title">
            <div class="document-title-container">
              <h3>STATUS PEMBAYARAN</h3>
              <div class="title-divider"></div>
              <p>${periodeSubtitle}</p>
            </div>
          </div>

          <!-- Tabel Data Pembayaran -->
          <table class="data-table">
            <thead>
              <tr>
                <th style="width: 26px;">No</th>
                <th>Nama Anggota</th>
                <th style="width: 115px;">NIP</th>
                <th style="width: 35px;">L/P</th>
                <th>Nama Sekolah</th>
                <th style="width: 95px;">WhatsApp</th>
                <th>Bulan</th>
                <th style="width: 80px;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${rows.length > 0 ? rows : '<tr><td colSpan="8" style="text-align:center;">Belum ada data anggota.</td></tr>'}
            </tbody>
          </table>

          <!-- Area Bawah: Kotak Keterangan (Kiri) & TTD (Kanan) -->
          <div class="footer-section">
            <div class="footer-row">
              
              <!-- Kotak Keterangan Pojok Kiri Bawah -->
              <div class="keterangan-col">
                <div class="keterangan-box">
                  <p class="keterangan-title">Keterangan :</p>
                  <table class="keterangan-table">
                    <tr>
                      <td class="label-col">Sudah Bayar</td>
                      <td class="colon-col">:</td>
                      <td class="val-col" style="color: #059669;">${sudahBayarCount}</td>
                    </tr>
                    <tr>
                      <td class="label-col">Belum Bayar</td>
                      <td class="colon-col">:</td>
                      <td class="val-col" style="color: #dc2626;">${belumBayarCount}</td>
                    </tr>
                  </table>
                </div>
              </div>

              <!-- Spacer Tengah -->
              <div class="spacer-col"></div>

              <!-- Kotak Tanda Tangan Bendahara -->
              <div class="ttd-col">
                <p>Sumberbaru, ${todayFormatted}</p>
                <p>Bendahara PGRI Ranting Gelang</p>
                <p>Kecamatan Sumberbaru</p>
                
                <div class="ttd-signature-area">
                  ${ttdBendahara ? `<img src="${ttdBendahara}" alt="TTD Bendahara" />` : ''}
                </div>

                <p class="ttd-name">${bendaharaName}</p>
                <p class="ttd-nip">${bendaharaNpaLabel}</p>
              </div>

            </div>
          </div>

          <script>
            window.onload = function() {
              window.print();
            };
            window.onafterprint = function() { 
              window.close(); 
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
    } finally {
      setIsDownloadingKasPdf(false);
    }
  };

  // Sinkronisasi status guru murni per bulan & tahun yang dipilih (mengabaikan periode sebelum mulai iuran)
  const lunasTeachersList = useMemo(() => {
    if (!selectedVerifikasiMonth || !selectedVerifikasiYear) return [];
    if (!isPeriodActive(selectedVerifikasiYear, selectedVerifikasiMonth)) return [];
    return sortedTeachers
      .filter(t => {
        const p = getPayment(t.id, selectedVerifikasiMonth, t.name, selectedVerifikasiYear);
        return p?.status === 'Lunas';
      })
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'id', { sensitivity: 'base' }));
  }, [sortedTeachers, cashPayments, selectedVerifikasiMonth, selectedVerifikasiYear, duesStartPeriod]);

  const belumBayarTeachersList = useMemo(() => {
    if (!selectedVerifikasiMonth || !selectedVerifikasiYear) return sortedTeachers;
    if (!isPeriodActive(selectedVerifikasiYear, selectedVerifikasiMonth)) return [];
    return sortedTeachers
      .filter(t => {
        const p = getPayment(t.id, selectedVerifikasiMonth, t.name, selectedVerifikasiYear);
        return p?.status !== 'Lunas';
      })
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'id', { sensitivity: 'base' }));
  }, [sortedTeachers, cashPayments, selectedVerifikasiMonth, selectedVerifikasiYear, duesStartPeriod]);

  const filteredVerifikasiTeachers = useMemo(() => {
    const baseList = verifikasiFilter === 'Lunas' ? lunasTeachersList : belumBayarTeachersList;
    if (verifikasiRoleFilter === 'Pengurus') {
      return baseList.filter((t: any) => Boolean(t.isPengurus));
    }
    if (verifikasiRoleFilter === 'Anggota') {
      return baseList.filter((t: any) => !t.isPengurus);
    }
    return baseList;
  }, [verifikasiFilter, verifikasiRoleFilter, lunasTeachersList, belumBayarTeachersList]);

  return (
    <div className="font-sans space-y-6 relative">

      {/* CSS Keyframes untuk animasi modal buka & tutup yang smooth */}
      <style>{`
        @keyframes backdropFade {
          from { opacity: 0; backdrop-filter: blur(0px); }
          to { opacity: 1; backdrop-filter: blur(8px); }
        }
        @keyframes smoothBackdropOut {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes modalPopIn {
          0% { opacity: 0; transform: scale(0.88) translateY(12px); }
          70% { transform: scale(1.02) translateY(-2px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes smoothModalOut {
          0% {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
          100% {
            opacity: 0;
            transform: scale(0.92) translateY(16px);
          }
        }
        .animate-backdrop-fade,
        .modal-backdrop-enter {
          animation: backdropFade 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .modal-backdrop-exit {
          animation: smoothBackdropOut 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .animate-modal-pop,
        .modal-content-enter {
          animation: modalPopIn 0.38s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        .modal-content-exit {
          animation: smoothModalOut 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes tabPanelEnter {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes panelFadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-tab-enter {
          animation: tabPanelEnter 0.28s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .animate-fadeIn,
        .animate-panel-in {
          animation: panelFadeIn 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>

      {/* Header Banner — Wibawa Kusuma Bangsa */}
      <div className={`relative overflow-hidden w-full min-h-[164px] rounded-2xl p-6 sm:p-8 border flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 ${isDark
        ? 'bg-gradient-to-br from-[#231214] via-stone-900 to-[#1a1112] border-red-900/40 text-stone-100 shadow-[0_8px_24px_rgba(0,0,0,0.45)] pgri-batik-pattern-dark'
        : 'bg-gradient-to-br from-[#fdfbf7] via-white to-red-50/50 border-stone-200/90 text-stone-900 shadow-[0_6px_20px_rgba(127,29,29,0.06)] pgri-batik-pattern'
        }`}>
        <div className="absolute top-0 inset-x-0 h-[3px] pgri-top-accent pointer-events-none" />

        {/* Banner Content (Kiri) */}
        <div className="relative z-10">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-red-800 dark:text-amber-400 mb-1.5">
            <Wallet className="w-3.5 h-3.5" />
            Catatan Keuangan
          </p>
          <h1 className={`font-display text-2xl sm:text-3xl font-extrabold tracking-tight ${isDark ? 'text-white' : 'text-stone-900'
            }`}>
            Kelola Catatan Keuangan
          </h1>
          <p className={`text-xs sm:text-sm font-medium mt-1 ${isDark ? 'text-stone-400' : 'text-stone-600'
            }`}>
            Kelola data pemasukan, pengeluaran kas, dan status pembayaran
          </p>
        </div>

        {/* Header Sebelah Kanan: Rekening Kas + Fitur Copy + Tombol Konfirmasi */}
        <div className="relative z-10 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
          <div
            onClick={handleCopyAccount}
            title="Klik untuk menyalin nomor rekening"
            className={`group px-4 py-2.5 rounded-xl border flex items-center justify-between gap-3 shadow-sm transition-all duration-300 cursor-pointer select-none active:scale-95 ${copiedBank
              ? isDark
                ? 'bg-emerald-950/60 border-emerald-500/70 ring-2 ring-emerald-500/25 text-stone-100'
                : 'bg-emerald-50/70 border-emerald-400 ring-2 ring-emerald-400/25 text-stone-800'
              : isDark
                ? 'bg-stone-900/90 hover:bg-stone-800 border-stone-700 hover:border-amber-500/50 text-stone-100'
                : 'bg-white hover:bg-[#faf8f5] border-stone-300 hover:border-red-300 text-stone-800'
              }`}
          >
            <div className="flex items-center gap-2.5">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                isDark ? 'bg-red-950/80 text-amber-400 border border-red-800/50' : 'bg-red-50 text-red-800 border border-red-200'
              }`}>
                <CreditCard className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold tracking-wider text-stone-500 dark:text-stone-400">VIA TRANSFER : {orgConfig.bankAccountHolder}</p>
                <p className="font-mono font-bold text-xs sm:text-sm tracking-tight text-red-800 dark:text-amber-300 flex items-center gap-1.5">
                  {orgConfig.bankName} : {orgConfig.bankAccountNumber}
                </p>
              </div>
            </div>
            <div className="pl-1 text-stone-400 group-hover:text-red-700 dark:group-hover:text-amber-400 transition-colors">
              {copiedBank ? (
                <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                  <CheckCheck className="w-3.5 h-3.5" /> Tersalin
                </span>
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2 shrink-0">
            <button
              type="button"
              onClick={handleOpenQrisModal}
              className={`px-5 py-2 rounded-xl border font-bold text-xs sm:text-sm shadow-sm active:scale-95 flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                isDark
                  ? 'bg-stone-900/90 hover:bg-stone-800 border-amber-500/40 text-amber-300'
                  : 'bg-white hover:bg-amber-50 border-red-300 text-red-800'
              }`}
            >
              <QrCode className="w-4 h-4" />
              <span>Download QRIS</span>
            </button>

            <button
              onClick={handleOpenConfirmTransferModal}
              className="px-5 py-2.5 rounded-xl bg-red-800 hover:bg-red-700 text-white font-bold text-xs sm:text-sm shadow-sm active:scale-95 flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Send className="w-4 h-4" />
              <span>Konfirmasi Pembayaran</span>
            </button>
          </div>
        </div>
      </div>

      {/* Statistik Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
        {/* Card Pemasukan */}
        <div className="bg-white [.dark_&]:bg-stone-900 dark:bg-stone-900 rounded-2xl p-4 sm:p-6 shadow-sm border border-stone-200/90 [.dark_&]:border-stone-800 dark:border-stone-800 flex flex-row items-center gap-2.5 sm:gap-4 relative overflow-hidden transition-all duration-300 hover:shadow-md group">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-emerald-50 [.dark_&]:bg-emerald-950/60 dark:bg-emerald-950/60 border border-emerald-200/80 [.dark_&]:border-emerald-800/50 dark:border-emerald-800/50 text-emerald-700 [.dark_&]:text-emerald-400 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <ArrowUpCircle className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div className="min-w-0 w-full">
            <p className="text-xs sm:text-sm text-stone-500 [.dark_&]:text-stone-400 dark:text-stone-400 font-medium truncate">Total Pemasukan</p>
            <h3 className="font-display text-sm xs:text-base sm:text-xl font-bold text-stone-900 [.dark_&]:text-white dark:text-white mt-0.5 truncate">
              <AnimatedCounter value={totalPemasukan} />
            </h3>
          </div>
        </div>

        {/* Card Pengeluaran */}
        <div className="bg-white [.dark_&]:bg-stone-900 dark:bg-stone-900 rounded-2xl p-4 sm:p-6 shadow-sm border border-stone-200/90 [.dark_&]:border-stone-800 dark:border-stone-800 flex flex-row items-center gap-2.5 sm:gap-4 relative overflow-hidden transition-all duration-300 hover:shadow-md group">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-red-50 [.dark_&]:bg-red-950/60 dark:bg-red-950/60 border border-red-200/80 [.dark_&]:border-red-800/50 dark:border-red-800/50 text-red-700 [.dark_&]:text-red-400 dark:text-red-400 flex items-center justify-center shrink-0">
            <ArrowDownCircle className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div className="min-w-0 w-full">
            <p className="text-xs sm:text-sm text-stone-500 [.dark_&]:text-stone-400 dark:text-stone-400 font-medium truncate">Total Pengeluaran</p>
            <h3 className="font-display text-sm xs:text-base sm:text-xl font-bold text-stone-900 [.dark_&]:text-white dark:text-white mt-0.5 truncate">
              <AnimatedCounter value={totalPengeluaran} />
            </h3>
          </div>
        </div>

        {/* Card Saldo Utama — PGRI Crimson-Gold */}
        <div className="col-span-2 md:col-span-1 bg-gradient-to-br from-red-900 via-red-800 to-amber-800 border border-red-700/60 rounded-2xl p-5 sm:p-6 shadow-md flex flex-col sm:flex-row items-center justify-center sm:justify-start text-center sm:text-left gap-3.5 sm:gap-4 relative overflow-hidden text-white transition-all duration-300 hover:shadow-lg group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-300/10 rounded-bl-full -mr-16 -mt-16 group-hover:scale-125 transition-transform duration-500" />
          <div className="w-12 h-12 rounded-xl bg-white/15 border border-amber-300/30 backdrop-blur-xs flex items-center justify-center shrink-0">
            <Wallet className="w-6 h-6 text-amber-200" />
          </div>
          <div>
            <p className="text-sm text-amber-100/90 font-medium tracking-wide">Saldo Kas Saat Ini</p>
            <h3 className="font-display text-2xl font-black mt-0.5 tracking-tight text-white">
              <AnimatedCounter value={saldoAkhir} />
            </h3>
          </div>
        </div>
      </div>

      {/* Tabs Menu */}
      <div className="bg-white [.dark_&]:bg-stone-900 dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-200/90 [.dark_&]:border-stone-800 dark:border-stone-800 overflow-hidden">
        <div className="relative border-b border-stone-200/80 [.dark_&]:border-stone-800 dark:border-stone-800">
          <div className="flex relative z-10">
            <button
              onClick={() => setActiveTab('transaksi')}
              className={`flex-1 py-4 text-sm font-semibold transition-all duration-200 cursor-pointer flex items-center justify-center gap-2 ${activeTab === 'transaksi'
                ? 'text-red-800 [.dark_&]:text-amber-400 dark:text-amber-400'
                : 'text-stone-500 hover:text-stone-800 [.dark_&]:text-stone-400 dark:text-stone-400 [.dark_&]:hover:text-stone-200 dark:hover:text-stone-200'
                }`}
            >
              <FileText className="w-4 h-4" />
              Buku Kas Umum
            </button>
            <button
              onClick={() => setActiveTab('peserta')}
              className={`flex-1 py-4 text-sm font-semibold transition-all duration-200 cursor-pointer flex items-center justify-center gap-2 ${activeTab === 'peserta'
                ? 'text-red-800 [.dark_&]:text-amber-400 dark:text-amber-400'
                : 'text-stone-500 hover:text-stone-800 [.dark_&]:text-stone-400 dark:text-stone-400 [.dark_&]:hover:text-stone-200 dark:hover:text-stone-200'
                }`}
            >
              <Users className="w-4 h-4" />
              Status Pembayaran
            </button>
          </div>
          {/* Animated Slider Line */}
          <div
            className="absolute bottom-0 h-0.5 bg-red-800 [.dark_&]:bg-amber-400 dark:bg-amber-400 transition-transform duration-300 ease-out w-1/2"
            style={{ transform: activeTab === 'transaksi' ? 'translateX(0%)' : 'translateX(100%)' }}
          />
        </div>

        <div className="p-6">
          {activeTab === 'transaksi' && (
            <div className="space-y-4 animate-tab-enter">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                <h3 className="font-display text-lg font-semibold text-stone-900 [.dark_&]:text-white dark:text-white">Riwayat Transaksi</h3>
                <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-start md:justify-end">

                  {/* 1. Tombol Tambah Transaksi */}
                  {isAdmin && (
                    <button
                      onClick={handleOpenAdd}
                      className="relative overflow-hidden flex-1 sm:flex-initial sm:w-auto px-3.5 sm:px-5 py-2.5 rounded-xl bg-red-800 hover:bg-red-700 text-white font-bold text-xs sm:text-sm shadow-sm active:scale-95 flex items-center justify-center gap-1.5 sm:gap-2 cursor-pointer shrink-0 transition-colors"
                    >
                      <Plus className="w-4 h-4 stroke-[2.5]" />
                      <span className="tracking-wide sm:hidden">Tambah</span>
                      <span className="tracking-wide hidden sm:inline">Tambah Transaksi</span>
                    </button>
                  )}

                  {/* 2. Tombol Verifikasi */}
                  {isAdmin && (
                    <button
                      onClick={handleOpenVerifikasiModal}
                      title="Verifikasi Pembayaran Uang Kas Anggota"
                      className="flex-1 sm:flex-initial sm:w-auto px-3.5 sm:px-5 py-2.5 rounded-xl bg-[#faf8f5] [.dark_&]:bg-stone-800 dark:bg-stone-800 border border-stone-300 [.dark_&]:border-stone-700 dark:border-stone-700 hover:border-red-300 [.dark_&]:hover:border-amber-500/40 dark:hover:border-amber-500/40 text-stone-800 [.dark_&]:text-stone-200 dark:text-stone-200 font-semibold text-xs sm:text-sm hover:bg-stone-100 [.dark_&]:hover:bg-stone-700 dark:hover:bg-stone-700 active:scale-95 flex items-center justify-center gap-1.5 sm:gap-2 cursor-pointer shrink-0 shadow-sm transition-colors"
                    >
                      <ShieldCheck className="w-4 h-4 text-red-800 [.dark_&]:text-amber-400 dark:text-amber-400" />
                      <span>Verifikasi</span>
                    </button>
                  )}

                  {/* 3. Tombol Rekap per Sekolah & WA */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsClosingRekapSekolah(false);
                      setIsRekapSekolahOpen(true);
                    }}
                    title="Rekap Tunggakan per Sekolah & Pengingat WA Koordinator"
                    className="flex-1 sm:flex-initial sm:w-auto px-3.5 sm:px-4 py-2.5 rounded-xl bg-[#faf8f5] [.dark_&]:bg-stone-800 dark:bg-stone-800 border border-stone-300 [.dark_&]:border-stone-700 dark:border-stone-700 hover:border-emerald-500/50 text-stone-800 [.dark_&]:text-stone-200 dark:text-stone-200 font-semibold text-xs sm:text-sm hover:bg-stone-100 [.dark_&]:hover:bg-stone-700 dark:hover:bg-stone-700 active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer shrink-0 shadow-sm transition-colors"
                  >
                    <School className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span>Rekap Sekolah</span>
                  </button>

                  {/* 4. Tombol LPJ Resmi PGRI */}
                  <button
                    type="button"
                    onClick={handleExportOfficialLPJ}
                    disabled={isExportingLpj}
                    title="Unduh Laporan Pertanggungjawaban (LPJ) Resmi PGRI per Pos Anggaran"
                    className={`flex-1 sm:flex-initial sm:w-auto px-3.5 sm:px-4 py-2.5 rounded-xl bg-[#faf8f5] [.dark_&]:bg-stone-800 dark:bg-stone-800 border border-stone-300 [.dark_&]:border-stone-700 dark:border-stone-700 hover:border-amber-500/50 text-stone-800 [.dark_&]:text-stone-200 dark:text-stone-200 font-semibold text-xs sm:text-sm hover:bg-stone-100 [.dark_&]:hover:bg-stone-700 dark:hover:bg-stone-700 active:scale-95 flex items-center justify-center gap-1.5 shrink-0 shadow-sm transition-colors ${
                      isExportingLpj ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'
                    }`}
                  >
                    {isExportingLpj ? (
                      <Loader2 className="w-4 h-4 animate-spin text-amber-700 dark:text-amber-400" />
                    ) : (
                      <FileSpreadsheet className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                    )}
                    <span>{isExportingLpj ? 'Menyiapkan PDF...' : 'Cetak LPJ'}</span>
                  </button>
                </div>
              </div>

              {/* Tabel Riwayat Transaksi */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse whitespace-nowrap">
                  <thead>
                    <tr className="border-b border-stone-200/80 [.dark_&]:border-stone-800 dark:border-stone-800 text-sm font-medium text-stone-500 [.dark_&]:text-stone-400 dark:text-stone-400">
                      <th className="pb-3 px-2 font-semibold text-center w-[5%]">No</th>
                      <th className="pb-3 px-3 font-semibold text-center w-[11%]">Tanggal</th>
                      <th className="pb-3 px-4 font-semibold text-left w-[24%]">Uraian</th>
                      <th className="pb-3 px-4 font-semibold text-center w-[17%]">Keterangan</th>
                      <th className="pb-3 px-4 font-semibold text-right w-[12%]">Pemasukan</th>
                      <th className="pb-3 px-4 font-semibold text-right w-[12%]">Pengeluaran</th>
                      <th className="pb-3 px-4 font-semibold text-right w-[11%]">Total</th>
                      {isAdmin && (
                        <th className="pb-3 px-2 font-semibold text-center w-[8%]">Aksi</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    {transactionsWithRunningBalance.length > 0 ? (
                      transactionsWithRunningBalance.map((tx, index) => (
                        <tr key={tx.id} className="border-b border-stone-100 [.dark_&]:border-stone-800/60 dark:border-stone-800/60 hover:bg-[#faf8f5] [.dark_&]:hover:bg-stone-800/60 dark:hover:bg-stone-800/60 transition-colors duration-150 group">
                          <td className="py-3.5 px-2 text-center font-bold text-stone-500 [.dark_&]:text-stone-400 dark:text-stone-400">
                            {index + 1}
                          </td>
                          <td className="py-3.5 px-3 text-center font-mono text-xs text-stone-600 [.dark_&]:text-stone-300 dark:text-stone-300">
                            {(() => {
                              const d = new Date(tx.date);
                              if (isNaN(d.getTime())) return '-';
                              const isDanaMasuk =
                                tx.id.startsWith('tx-kas-event-') ||
                                /^dana masuk pada bulan/i.test((tx.description || '').trim());
                              const day = isDanaMasuk ? '02' : String(d.getDate()).padStart(2, '0');
                              const month = String(d.getMonth() + 1).padStart(2, '0');
                              const year = d.getFullYear();
                              return `${day}/${month}/${year}`;
                            })()}
                          </td>
                          <td className="py-3.5 px-4 text-stone-800 [.dark_&]:text-stone-200 dark:text-stone-200 font-medium">
                            <span className="capitalize block truncate max-w-[260px]">{tx.description}</span>
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <div className="flex items-center justify-center gap-2">
                              {tx.category ? (
                                <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border shrink-0 ${getCategoryBadgeStyle(tx.category)}`}>
                                  {tx.category === 'Iuran Anggota' || tx.category === 'Kontribusi Anggota' ? 'Kontribusi' : tx.category}
                                </span>
                              ) : (
                                !tx.receiptImage && <span className="text-xs text-stone-400">-</span>
                              )}
                              {tx.receiptImage && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsClosingPreviewReceipt(false);
                                    setPreviewReceiptUrl(tx.receiptImage || null);
                                  }}
                                  className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-amber-500/15 text-amber-800 dark:text-amber-300 hover:bg-amber-500/25 hover:scale-105 active:scale-95 transition-all border border-amber-500/30 flex items-center gap-1 cursor-pointer shrink-0"
                                  title="Lihat Foto Bukti Kwitansi / Nota"
                                >
                                  <ImageIcon className="w-3 h-3" />
                                  <span>Nota</span>
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono text-emerald-600 [.dark_&]:text-emerald-400 dark:text-emerald-400 font-semibold">
                            {tx.type === 'Pemasukan' ? formatRupiah(tx.amount) : '-'}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono text-red-700 [.dark_&]:text-red-400 dark:text-red-400 font-semibold">
                            {tx.type === 'Pengeluaran' ? formatRupiah(tx.amount) : '-'}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-bold text-stone-900 [.dark_&]:text-white dark:text-white">
                            {formatRupiah(tx.runningBalance)}
                          </td>
                          {isAdmin && (
                            <td className="py-3.5 px-2 text-center">
                              {tx.id.startsWith('tx-kas-event-') ? (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-50 text-amber-800 dark:bg-stone-800 dark:text-amber-300 border border-amber-200/70 dark:border-stone-700 select-none">
                                  Otomatis
                                </span>
                              ) : (
                                <div className="flex items-center justify-center gap-1.5 opacity-90 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => handleOpenEdit(tx)}
                                    className="w-8 h-8 rounded-xl border border-stone-200 [.dark_&]:border-stone-700 dark:border-stone-700 bg-[#faf8f5] [.dark_&]:bg-stone-800/70 dark:bg-stone-800/70 text-red-800 [.dark_&]:text-amber-400 dark:text-amber-400 hover:bg-red-50 [.dark_&]:hover:bg-stone-700 dark:hover:bg-stone-700 active:scale-90 flex items-center justify-center transition-all duration-200 cursor-pointer"
                                    title="Edit Transaksi"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>

                                  <button
                                    onClick={() => handleDeleteClick(tx.id, tx.description)}
                                    className="w-8 h-8 rounded-xl border border-red-200 [.dark_&]:border-red-900/50 dark:border-red-900/50 bg-red-50/70 [.dark_&]:bg-red-950/30 dark:bg-red-950/30 text-red-700 [.dark_&]:text-red-400 dark:text-red-400 hover:bg-red-100 [.dark_&]:hover:bg-red-950/70 dark:hover:bg-red-950/70 active:scale-90 flex items-center justify-center transition-all duration-200 cursor-pointer"
                                    title="Hapus Transaksi"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}
                            </td>
                          )}
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={isAdmin ? 8 : 7} className="py-12 text-center">
                          <div className="flex flex-col items-center justify-center gap-2">
                            <div className="w-12 h-12 rounded-xl bg-stone-100 [.dark_&]:bg-stone-800 dark:bg-stone-800 flex items-center justify-center text-stone-400">
                              <Wallet className="w-6 h-6" />
                            </div>
                            <p className="font-display font-semibold text-stone-700 [.dark_&]:text-stone-300 dark:text-stone-300 text-sm">Belum Ada Transaksi</p>
                            <p className="text-xs text-stone-400 max-w-xs">Data riwayat transaksi buku kas umum akan muncul di sini.</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'peserta' && (
            <div className="space-y-6 animate-tab-enter">

              {/* Header Tab & Deretan Filter di Sebelah Kanan */}
              <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-lg font-semibold text-stone-900 [.dark_&]:text-white dark:text-white">Status Pembayaran Uang Kas</h3>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-amber-50 [.dark_&]:bg-amber-950/60 dark:bg-amber-950/60 text-amber-800 [.dark_&]:text-amber-300 dark:text-amber-300 border border-amber-200/80 [.dark_&]:border-amber-800/50 dark:border-amber-800/50">
                      <Calendar className="w-3 h-3" />
                      Mulai: {MONTH_OPTIONS.find(m => m.id === duesStartMonth)?.name || 'November'} {duesStartYear}
                    </span>
                  </div>
                  <p className="text-sm text-stone-500 [.dark_&]:text-stone-400 dark:text-stone-400 mt-1">
                    Riwayat dan status pembayaran (berlaku mulai {MONTH_OPTIONS.find(m => m.id === duesStartMonth)?.name || 'November'} {duesStartYear})
                  </p>
                </div>

                {/* Filter Controls di Sebelah Kanan + Tombol Unduh PDF */}
                <div className="flex flex-wrap items-center gap-2.5 w-full xl:w-auto">
                  {/* 4. Filter Tahun Pembayaran */}
                  <div className="flex-1 sm:flex-initial sm:w-32">
                    <select
                      value={filterYear}
                      onChange={(e) => {
                        const nextYear = e.target.value;
                        setFilterYear(nextYear);
                        if (filterMonth !== 'Semua' && !isPeriodActive(nextYear, filterMonth)) {
                          const firstValid = MONTH_OPTIONS.find(m => isPeriodActive(nextYear, m.id));
                          if (firstValid) setFilterMonth(firstValid.id);
                        }
                      }}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#faf8f5] [.dark_&]:bg-stone-800 dark:bg-stone-800 border border-stone-200 [.dark_&]:border-stone-700 dark:border-stone-700 text-stone-800 [.dark_&]:text-stone-100 dark:text-stone-100 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-red-800/20 focus:border-red-700 cursor-pointer truncate"
                    >
                      {YEAR_OPTIONS.map((yr) => (
                        <option key={yr} value={yr} className={isDark ? "bg-stone-800 text-stone-100" : "bg-white text-stone-800"}>
                          Tahun {yr}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 5. Filter Bulan Pembayaran */}
                  <div className="flex-1 sm:flex-initial sm:w-44">
                    <select
                      value={filterMonth}
                      onChange={(e) => setFilterMonth(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#faf8f5] [.dark_&]:bg-stone-800 dark:bg-stone-800 border border-stone-200 [.dark_&]:border-stone-700 dark:border-stone-700 text-stone-800 [.dark_&]:text-stone-100 dark:text-stone-100 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-red-800/20 focus:border-red-700 cursor-pointer truncate"
                    >
                      <option value="Semua" className={isDark ? "bg-stone-800 text-stone-100" : "bg-white text-stone-800"}>Semua Bulan Aktif</option>
                      {MONTH_OPTIONS.filter(m => isPeriodActive(filterYear, m.id)).map((m) => (
                        <option key={m.id} value={m.id} className={isDark ? "bg-stone-800 text-stone-100" : "bg-white text-stone-800"}>
                          Bulan {m.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Filter Nama Sekolah */}
                  <div className="w-full sm:flex-initial sm:w-48">
                    <select
                      value={filterSchool}
                      onChange={(e) => setFilterSchool(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#faf8f5] [.dark_&]:bg-stone-800 dark:bg-stone-800 border border-stone-200 [.dark_&]:border-stone-700 dark:border-stone-700 text-stone-800 [.dark_&]:text-stone-100 dark:text-stone-100 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-red-800/20 focus:border-red-700 cursor-pointer truncate"
                    >
                      <option value="Semua" className={isDark ? "bg-stone-800 text-stone-100" : "bg-white text-stone-800"}>Semua Sekolah</option>
                      {schoolOptions.map((sch) => (
                        <option key={sch} value={sch} className={isDark ? "bg-stone-800 text-stone-100" : "bg-white text-stone-800"}>
                          {sch}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 5. Tombol Unduh PDF */}
                  <button
                    type="button"
                    onClick={handleDownloadDaftarPembayaranPDF}
                    disabled={isDownloadingKasPdf}
                    title="Unduh Daftar Pembayaran (PDF)"
                    className={`flex-1 sm:flex-initial sm:w-auto px-4 py-2.5 rounded-xl bg-red-800 hover:bg-red-700 text-white font-bold text-xs shadow-sm active:scale-95 flex items-center justify-center gap-2 transition-colors shrink-0 ${
                      isDownloadingKasPdf ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'
                    }`}
                  >
                    {isDownloadingKasPdf ? (
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                    ) : (
                      <Download className="w-4 h-4 text-white" />
                    )}
                    <span>{isDownloadingKasPdf ? 'Menyiapkan PDF...' : 'Unduh PDF'}</span>
                  </button>

                </div>
              </div>

              {/* Grid / List Kotak Status Pembayaran Berdasarkan Kegiatan */}
              {groupedPaymentItems.length === 0 ? (
                <div className="py-16 text-center flex flex-col items-center justify-center gap-2">
                  <div className="w-12 h-12 rounded-xl bg-stone-100 [.dark_&]:bg-stone-800 dark:bg-stone-800 flex items-center justify-center text-stone-400">
                    <Users className="w-6 h-6" />
                  </div>
                  <p className="font-display font-semibold text-stone-700 [.dark_&]:text-stone-300 dark:text-stone-300 text-sm">Tidak Ada Data Pembayaran</p>
                  <p className="text-xs text-stone-400 max-w-xs">Tidak ditemukan data anggota yang sesuai dengan kriteria filter.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {groupedPaymentItems.map((group) => {
                    const currentMonthIdItem = group.month.id;
                    const currentYearItem = group.year;

                    // Menghitung status pembayaran sama persis dengan modal verifikasi (berdasarkan seluruh anggota)
                    const groupLunasCount = sortedTeachers.filter(teacher => {
                      const p = getPayment(teacher.id, currentMonthIdItem, teacher.name, currentYearItem);
                      return p?.status === 'Lunas';
                    }).length;
                    const groupBelumCount = sortedTeachers.length - groupLunasCount;
                    const groupPct = sortedTeachers.length > 0 ? Math.round((groupLunasCount / sortedTeachers.length) * 100) : 0;

                    return (
                      <div
                        key={`group-month-${currentYearItem}-${currentMonthIdItem}`}
                        className="p-5 sm:p-6 rounded-2xl bg-[#faf8f5] [.dark_&]:bg-stone-800/40 dark:bg-stone-800/40 border border-stone-200/80 [.dark_&]:border-stone-800 dark:border-stone-800 space-y-4"
                      >
                        {/* Header Kotak Pembungkus Bulan & Tahun */}
                        <div className="space-y-3 border-b border-stone-200/80 [.dark_&]:border-stone-700/60 dark:border-stone-700/60 pb-3.5">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-xl bg-red-50 [.dark_&]:bg-red-950/70 dark:bg-red-950/70 border border-red-200 [.dark_&]:border-red-800/60 dark:border-red-800/60 text-red-800 [.dark_&]:text-amber-400 dark:text-amber-400 flex items-center justify-center shrink-0">
                                <Calendar className="w-4 h-4" />
                              </div>
                              <div>
                                <h4 className="font-display text-base font-bold text-stone-900 [.dark_&]:text-white dark:text-white">
                                  Kontribusi Kas Bulan {group.month.name} {currentYearItem}
                                </h4>
                                <p className="text-xs text-stone-500 [.dark_&]:text-stone-400 dark:text-stone-400 font-medium">
                                  Rekapitulasi Pembayaran Bulan {group.month.name} Tahun {currentYearItem}
                                </p>
                              </div>
                            </div>

                            {/* Badges Jumlah Pengurus, Anggota, Sudah Bayar, dan Belum Bayar */}
                            <div className="grid grid-cols-2 sm:flex sm:items-center gap-1.5 w-full sm:w-auto">
                              <span className="text-xs font-bold px-3 py-1 rounded-lg bg-amber-100/80 [.dark_&]:bg-amber-950/60 dark:bg-amber-950/60 text-amber-800 [.dark_&]:text-amber-300 dark:text-amber-300 border border-amber-200/70 [.dark_&]:border-amber-800/40 dark:border-amber-800/40 text-center flex items-center justify-center">
                                Pengurus ({pengurusTeachers.length})
                              </span>
                              <span className="text-xs font-bold px-3 py-1 rounded-lg bg-stone-200/70 [.dark_&]:bg-stone-800 dark:bg-stone-800 text-stone-700 [.dark_&]:text-stone-300 dark:text-stone-300 border border-stone-300/60 [.dark_&]:border-stone-700 dark:border-stone-700 text-center flex items-center justify-center">
                                Anggota ({sortedTeachers.length})
                              </span>
                              <span className="text-xs font-bold px-3 py-1 rounded-lg bg-emerald-100/70 [.dark_&]:bg-emerald-950/70 dark:bg-emerald-950/70 text-emerald-700 [.dark_&]:text-emerald-300 dark:text-emerald-300 border border-emerald-200/50 [.dark_&]:border-emerald-800/40 dark:border-emerald-800/40 text-center flex items-center justify-center">
                                Sudah Bayar ({groupLunasCount})
                              </span>
                              <span className="text-xs font-bold px-3 py-1 rounded-lg bg-red-100/70 [.dark_&]:bg-red-950/70 dark:bg-red-950/70 text-red-700 [.dark_&]:text-red-300 dark:text-red-300 border border-red-200/50 [.dark_&]:border-red-800/40 dark:border-red-800/40 text-center flex items-center justify-center">
                                Belum Bayar ({groupBelumCount})
                              </span>
                            </div>
                          </div>

                          {/* Batang Progres Pelunasan Bulan */}
                          <div className="flex items-center gap-2.5">
                            <div className="flex-1 h-1.5 rounded-full bg-stone-200/90 [.dark_&]:bg-stone-700/70 dark:bg-stone-700/70 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600 transition-all duration-500 ease-out"
                                style={{ width: `${groupPct}%` }}
                              />
                            </div>
                            <span className="text-[11px] font-mono font-bold text-stone-600 [.dark_&]:text-stone-300 dark:text-stone-300 shrink-0">
                              {groupPct}% Lunas
                            </span>
                          </div>
                        </div>

                        {/* Grid Kartu Data Anggota di Dalam Bulan */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {group.items.map(({ teacher, month, year }) => {
                            const payment = getPayment(teacher.id, month.id, teacher.name, year);
                            const isLunas = payment?.status === 'Lunas';
                            const gender = getGender(teacher);

                            return (
                              <div
                                key={`${teacher.id}-${year}-${month.id}`}
                                className={`p-4 rounded-xl border transition-all duration-300 flex items-center justify-between gap-3 hover:-translate-y-0.5 hover:shadow-sm ${isLunas
                                  ? 'bg-emerald-50/50 border-emerald-200/70 [.dark_&]:bg-emerald-950/25 dark:bg-emerald-950/25 [.dark_&]:border-emerald-800/50 dark:border-emerald-800/50 shadow-xs'
                                  : 'bg-white [.dark_&]:bg-stone-900 dark:bg-stone-900 border-stone-200/80 [.dark_&]:border-stone-800 dark:border-stone-800 hover:border-red-300 [.dark_&]:hover:border-red-900/60 dark:hover:border-red-900/60'
                                  }`}
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border transition-colors ${gender === 'L'
                                    ? 'bg-red-50 [.dark_&]:bg-red-950/60 dark:bg-red-950/60 text-red-800 [.dark_&]:text-red-300 dark:text-red-300 border-red-200/80 [.dark_&]:border-red-800/50 dark:border-red-800/50'
                                    : 'bg-amber-50 [.dark_&]:bg-amber-950/60 dark:bg-amber-950/60 text-amber-800 [.dark_&]:text-amber-300 dark:text-amber-300 border-amber-200/80 [.dark_&]:border-amber-800/50 dark:border-amber-800/50'
                                    }`}>
                                    <User className="w-5 h-5" />
                                  </div>

                                  <div className="min-w-0">
                                    <p className="font-display text-sm font-semibold text-stone-900 [.dark_&]:text-stone-100 dark:text-stone-100 truncate">
                                      {teacher.name}
                                    </p>
                                    <p className="text-xs text-stone-500 [.dark_&]:text-stone-400 dark:text-stone-400 truncate">
                                      {teacher.school}
                                    </p>
                                  </div>
                                </div>

                                {/* Badge + Icon Indikator Status + Tombol Kuitansi */}
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {isLunas && payment && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsClosingReceiptPreview(false);
                                        setReceiptPreviewTarget({ teacher, month, year, payment });
                                      }}
                                      title="Lihat & Unduh Kuitansi Digital"
                                      className="w-8 h-8 flex items-center justify-center rounded-xl bg-amber-100/80 hover:bg-amber-200/80 text-amber-800 [.dark_&]:bg-amber-500/20 dark:bg-amber-500/20 [.dark_&]:hover:bg-amber-500/30 dark:hover:bg-amber-500/30 [.dark_&]:text-amber-300 dark:text-amber-300 border border-amber-200/70 [.dark_&]:border-amber-700/40 dark:border-amber-700/40 transition-all cursor-pointer active:scale-95"
                                    >
                                      <Receipt className="w-4 h-4" />
                                    </button>
                                  )}

                                  <span className={`hidden sm:inline-block text-[10px] font-bold px-2 py-0.5 rounded-md transition-colors duration-300 ${isLunas
                                    ? 'bg-emerald-100/70 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300'
                                    : 'bg-red-100/70 text-red-700 dark:bg-red-950/70 dark:text-red-300'
                                    }`}>
                                    {isLunas ? 'Lunas' : 'Belum'}
                                  </span>

                                  <div
                                    className={`w-8 h-8 flex items-center justify-center rounded-xl transition-all duration-300 ${isLunas
                                      ? 'bg-emerald-100 text-emerald-700 [.dark_&]:bg-emerald-500/20 dark:bg-emerald-500/20 [.dark_&]:text-emerald-400 dark:text-emerald-400 scale-100'
                                      : 'bg-red-100 text-red-700 [.dark_&]:bg-red-950/70 dark:bg-red-950/70 [.dark_&]:text-red-400 dark:text-red-400'
                                      }`}
                                    title={isLunas ? 'Sudah Bayar' : 'Belum Bayar'}
                                  >
                                    {isLunas ? (
                                      <CheckCircle className="w-4 h-4 transition-transform duration-300 scale-105" />
                                    ) : (
                                      <X className="w-4 h-4 stroke-[2.5]" />
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* POPUP MODAL: PRATINJAU & DOWNLOAD QRIS PEMBAYARAN */}
      {isQrisModalOpen && (
        <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm ${isClosingQrisModal ? 'modal-backdrop-exit' : 'animate-backdrop-fade'}`}>
          <div className={`bg-white [.dark_&]:bg-stone-900 dark:bg-stone-900 rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-stone-200/90 [.dark_&]:border-stone-800 dark:border-stone-800 space-y-4 ${isClosingQrisModal ? 'modal-content-exit' : 'animate-modal-pop'}`}>
            <div className="flex items-center justify-between border-b border-stone-200/80 [.dark_&]:border-stone-800 dark:border-stone-800 pb-3">
              <div className="flex items-center gap-2.5 text-red-800 [.dark_&]:text-amber-400 dark:text-amber-400">
                <div className="w-9 h-9 rounded-xl bg-red-50 [.dark_&]:bg-red-950/70 dark:bg-red-950/70 border border-red-200 [.dark_&]:border-red-800/60 dark:border-red-800/60 flex items-center justify-center">
                  <QrCode className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-base text-stone-900 [.dark_&]:text-white dark:text-white">
                    QRIS Pembayaran Kas
                  </h3>
                  <p className="text-xs text-stone-500 [.dark_&]:text-stone-400 dark:text-stone-400">
                    {orgConfig.bankName} : {orgConfig.bankAccountNumber}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseQrisModal}
                className="p-1.5 rounded-xl hover:bg-stone-100 [.dark_&]:hover:bg-stone-800 dark:hover:bg-stone-800 text-stone-400 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Kartu Pratinjau QRIS */}
            <div className="p-4 rounded-2xl bg-[#faf8f5] [.dark_&]:bg-stone-800/70 dark:bg-stone-800/70 border border-stone-200/80 [.dark_&]:border-stone-700/70 dark:border-stone-700/70 flex flex-col items-center text-center space-y-3">
              <div className="space-y-0.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-stone-500 [.dark_&]:text-stone-400 dark:text-stone-400">
                  a.n. {orgConfig.bankAccountHolder}
                </p>
                <p className="font-mono font-bold text-xs sm:text-sm text-red-800 [.dark_&]:text-amber-300 dark:text-amber-300">
                  {orgConfig.bankName} • {orgConfig.bankAccountNumber}
                </p>
              </div>

              <div className="p-3 bg-white rounded-2xl border border-stone-200 shadow-xs">
                <img
                  src={qrisImageSrc}
                  alt={`QRIS ${orgConfig.bankName} ${orgConfig.bankAccountNumber}`}
                  className="w-56 h-56 sm:w-60 sm:h-60 object-contain rounded-lg"
                />
              </div>

              {isOfficialQris ? (
                <p className="text-[11px] text-stone-500 [.dark_&]:text-stone-400 dark:text-stone-400 leading-relaxed">
                  Scan kode QRIS resmi di atas menggunakan aplikasi Mobile Banking atau E-Wallet, atau unduh gambar PNG untuk disimpan di galeri.
                </p>
              ) : (
                <div className="w-full p-2.5 rounded-xl bg-amber-50 [.dark_&]:bg-amber-950/40 dark:bg-amber-950/40 border border-amber-200/80 [.dark_&]:border-amber-800/50 dark:border-amber-800/50 text-left space-y-1">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-amber-800 [.dark_&]:text-amber-300 dark:text-amber-300">
                    QR Info Rekening (QRIS Resmi Belum Diunggah)
                  </p>
                  <p className="text-[11px] text-amber-900/80 [.dark_&]:text-amber-200/80 dark:text-amber-200/80 leading-relaxed">
                    Kode QR ini berisi informasi nomor rekening. Pengurus dapat mengunggah gambar QRIS resmi bank melalui menu <strong>Pengaturan → Organisasi</strong> agar bisa dipindai langsung untuk transaksi.
                  </p>
                </div>
              )}

              {qrisDownloadError && (
                <div className="w-full p-2.5 rounded-xl bg-red-50 [.dark_&]:bg-red-950/50 dark:bg-red-950/50 border border-red-200 [.dark_&]:border-red-800/60 dark:border-red-800/60 text-red-700 [.dark_&]:text-red-300 dark:text-red-300 text-[11px] font-semibold">
                  {qrisDownloadError}
                </div>
              )}
            </div>

            {/* Tombol Download PNG & Batal */}
            <div className="pt-2 border-t border-stone-200/80 [.dark_&]:border-stone-800 dark:border-stone-800 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={handleCloseQrisModal}
                className="px-5 py-2.5 rounded-xl bg-stone-100 [.dark_&]:bg-stone-800 dark:bg-stone-800 text-stone-700 [.dark_&]:text-stone-300 dark:text-stone-300 border border-stone-200 [.dark_&]:border-stone-700 dark:border-stone-700 font-bold text-xs uppercase tracking-wider hover:bg-stone-200 [.dark_&]:hover:bg-stone-700 dark:hover:bg-stone-700 transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isDownloadingQris}
                onClick={handleDownloadQrisPng}
                className="px-6 py-2.5 rounded-xl bg-red-800 hover:bg-red-700 disabled:opacity-60 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-2 shadow-sm transition-all active:scale-95 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>{isDownloadingQris ? 'Mengunduh...' : 'Download'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* POPUP MODAL: KONFIRMASI TRANSFER KONTRIBUSI KAS KE WHATSAPP */}
      {isConfirmTransferModalOpen && (
        <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm ${isClosingConfirmTransferModal ? 'modal-backdrop-exit' : 'animate-backdrop-fade'}`}>
          <div className={`bg-white [.dark_&]:bg-stone-900 dark:bg-stone-900 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-stone-200/90 [.dark_&]:border-stone-800 dark:border-stone-800 space-y-4 ${isClosingConfirmTransferModal ? 'modal-content-exit' : 'animate-modal-pop'}`}>
            <div className="flex items-center justify-between border-b border-stone-200/80 [.dark_&]:border-stone-800 dark:border-stone-800 pb-3">
              <div className="flex items-center gap-2.5 text-red-800 [.dark_&]:text-amber-400 dark:text-amber-400">
                <div className="w-9 h-9 rounded-xl bg-red-50 [.dark_&]:bg-red-950/70 dark:bg-red-950/70 border border-red-200 [.dark_&]:border-red-800/60 dark:border-red-800/60 flex items-center justify-center">
                  <CreditCard className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-base text-stone-900 [.dark_&]:text-white dark:text-white">
                    Konfirmasi Transfer Kontribusi Kas
                  </h3>
                  <p className="text-xs text-stone-500 [.dark_&]:text-stone-400 dark:text-stone-400">
                    {orgConfig.bankName} : {orgConfig.bankAccountNumber} ({orgConfig.bankAccountHolder})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseConfirmTransferModal}
                className="p-1.5 rounded-xl hover:bg-stone-100 [.dark_&]:hover:bg-stone-800 dark:hover:bg-stone-800 text-stone-400 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs sm:text-sm">
              {/* Dropdown Pilih Nama Guru */}
              <div>
                <label className="block font-bold text-stone-700 [.dark_&]:text-stone-300 dark:text-stone-300 mb-1">
                  Pilih Nama Lengkap *
                </label>
                <select
                  value={selectedConfirmTeacher?.id || ''}
                  onChange={(e) => setSelectedConfirmTeacherId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#faf8f5] [.dark_&]:bg-stone-800 dark:bg-stone-800 border border-stone-200 [.dark_&]:border-stone-700 dark:border-stone-700 text-stone-800 [.dark_&]:text-stone-100 dark:text-stone-100 font-semibold focus:outline-none focus:ring-2 focus:ring-red-800/20 focus:border-red-700 cursor-pointer"
                >
                  {sortedTeachers.map((t) => (
                    <option key={t.id} value={t.id} className={isDark ? "bg-stone-800 text-stone-100" : "bg-white text-stone-800"}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* NIP (Otomatis & Readonly) */}
              <div>
                <label className="block font-bold text-stone-700 [.dark_&]:text-stone-300 dark:text-stone-300 mb-1">
                  NIP
                </label>
                <input
                  type="text"
                  readOnly
                  disabled
                  value={(selectedConfirmTeacher as any)?.nip || '-'}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-stone-100/80 [.dark_&]:bg-stone-800/50 dark:bg-stone-800/50 border border-stone-200 [.dark_&]:border-stone-700/60 dark:border-stone-700/60 text-stone-600 [.dark_&]:text-stone-400 dark:text-stone-400 font-mono font-medium cursor-not-allowed select-none"
                />
              </div>

              {/* Jenis Kelamin & Nama Sekolah (Otomatis & Readonly) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-stone-700 [.dark_&]:text-stone-300 dark:text-stone-300 mb-1">
                    Jenis Kelamin
                  </label>
                  <input
                    type="text"
                    readOnly
                    disabled
                    value={selectedConfirmTeacher ? (getGender(selectedConfirmTeacher) === 'L' ? 'Laki-laki' : 'Perempuan') : '-'}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-stone-100/80 [.dark_&]:bg-stone-800/50 dark:bg-stone-800/50 border border-stone-200 [.dark_&]:border-stone-700/60 dark:border-stone-700/60 text-stone-600 [.dark_&]:text-stone-400 dark:text-stone-400 font-medium cursor-not-allowed select-none"
                  />
                </div>

                <div>
                  <label className="block font-bold text-stone-700 [.dark_&]:text-stone-300 dark:text-stone-300 mb-1">
                    Nama Sekolah
                  </label>
                  <input
                    type="text"
                    readOnly
                    disabled
                    value={selectedConfirmTeacher?.school || '-'}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-stone-100/80 [.dark_&]:bg-stone-800/50 dark:bg-stone-800/50 border border-stone-200 [.dark_&]:border-stone-700/60 dark:border-stone-700/60 text-stone-600 [.dark_&]:text-stone-400 dark:text-stone-400 font-medium cursor-not-allowed select-none truncate"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-stone-200/80 [.dark_&]:border-stone-800 dark:border-stone-800 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={handleCloseConfirmTransferModal}
                  className="px-5 py-2.5 rounded-xl bg-stone-100 [.dark_&]:bg-stone-800 dark:bg-stone-800 text-stone-700 [.dark_&]:text-stone-300 dark:text-stone-300 border border-stone-200 [.dark_&]:border-stone-700 dark:border-stone-700 font-bold text-xs uppercase tracking-wider hover:bg-stone-200 [.dark_&]:hover:bg-stone-700 dark:hover:bg-stone-700 transition-colors cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleSendWhatsAppConfirmation}
                  className="px-6 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-2 shadow-sm transition-all active:scale-95 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  Kirim Konfirmasi
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* POPUP MODAL: VERIFIKASI PEMBAYARAN KAS (Hanya Admin) */}
      {isVerifikasiModalOpen && (
        <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm ${isClosingVerifikasiModal ? 'modal-backdrop-exit' : 'animate-backdrop-fade'}`}>
          <div className={`bg-white [.dark_&]:bg-stone-900 dark:bg-stone-900 rounded-2xl max-w-2xl w-full h-[640px] max-h-[90vh] flex flex-col p-6 shadow-2xl border border-stone-200/90 [.dark_&]:border-stone-800 dark:border-stone-800 space-y-4 ${isClosingVerifikasiModal ? 'modal-content-exit' : 'animate-modal-pop'}`}>
            <div className="flex items-center justify-between border-b border-stone-200/80 [.dark_&]:border-stone-800 dark:border-stone-800 pb-3 shrink-0">
              <div className="flex items-center gap-2.5 text-red-800 [.dark_&]:text-amber-400 dark:text-amber-400">
                <div className="w-9 h-9 rounded-xl bg-red-50 [.dark_&]:bg-red-950/70 dark:bg-red-950/70 border border-red-200 [.dark_&]:border-red-800/60 dark:border-red-800/60 flex items-center justify-center font-bold">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-base text-stone-900 [.dark_&]:text-stone-100 dark:text-stone-100">
                    Verifikasi Pembayaran Uang Kas
                  </h3>
                  <p className="text-xs text-stone-500 [.dark_&]:text-stone-400 dark:text-stone-400">
                    Geser status tombol Bayar / Belum untuk setiap anggota
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseVerifikasiModal}
                className="p-1.5 rounded-xl hover:bg-stone-100 [.dark_&]:hover:bg-stone-800 dark:hover:bg-stone-800 text-stone-400 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Dropdown Filter Pilih Bulan & Tahun Pembayaran */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-stone-700 [.dark_&]:text-stone-300 dark:text-stone-300 mb-1.5 text-center">
                  Pilih Tahun
                </label>
                <select
                  value={selectedVerifikasiYear}
                  onChange={(e) => {
                    const nextYear = e.target.value;
                    setSelectedVerifikasiYear(nextYear);
                    if (!isPeriodActive(nextYear, selectedVerifikasiMonth)) {
                      const firstValid = MONTH_OPTIONS.find(m => isPeriodActive(nextYear, m.id));
                      if (firstValid) setSelectedVerifikasiMonth(firstValid.id);
                    }
                  }}
                  style={{ textAlignLast: 'center' }}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#faf8f5] [.dark_&]:bg-stone-800 dark:bg-stone-800 border border-stone-200 [.dark_&]:border-stone-700 dark:border-stone-700 text-stone-800 [.dark_&]:text-stone-100 dark:text-stone-100 font-bold text-xs text-center focus:outline-none focus:ring-2 focus:ring-red-800/20 focus:border-red-700 cursor-pointer"
                >
                  {YEAR_OPTIONS.map((yr) => (
                    <option key={yr} value={yr} className={`text-center ${isDark ? "bg-stone-800 text-stone-100" : "bg-white text-stone-800"}`}>
                      Tahun {yr}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-stone-700 [.dark_&]:text-stone-300 dark:text-stone-300 mb-1.5 text-center">
                  Pilih Bulan Pembayaran
                </label>
                <select
                  value={selectedVerifikasiMonth}
                  onChange={(e) => setSelectedVerifikasiMonth(e.target.value)}
                  style={{ textAlignLast: 'center' }}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#faf8f5] [.dark_&]:bg-stone-800 dark:bg-stone-800 border border-stone-200 [.dark_&]:border-stone-700 dark:border-stone-700 text-stone-800 [.dark_&]:text-stone-100 dark:text-stone-100 font-bold text-xs text-center focus:outline-none focus:ring-2 focus:ring-red-800/20 focus:border-red-700 cursor-pointer"
                >
                  {MONTH_OPTIONS.filter(m => isPeriodActive(selectedVerifikasiYear, m.id)).map((m) => (
                    <option key={m.id} value={m.id} className={`text-left ${isDark ? "bg-stone-800 text-stone-100" : "bg-white text-stone-800"}`}>
                      Bulan {m.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {verifikasiToast && (
              <div className="py-2 px-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold text-center flex items-center justify-center gap-1.5 animate-fadeIn">
                <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{verifikasiToast}</span>
              </div>
            )}

            {/* Baris Filter Kategori (Semua / Pengurus / Anggota) + Tombol Pilih Pengurus dari ProfilKBView */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="inline-flex rounded-xl p-1 bg-stone-100 [.dark_&]:bg-stone-800/80 dark:bg-stone-800/80 border border-stone-200/70 [.dark_&]:border-stone-700/70 dark:border-stone-700/70 gap-1">
                {(['Semua', 'Pengurus', 'Anggota'] as const).map((roleCat) => (
                  <button
                    key={roleCat}
                    type="button"
                    onClick={() => setVerifikasiRoleFilter(roleCat)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                      verifikasiRoleFilter === roleCat
                        ? 'bg-red-800 text-white shadow-xs'
                        : 'text-stone-500 hover:text-stone-800 [.dark_&]:text-stone-400 [.dark_&]:hover:text-stone-200'
                    }`}
                  >
                    {roleCat}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setIsSelectingPengurus(prev => !prev)}
                className={`px-3 py-1.5 rounded-xl border text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  isSelectingPengurus
                    ? 'bg-amber-700 border-amber-700 text-white shadow-xs'
                    : 'bg-amber-50/80 [.dark_&]:bg-amber-950/50 dark:bg-amber-950/50 border-amber-200 [.dark_&]:border-amber-800/60 dark:border-amber-800/60 text-amber-800 [.dark_&]:text-amber-300 dark:text-amber-300 hover:bg-amber-100 [.dark_&]:hover:bg-amber-900/50'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Pilih Data Pengurus ({pengurusTeachers.length}/{allProfilCandidates.length})</span>
              </button>
            </div>

            {/* Panel Seleksi Pengurus dari ProfilKBView (Collapsible) */}
            {isSelectingPengurus && (
              <div className="p-3.5 rounded-2xl bg-amber-50/60 [.dark_&]:bg-amber-950/25 dark:bg-amber-950/25 border border-amber-200/80 [.dark_&]:border-amber-800/50 dark:border-amber-800/50 space-y-2.5 animate-panel-in">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] font-bold text-amber-900 [.dark_&]:text-amber-300 dark:text-amber-300 flex items-center gap-1.5">
                    <UserCheck className="w-3.5 h-3.5" />
                    Centang Pengurus (dari Profil Kepengurusan PGRI) yang Wajib Kontribusi:
                  </p>
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        const allNames = allProfilCandidates.map(c => c.name.trim().toLowerCase());
                        setSelectedPengurusNames(allNames);
                        persistSelectedPengurusNames(allNames);
                      }}
                      className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                    >
                      Pilih Semua
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPengurusNames([]);
                        persistSelectedPengurusNames([]);
                      }}
                      className="text-[11px] font-bold text-red-600 dark:text-red-400 hover:underline cursor-pointer"
                    >
                      Kosongkan
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsSelectingPengurus(false)}
                      className="text-[11px] font-bold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                    >
                      Tutup
                    </button>
                  </div>
                </div>
                <div className="max-h-40 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5 pr-1">
                  {allProfilCandidates.map((cand) => {
                    const checked = selectedPengurusNames.includes(cand.name.trim().toLowerCase());
                    return (
                      <label
                        key={cand.id}
                        className={`flex items-start gap-2 p-2 rounded-xl border text-left cursor-pointer transition-colors ${
                          checked
                            ? 'bg-white [.dark_&]:bg-stone-900 dark:bg-stone-900 border-amber-300 [.dark_&]:border-amber-700/70 dark:border-amber-700/70'
                            : 'bg-white/60 [.dark_&]:bg-stone-900/40 dark:bg-stone-900/40 border-stone-200/70 [.dark_&]:border-stone-800 dark:border-stone-800 opacity-75'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleToggleSelectedPengurus(cand.name)}
                          className="mt-0.5 accent-red-800 dark:accent-amber-500 rounded cursor-pointer"
                        />
                        <div className="min-w-0 leading-tight">
                          <p className="text-[11px] font-bold text-stone-800 [.dark_&]:text-stone-100 dark:text-stone-100 truncate">
                            {cand.name}
                          </p>
                          <p className="text-[10px] text-amber-700 [.dark_&]:text-amber-400 dark:text-amber-400 font-semibold truncate">
                            {cand.jabatanPengurus} • {cand.school}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Segmented Filter (Sudah Bayar & Belum Bayar dengan slider smooth) */}
            <div className="relative grid grid-cols-2 gap-2 bg-stone-100 [.dark_&]:bg-stone-800/80 dark:bg-stone-800/80 border border-stone-200/70 [.dark_&]:border-stone-700/60 dark:border-stone-700/60 p-1.5 rounded-2xl">
              <button
                type="button"
                onClick={() => setVerifikasiFilter('Lunas')}
                className={`relative z-10 py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer ${verifikasiFilter === 'Lunas'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-stone-500 hover:text-stone-800 [.dark_&]:text-stone-400 [.dark_&]:hover:text-stone-200'
                  }`}
              >
                <CheckCircle className="w-3.5 h-3.5" />
                <span>Sudah Bayar ({lunasTeachersList.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setVerifikasiFilter('Belum Bayar')}
                className={`relative z-10 py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer ${verifikasiFilter === 'Belum Bayar'
                  ? 'bg-red-800 text-white shadow-sm'
                  : 'text-stone-500 hover:text-stone-800 [.dark_&]:text-stone-400 [.dark_&]:hover:text-stone-200'
                  }`}
              >
                <UserX className="w-3.5 h-3.5" />
                <span>Belum Bayar ({belumBayarTeachersList.length})</span>
              </button>
            </div>

            {/* List Anggota Terverifikasi */}
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-1 dark:[color-scheme:dark] [.dark_&]:[color-scheme:dark]">
              {filteredVerifikasiTeachers.length === 0 ? (
                <div className="h-full py-12 text-center flex flex-col items-center justify-center gap-2">
                  <div className="w-10 h-10 rounded-xl bg-stone-100 [.dark_&]:bg-stone-800 dark:bg-stone-800 flex items-center justify-center text-stone-400 animate-pulse">
                    <Users className="w-5 h-5" />
                  </div>
                  <p className="text-xs sm:text-sm text-stone-400 font-medium">
                    {verifikasiFilter === 'Belum Bayar'
                      ? 'Semua anggota pada kategori ini telah melunasi pembayaran kas!'
                      : 'Belum ada anggota pada kategori ini yang melunasi pembayaran kas.'}
                  </p>
                </div>
              ) : (
                filteredVerifikasiTeachers.map((teacher, idx) => {
                  const payment = getPayment(teacher.id, selectedVerifikasiMonth, teacher.name, selectedVerifikasiYear);
                  const isLunas = payment?.status === 'Lunas';
                  const gender = getGender(teacher);
                  const jabatan = (teacher as any).jabatanPengurus;

                  return (
                    <div
                      key={teacher.id}
                      className="p-3 sm:p-3.5 rounded-2xl bg-[#faf8f5] [.dark_&]:bg-stone-800/80 dark:bg-stone-800/80 border border-stone-200/80 [.dark_&]:border-stone-700/70 dark:border-stone-700/70 flex items-center justify-between gap-3 hover:border-red-300/70 [.dark_&]:hover:border-amber-700/50 transition-all duration-200"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${gender === 'L'
                          ? 'bg-stone-100 [.dark_&]:bg-stone-900 dark:bg-stone-900 text-stone-700 [.dark_&]:text-stone-300 dark:text-stone-300 border-stone-200 [.dark_&]:border-stone-700 dark:border-stone-700'
                          : 'bg-red-50 [.dark_&]:bg-red-950/60 dark:bg-red-950/60 text-red-800 [.dark_&]:text-amber-400 dark:text-amber-400 border-red-200 [.dark_&]:border-red-800/60 dark:border-red-800/60'
                          }`}>
                          <User className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="font-display font-bold text-xs sm:text-sm text-stone-900 [.dark_&]:text-stone-100 dark:text-stone-100 truncate">
                              {idx + 1}. {teacher.name}
                            </p>
                            {jabatan && (
                              <span className="px-2 py-0.5 rounded-md text-[9px] font-extrabold bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/25 shrink-0">
                                {jabatan}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-stone-500 [.dark_&]:text-stone-400 dark:text-stone-400 truncate">
                            {teacher.school}
                          </p>
                        </div>
                      </div>

                      {/* 2 Tombol Slide */}
                      <div className="inline-flex rounded-xl p-1 bg-stone-200/80 [.dark_&]:bg-stone-900/90 dark:bg-stone-900/90 border border-stone-200 [.dark_&]:border-stone-700 dark:border-stone-700 gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSetPaymentStatus(teacher.id, 'Lunas', selectedVerifikasiMonth, teacher.name, selectedVerifikasiYear);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer whitespace-nowrap active:scale-95 ${isLunas
                            ? 'bg-emerald-600 text-white shadow-sm scale-100'
                            : 'text-stone-500 hover:text-stone-800 [.dark_&]:text-stone-400 [.dark_&]:hover:text-stone-200'
                            }`}
                        >
                          Bayar
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSetPaymentStatus(teacher.id, 'Belum Bayar', selectedVerifikasiMonth, teacher.name, selectedVerifikasiYear);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer whitespace-nowrap active:scale-95 ${!isLunas
                            ? 'bg-red-800 text-white shadow-sm scale-100'
                            : 'text-stone-500 hover:text-stone-800 [.dark_&]:text-stone-400 [.dark_&]:hover:text-stone-200'
                            }`}
                        >
                          Belum
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="pt-3 border-t border-stone-200/80 [.dark_&]:border-stone-800 dark:border-stone-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 shrink-0 mt-auto">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isBulkUpdatingVerifikasi || belumBayarTeachersList.length === 0}
                  onClick={() => handleBulkSetPaymentStatus('Lunas')}
                  className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all active:scale-95 cursor-pointer"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>
                    {verifikasiRoleFilter === 'Semua'
                      ? 'Semua Sudah Bayar'
                      : `Semua ${verifikasiRoleFilter} Bayar`}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={isBulkUpdatingVerifikasi || lunasTeachersList.length === 0}
                  onClick={() => handleBulkSetPaymentStatus('Belum Bayar')}
                  className="flex-1 sm:flex-initial px-3.5 py-2.5 rounded-xl bg-red-500/15 hover:bg-red-500/25 disabled:opacity-40 disabled:cursor-not-allowed text-red-700 [.dark_&]:text-red-400 dark:text-red-400 border border-red-500/30 font-bold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Reset Belum Bayar</span>
                </button>
              </div>

              <button
                type="button"
                onClick={handleCloseVerifikasiModal}
                className="px-6 py-2.5 rounded-xl bg-stone-100 [.dark_&]:bg-stone-800 dark:bg-stone-800 text-stone-800 [.dark_&]:text-stone-200 dark:text-stone-200 font-bold text-xs uppercase tracking-wider hover:bg-stone-200 [.dark_&]:hover:bg-stone-700 dark:hover:bg-stone-700 transition-colors cursor-pointer"
              >
                Selesai
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Form Tambah / Edit Transaksi */}
      {isModalOpen && (
        <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm ${isClosingModal ? 'modal-backdrop-exit' : 'animate-backdrop-fade'}`}>
          <div className={`bg-white [.dark_&]:bg-stone-900 dark:bg-stone-900 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-stone-200/90 [.dark_&]:border-stone-800 dark:border-stone-800 space-y-5 ${isClosingModal ? 'modal-content-exit' : 'animate-modal-pop'}`}>
            <div className="flex items-center justify-between border-b border-stone-200/80 [.dark_&]:border-stone-800 dark:border-stone-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-red-50 [.dark_&]:bg-red-950/70 dark:bg-red-950/70 border border-red-200 [.dark_&]:border-red-800/60 dark:border-red-800/60 text-red-800 [.dark_&]:text-amber-400 dark:text-amber-400 flex items-center justify-center font-bold">
                  <Wallet className="w-4 h-4" />
                </div>
                <h3 className="font-display font-bold text-base text-stone-900 [.dark_&]:text-stone-100 dark:text-stone-100">
                  {editingTx ? 'Edit Transaksi' : 'Tambah Transaksi Baru'}
                </h3>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                className="p-1.5 rounded-xl hover:bg-stone-100 [.dark_&]:hover:bg-stone-800 dark:hover:bg-stone-800 text-stone-400 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveTransaction} className="space-y-4 text-xs sm:text-sm">
              {/* Baris 1: Tanggal & Jenis Transaksi */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-center font-bold text-stone-700 [.dark_&]:text-stone-300 dark:text-stone-300 mb-1">
                    Tanggal Transaksi *
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl bg-[#faf8f5] [.dark_&]:bg-stone-800 dark:bg-stone-800 border border-stone-200 [.dark_&]:border-stone-700 dark:border-stone-700 text-stone-800 [.dark_&]:text-stone-100 dark:text-stone-100 font-medium focus:outline-none focus:ring-2 focus:ring-red-800/20 focus:border-red-700 [color-scheme:light] [.dark_&]:[color-scheme:dark] dark:[color-scheme:dark]"
                  />
                </div>

                <div>
                  <label className="block text-center font-bold text-stone-700 [.dark_&]:text-stone-300 dark:text-stone-300 mb-1">
                    Jenis Transaksi *
                  </label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value as 'Pemasukan' | 'Pengeluaran' })}
                    className="w-full px-4 py-2.5 rounded-xl bg-[#faf8f5] [.dark_&]:bg-stone-800 dark:bg-stone-800 border border-stone-200 [.dark_&]:border-stone-700 dark:border-stone-700 text-stone-800 [.dark_&]:text-stone-100 dark:text-stone-100 font-medium focus:outline-none focus:ring-2 focus:ring-red-800/20 focus:border-red-700"
                  >
                    <option value="Pemasukan">Pemasukan (+)</option>
                    <option value="Pengeluaran">Pengeluaran (-)</option>
                  </select>
                </div>
              </div>

              {/* Baris 2: Pos Anggaran & Uraian */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-center font-bold text-stone-700 [.dark_&]:text-stone-300 dark:text-stone-300 mb-1">
                    Kategori Anggaran
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value as NonNullable<FinancialTransaction['category']> })}
                    className="w-full px-4 py-2.5 rounded-xl bg-[#faf8f5] [.dark_&]:bg-stone-800 dark:bg-stone-800 border border-stone-200 [.dark_&]:border-stone-700 dark:border-stone-700 text-stone-800 [.dark_&]:text-stone-100 dark:text-stone-100 font-medium focus:outline-none focus:ring-2 focus:ring-red-800/20 focus:border-red-700"
                  >
                    {POS_ANGGARAN_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-center font-bold text-stone-700 [.dark_&]:text-stone-300 dark:text-stone-300 mb-1">
                    Uraian *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Contoh: Membeli Air Mineral"
                    className="w-full px-4 py-2.5 rounded-xl bg-[#faf8f5] [.dark_&]:bg-stone-800 dark:bg-stone-800 border border-stone-200 [.dark_&]:border-stone-700 dark:border-stone-700 text-stone-800 [.dark_&]:text-stone-100 dark:text-stone-100 font-medium focus:outline-none focus:ring-2 focus:ring-red-800/20 focus:border-red-700"
                  />
                </div>
              </div>

              {/* Baris 3: Volume, Satuan, Nominal */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-center font-bold text-stone-700 [.dark_&]:text-stone-300 dark:text-stone-300 mb-1">
                    Volume
                  </label>
                  <input
                    type="text"
                    value={formData.volume}
                    onChange={(e) => setFormData({ ...formData, volume: e.target.value })}
                    placeholder="Contoh: 3"
                    className="w-full px-4 py-2.5 rounded-xl bg-[#faf8f5] [.dark_&]:bg-stone-800 dark:bg-stone-800 border border-stone-200 [.dark_&]:border-stone-700 dark:border-stone-700 text-stone-800 [.dark_&]:text-stone-100 dark:text-stone-100 font-medium focus:outline-none focus:ring-2 focus:ring-red-800/20 focus:border-red-700"
                  />
                </div>

                <div>
                  <label className="block text-center font-bold text-stone-700 [.dark_&]:text-stone-300 dark:text-stone-300 mb-1">
                    Satuan
                  </label>
                  <input
                    type="text"
                    value={formData.satuan}
                    onChange={(e) => setFormData({ ...formData, satuan: e.target.value })}
                    placeholder="Contoh: Dus / Pcs"
                    className="w-full px-4 py-2.5 rounded-xl bg-[#faf8f5] [.dark_&]:bg-stone-800 dark:bg-stone-800 border border-stone-200 [.dark_&]:border-stone-700 dark:border-stone-700 text-stone-800 [.dark_&]:text-stone-100 dark:text-stone-100 font-medium focus:outline-none focus:ring-2 focus:ring-red-800/20 focus:border-red-700"
                  />
                </div>

                <div>
                  <label className="block text-center font-bold text-stone-700 [.dark_&]:text-stone-300 dark:text-stone-300 mb-1">
                    Nominal (Rp) *
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    value={formData.amount}
                    onChange={(e) => {
                      const digitsOnly = e.target.value.replace(/[^0-9]/g, '');
                      const numericValue = digitsOnly ? parseInt(digitsOnly, 10) : 0;
                      setFormData({
                        ...formData,
                        amount: numericValue > 0 ? `Rp. ${numericValue.toLocaleString('id-ID')}` : ''
                      });
                    }}
                    placeholder="Rp. 150.000"
                    className="w-full px-4 py-2.5 rounded-xl bg-[#faf8f5] [.dark_&]:bg-stone-800 dark:bg-stone-800 border border-stone-200 [.dark_&]:border-stone-700 dark:border-stone-700 text-stone-800 [.dark_&]:text-stone-100 dark:text-stone-100 font-medium font-mono focus:outline-none focus:ring-2 focus:ring-red-800/20 focus:border-red-700"
                  />
                </div>
              </div>

              {/* Baris 4: Total (sejajar kolom Volume) & Teks Terbilang (batas kiri sejajar kolom Satuan) */}
              {(() => {
                const nominalVal = parseInt(formData.amount.replace(/[^0-9]/g, ''), 10) || 0;
                const volRaw = formData.volume.trim();
                const volParsed = volRaw ? parseFloat(volRaw.replace(',', '.')) : 1;
                const effectiveVol = !isNaN(volParsed) && volParsed > 0 ? volParsed : 1;
                const totalComputed = nominalVal > 0 ? Math.round(nominalVal * effectiveVol) : 0;

                return (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                    <div>
                      <label className="block text-center font-bold text-stone-700 [.dark_&]:text-stone-300 dark:text-stone-300 mb-1">
                        Total (Rp)
                      </label>
                      <input
                        type="text"
                        readOnly
                        disabled
                        value={totalComputed > 0 ? `Rp. ${totalComputed.toLocaleString('id-ID')}` : 'Rp. 0'}
                        className="w-full px-4 py-2.5 rounded-xl bg-stone-100/90 [.dark_&]:bg-stone-800/60 dark:bg-stone-800/60 border border-stone-200 [.dark_&]:border-stone-700/70 dark:border-stone-700/70 text-stone-900 [.dark_&]:text-amber-300 dark:text-amber-300 font-bold font-mono cursor-not-allowed select-none"
                      />
                    </div>

                    <div className="sm:col-span-2 py-2.5 flex items-center">
                      <p className="text-xs sm:text-sm italic font-medium text-stone-600 [.dark_&]:text-stone-300 dark:text-stone-300 leading-snug">
                        {totalComputed > 0 ? formatTerbilangRupiah(totalComputed) : '(Nol rupiah)'}
                      </p>
                    </div>
                  </div>
                );
              })()}

              <div>
                <label className="block font-bold text-stone-700 [.dark_&]:text-stone-300 dark:text-stone-300 mb-1">
                  Bukti Nota / Kuitansi (Opsional)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleReceiptFileChange}
                    className="flex-1 text-xs text-stone-500 [.dark_&]:text-stone-400 file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-red-800/15 [.dark_&]:file:bg-amber-500/15 file:text-red-800 [.dark_&]:file:text-amber-300 hover:file:bg-red-800/25 [.dark_&]:hover:file:bg-amber-500/25 cursor-pointer"
                  />
                  {formData.receiptImage && (
                    <button
                      type="button"
                      onClick={() => {
                        setFormData((prev) => ({ ...prev, receiptImage: '' }));
                        setReceiptError('');
                      }}
                      className="text-xs font-bold text-red-600 dark:text-red-400 hover:underline cursor-pointer"
                    >
                      Hapus Foto
                    </button>
                  )}
                </div>
                {receiptError && (
                  <p className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">{receiptError}</p>
                )}
                {formData.receiptImage && (
                  <img src={formData.receiptImage} alt="Pratinjau Nota" className="mt-2 h-24 rounded-xl border border-stone-200 dark:border-stone-700 object-cover" />
                )}
              </div>

              <div className="pt-3 border-t border-stone-200/80 [.dark_&]:border-stone-800 dark:border-stone-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-5 py-2.5 rounded-xl bg-stone-100 [.dark_&]:bg-stone-800 dark:bg-stone-800 text-stone-600 [.dark_&]:text-stone-300 dark:text-stone-300 font-bold text-xs uppercase tracking-wider hover:bg-stone-200 [.dark_&]:hover:bg-stone-700 dark:hover:bg-stone-700 transition-colors cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-xl bg-red-800 hover:bg-red-700 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-2 shadow-md hover:shadow-lg transition-all active:scale-95 cursor-pointer"
                >
                  <Check className="w-4 h-4 stroke-[3]" />
                  Simpan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Konfirmasi Hapus Data Transaksi */}
      {deleteTarget && (
        <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm ${isClosingDeleteModal ? 'modal-backdrop-exit' : 'animate-backdrop-fade'}`}>
          <div className={`bg-white [.dark_&]:bg-stone-900 dark:bg-stone-900 rounded-2xl max-w-md w-full p-6 shadow-2xl border border-stone-200/90 [.dark_&]:border-stone-800 dark:border-stone-800 space-y-4 ${isClosingDeleteModal ? 'modal-content-exit' : 'animate-modal-pop'}`}>
            <div className="flex items-center gap-3 text-red-700 [.dark_&]:text-red-400 dark:text-red-400">
              <div className="w-10 h-10 rounded-xl bg-red-50 [.dark_&]:bg-red-950/70 dark:bg-red-950/70 border border-red-200 [.dark_&]:border-red-800/60 dark:border-red-800/60 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display font-bold text-base text-stone-900 [.dark_&]:text-stone-100 dark:text-stone-100">
                  Konfirmasi Hapus
                </h3>
                <p className="text-xs text-stone-500 [.dark_&]:text-stone-400 dark:text-stone-400">
                  Tindakan ini tidak dapat dibatalkan.
                </p>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-stone-600 [.dark_&]:text-stone-300 dark:text-stone-300">
              Apakah Anda yakin ingin menghapus data transaksi <span className="font-bold text-stone-900 [.dark_&]:text-stone-100 dark:text-stone-100">&ldquo;{deleteTarget.desc}&rdquo;</span>?
            </p>

            <div className="pt-3 border-t border-stone-200/80 [.dark_&]:border-stone-800 dark:border-stone-800 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={handleCloseDeleteModal}
                className="px-5 py-2.5 rounded-xl bg-stone-100 [.dark_&]:bg-stone-800 dark:bg-stone-800 text-stone-600 [.dark_&]:text-stone-300 dark:text-stone-300 font-bold text-xs uppercase tracking-wider hover:bg-stone-200 [.dark_&]:hover:bg-stone-700 dark:hover:bg-stone-700 transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="px-6 py-2.5 rounded-xl bg-red-700 hover:bg-red-600 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-2 shadow-md hover:shadow-lg transition-all active:scale-95 cursor-pointer"
              >
                <Trash2 className="w-4 h-4 stroke-[3]" />
                Hapus
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Warning Modal */}
      {isWarningModalOpen && (
        <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${isClosingWarningModal ? 'modal-backdrop-exit' : 'animate-backdrop-fade'}`}>
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm cursor-pointer"
            onClick={handleCloseWarningModal}
          />
          <div className={`relative bg-white [.dark_&]:bg-stone-900 dark:bg-stone-900 rounded-2xl p-6 md:p-8 max-w-sm w-full shadow-2xl border border-stone-200/90 [.dark_&]:border-stone-800 dark:border-stone-800 ${isClosingWarningModal ? 'modal-content-exit' : 'animate-modal-pop'}`}>
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-amber-50 [.dark_&]:bg-amber-950/60 dark:bg-amber-950/60 border border-amber-200 [.dark_&]:border-amber-800/60 dark:border-amber-800/60 text-amber-600 [.dark_&]:text-amber-400 dark:text-amber-400 flex items-center justify-center mb-4">
                <AlertCircle className="w-8 h-8" />
              </div>
              <h3 className="font-display text-xl font-bold text-stone-900 [.dark_&]:text-stone-100 dark:text-stone-100 mb-2">Akses Ditolak</h3>
              <p className="text-stone-500 [.dark_&]:text-stone-400 dark:text-stone-400 text-sm mb-6">
                Maaf, Anda login sebagai <strong>Guru</strong>. Fitur pengelolaan data keuangan hanya dapat diakses oleh <strong>Pengurus PGRI (Ketua/Bendahara)</strong>.
              </p>
              <button
                type="button"
                onClick={handleCloseWarningModal}
                className="w-full py-3 bg-red-800 hover:bg-red-700 text-white rounded-xl font-semibold transition-colors cursor-pointer"
              >
                Mengerti
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Pratinjau Foto Kwitansi / Nota */}
      {previewReceiptUrl && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) handleClosePreviewReceipt(); }}
          className={`fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm ${isClosingPreviewReceipt ? 'modal-backdrop-exit' : 'animate-backdrop-fade'}`}
        >
          <div className={`bg-white [.dark_&]:bg-stone-900 dark:bg-stone-900 rounded-2xl max-w-lg w-full p-5 border border-stone-200/90 [.dark_&]:border-stone-800 dark:border-stone-800 shadow-2xl space-y-4 ${isClosingPreviewReceipt ? 'modal-content-exit' : 'animate-modal-pop'}`}>
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold text-sm text-stone-800 [.dark_&]:text-stone-100 dark:text-stone-100 flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-red-800 [.dark_&]:text-amber-400 dark:text-amber-400" />
                Bukti Kwitansi / Nota Transaksi
              </h3>
              <button
                type="button"
                onClick={handleClosePreviewReceipt}
                className="p-1.5 rounded-xl hover:bg-stone-100 [.dark_&]:hover:bg-stone-800 dark:hover:bg-stone-800 text-stone-400 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="rounded-xl overflow-hidden bg-stone-100 [.dark_&]:bg-stone-950 dark:bg-stone-950 flex items-center justify-center max-h-[65vh]">
              <img src={previewReceiptUrl} alt="Bukti Transaksi" className="max-h-[65vh] w-auto object-contain" />
            </div>
          </div>
        </div>
      )}

      {/* Modal Rekap Tunggakan per Sekolah & Pengingat WA Koordinator */}
      {isRekapSekolahOpen && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) handleCloseRekapSekolah(); }}
          className={`fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm ${isClosingRekapSekolah ? 'modal-backdrop-exit' : 'animate-backdrop-fade'}`}
        >
          <div className={`bg-white [.dark_&]:bg-stone-900 dark:bg-stone-900 rounded-2xl max-w-2xl w-full p-6 border border-stone-200/90 [.dark_&]:border-stone-800 dark:border-stone-800 shadow-2xl space-y-4 max-h-[85vh] flex flex-col ${isClosingRekapSekolah ? 'modal-content-exit' : 'animate-modal-pop'}`}>
            <div className="flex items-center justify-between border-b border-stone-200/80 [.dark_&]:border-stone-800 dark:border-stone-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 [.dark_&]:bg-emerald-950/60 dark:bg-emerald-950/60 border border-emerald-200 [.dark_&]:border-emerald-800/60 dark:border-emerald-800/60 text-emerald-700 [.dark_&]:text-emerald-400 dark:text-emerald-400 flex items-center justify-center">
                  <School className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-base text-stone-900 [.dark_&]:text-stone-100 dark:text-stone-100">
                    Rekap Kontribusi &amp; Tunggakan per Sekolah
                  </h3>
                  <p className="text-xs text-stone-500 [.dark_&]:text-stone-400 dark:text-stone-400">
                    Pantau progres pelunasan tiap sekolah binaan &amp; kirim pengingat WA koordinator.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseRekapSekolah}
                className="p-1.5 rounded-xl hover:bg-stone-100 [.dark_&]:hover:bg-stone-800 dark:hover:bg-stone-800 text-stone-400 cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={rekapYear}
                onChange={(e) => {
                  const nextYear = e.target.value;
                  setRekapYear(nextYear);
                  if (!isPeriodActive(nextYear, rekapMonth)) {
                    const firstValid = MONTH_OPTIONS.find(m => isPeriodActive(nextYear, m.id));
                    if (firstValid) setRekapMonth(firstValid.id);
                  }
                }}
                className="px-3 py-2 rounded-xl border text-xs font-bold bg-[#faf8f5] [.dark_&]:bg-stone-800 dark:bg-stone-800 border-stone-200 [.dark_&]:border-stone-700 dark:border-stone-700 text-stone-800 [.dark_&]:text-stone-100 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-red-800/20 focus:border-red-700 cursor-pointer"
              >
                {YEAR_OPTIONS.map((y) => (
                  <option key={y} value={y} className={isDark ? 'bg-stone-800 text-stone-100' : 'bg-white text-stone-800'}>{y}</option>
                ))}
              </select>
              <select
                value={rekapMonth}
                onChange={(e) => setRekapMonth(e.target.value)}
                className="px-3 py-2 rounded-xl border text-xs font-bold bg-[#faf8f5] [.dark_&]:bg-stone-800 dark:bg-stone-800 border-stone-200 [.dark_&]:border-stone-700 dark:border-stone-700 text-stone-800 [.dark_&]:text-stone-100 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-red-800/20 focus:border-red-700 cursor-pointer"
              >
                {MONTH_OPTIONS.filter(m => isPeriodActive(rekapYear, m.id)).map((m) => (
                  <option key={m.id} value={m.id} className={isDark ? 'bg-stone-800 text-stone-100' : 'bg-white text-stone-800'}>{m.name}</option>
                ))}
              </select>
              <span className="text-xs text-stone-500 [.dark_&]:text-stone-400 dark:text-stone-400 ml-auto">
                Kontribusi standar: <strong className="text-stone-800 [.dark_&]:text-amber-400 dark:text-amber-400">{formatRupiah(orgConfig.monthlyDuesAmount)}</strong>/anggota
              </span>
            </div>

            <div className="overflow-y-auto space-y-2.5 pr-1 flex-1 [.dark_&]:[color-scheme:dark] dark:[color-scheme:dark]">
              {schoolDuesSummary.map((grp) => {
                const monthLabel = MONTH_OPTIONS.find((m) => m.id === rekapMonth)?.name || rekapMonth;
                const pct = grp.total > 0 ? Math.round((grp.paid.length / grp.total) * 100) : 0;
                return (
                  <div key={grp.school} className="p-4 rounded-2xl border border-stone-200/80 [.dark_&]:border-stone-800 dark:border-stone-800 bg-[#faf8f5] [.dark_&]:bg-stone-800/60 dark:bg-stone-800/60 space-y-2.5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <h4 className="font-bold text-sm text-stone-900 [.dark_&]:text-stone-100 dark:text-stone-100">{grp.school}</h4>
                        <p className="text-xs text-stone-500 [.dark_&]:text-stone-400 dark:text-stone-400">
                          Lunas: <strong className="text-emerald-600 [.dark_&]:text-emerald-400 dark:text-emerald-400">{grp.paid.length}</strong> • Belum Bayar: <strong className="text-red-600 [.dark_&]:text-red-400 dark:text-red-400">{grp.unpaid.length}</strong> dari {grp.total} anggota ({pct}%)
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={grp.paid.length === 0 || downloadingSchoolPdf === grp.school}
                          onClick={() => handleDownloadSchoolReceiptsPdf(grp.school, grp.paid)}
                          title={grp.paid.length === 0 ? 'Belum ada anggota lunas di sekolah ini' : `Unduh ${grp.paid.length} Kuitansi Lunas (PDF)`}
                          className="px-3.5 py-2 rounded-xl bg-red-800 hover:bg-red-700 disabled:opacity-45 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shrink-0 transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>
                            {downloadingSchoolPdf === grp.school
                              ? 'Memproses...'
                              : `Kuitansi PDF (${grp.paid.length})`}
                          </span>
                        </button>

                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => {
                              handleActionClick(() => {
                                const unpaidListText = grp.unpaid.length > 0
                                  ? grp.unpaid.map((t, i) => `${i + 1}. ${t.name}`).join('\n')
                                  : 'Alhamdulillah, semua anggota sudah lunas.';
                                const msg =
                                  `📊 *REKAP KONTRIBUSI PGRI RANTING GELANG*\n` +
                                  `Sekolah: *${grp.school}*\n` +
                                  `Periode: *${monthLabel} ${rekapYear}*\n` +
                                  `Status: ${grp.paid.length}/${grp.total} Lunas (${pct}%)\n\n` +
                                  `${grp.unpaid.length > 0 ? `*Daftar Belum Lunas (${grp.unpaid.length} orang):*\n${unpaidListText}\n\n` : `${unpaidListText}\n\n`}` +
                                  `Transfer ke: ${orgConfig.bankName} ${orgConfig.bankAccountNumber} a.n. ${orgConfig.bankAccountHolder}\n` +
                                  `_Mohon bantuannya untuk koordinasi Bapak/Ibu di sekolah. Terima kasih._`;
                                openWhatsAppShare(msg);
                              });
                            }}
                            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shrink-0 transition-colors"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                            <span>Kirim Rekap WA</span>
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-stone-200/90 [.dark_&]:bg-stone-700/70 dark:bg-stone-700/70 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ease-out ${pct === 100 ? 'bg-emerald-500' : 'bg-gradient-to-r from-amber-500 to-emerald-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {grp.unpaid.length > 0 && (
                      <p className="text-[11px] text-red-600/90 [.dark_&]:text-red-400/90 dark:text-red-400/90 leading-relaxed">
                        Belum bayar: {grp.unpaid.map((t) => t.name).join(', ')}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Modal D2: Kuitansi Digital Pembayaran Kontribusi */}
      {receiptPreviewTarget && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) handleCloseReceiptPreview(); }}
          className={`fixed inset-0 z-[75] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm ${isClosingReceiptPreview ? 'modal-backdrop-exit' : 'animate-backdrop-fade'}`}
        >
          <div className={`bg-white [.dark_&]:bg-stone-900 dark:bg-stone-900 rounded-2xl max-w-lg w-full overflow-hidden border border-stone-200/90 [.dark_&]:border-stone-800 dark:border-stone-800 shadow-2xl ${isClosingReceiptPreview ? 'modal-content-exit' : 'animate-modal-pop'}`}>
            {/* Header Kuitansi Crimson-Gold */}
            <div className="bg-gradient-to-r from-red-900 via-red-800 to-red-900 px-6 py-4 border-b-2 border-amber-500 flex items-center justify-between text-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/15 border border-amber-300/30 flex items-center justify-center shrink-0">
                  <Receipt className="w-5 h-5 text-amber-200" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-base tracking-tight">Kuitansi Pembayaran Kontribusi</h3>
                  <p className="text-[11px] font-bold text-amber-200 uppercase tracking-wider">
                    PGRI Ranting Gelang • Kec. Sumberbaru
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseReceiptPreview}
                className="p-1.5 rounded-xl hover:bg-white/15 text-white/80 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {(() => {
              const { teacher, month, year, payment } = receiptPreviewTarget;
              const receiptNo = buildReceiptNumber(teacher, month.id, year);
              const receiptSigners = resolveSignersFromPengurus();
              const bendaharaName = receiptSigners.bendaharaName;
              const bendaharaNpa = receiptSigners.bendaharaNpaLabel;
              const nipOrNpa = (teacher as any).nip || (teacher as any).npa || '-';
              const formattedPaidDate = formatReceiptPaidDate(payment?.datePaid);
              const terbilangText = formatTerbilangRupiah(orgConfig.monthlyDuesAmount);

              return (
                <div className="p-6 space-y-4">
                  <div className="flex items-center justify-between gap-2 pb-3 border-b border-stone-200/80 [.dark_&]:border-stone-800 dark:border-stone-800">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Nomor Kuitansi</p>
                      <p className="font-mono text-xs sm:text-sm font-bold text-stone-800 [.dark_&]:text-stone-100 dark:text-stone-100">
                        {receiptNo}
                      </p>
                    </div>
                    <span className="px-3 py-1 rounded-md text-xs font-extrabold uppercase tracking-wider bg-emerald-100 text-emerald-800 [.dark_&]:bg-emerald-950/70 dark:bg-emerald-950/70 [.dark_&]:text-emerald-300 dark:text-emerald-300 border border-emerald-200 [.dark_&]:border-emerald-800/60 dark:border-emerald-800/60">
                      LUNAS
                    </span>
                  </div>

                  <div className="rounded-2xl border border-stone-200/80 [.dark_&]:border-stone-800 dark:border-stone-800 bg-[#faf8f5] [.dark_&]:bg-stone-800/50 dark:bg-stone-800/50 p-4 space-y-2.5 text-xs sm:text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="text-stone-500 [.dark_&]:text-stone-400 dark:text-stone-400">Anggota</span>
                      <span className="font-bold text-stone-900 [.dark_&]:text-white dark:text-white text-right">{teacher.name}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-stone-500 [.dark_&]:text-stone-400 dark:text-stone-400">NIP / NPA</span>
                      <span className="font-mono font-semibold text-stone-700 [.dark_&]:text-stone-200 dark:text-stone-200 text-right">{nipOrNpa}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-stone-500 [.dark_&]:text-stone-400 dark:text-stone-400">Asal Sekolah</span>
                      <span className="font-semibold text-stone-700 [.dark_&]:text-stone-200 dark:text-stone-200 text-right">{teacher.school || '-'}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-stone-500 [.dark_&]:text-stone-400 dark:text-stone-400">Periode</span>
                      <span className="font-bold text-red-800 [.dark_&]:text-amber-300 dark:text-amber-300 text-right">{month.name} {year}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-stone-500 [.dark_&]:text-stone-400 dark:text-stone-400">Tanggal Bayar</span>
                      <span className="font-semibold text-stone-700 [.dark_&]:text-stone-200 dark:text-stone-200 text-right">{formattedPaidDate}</span>
                    </div>
                    <div className="flex justify-between items-start gap-3">
                      <span className="text-stone-500 [.dark_&]:text-stone-400 dark:text-stone-400">Bendahara</span>
                      <div className="text-right leading-tight">
                        <span className="block font-semibold text-stone-700 [.dark_&]:text-stone-200 dark:text-stone-200">
                          PGRI Ranting Gelang
                        </span>
                        <span className="block text-xs font-bold text-stone-900 [.dark_&]:text-white dark:text-white">
                          {bendaharaName}
                        </span>
                        <span className="block text-[11px] font-mono text-stone-500 [.dark_&]:text-stone-400 dark:text-stone-400">
                          {bendaharaNpa}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl p-3.5 bg-red-50/70 [.dark_&]:bg-red-950/35 dark:bg-red-950/35 border border-red-200/80 [.dark_&]:border-red-900/50 dark:border-red-900/50 flex items-center justify-between gap-3">
                    <span className="text-xs font-bold uppercase tracking-wider text-red-800 [.dark_&]:text-amber-300 dark:text-amber-300">
                      Nominal Kontribusi
                    </span>
                    <div className="text-right">
                      <span className="block font-display text-lg font-black text-stone-900 [.dark_&]:text-white dark:text-white">
                        {formatRupiah(orgConfig.monthlyDuesAmount)}
                      </span>
                      <span className="block text-[11px] italic font-medium text-stone-600 [.dark_&]:text-stone-300 dark:text-stone-300">
                        {terbilangText}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-stone-200/80 [.dark_&]:border-stone-800 dark:border-stone-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        const rawPhone = String(teacher.phone || '').replace(/[^0-9]/g, '');
                        const cleanPhone = rawPhone.startsWith('08') ? `62${rawPhone.slice(1)}` : rawPhone;
                        const msg =
                          `🧾 *KUITANSI PEMBAYARAN KONTRIBUSI PGRI*\n` +
                          `No. Kuitansi: *${receiptNo}*\n` +
                          `Nama: *${teacher.name}*\n` +
                          `NIP/NPA: ${nipOrNpa}\n` +
                          `Sekolah: ${teacher.school || '-'}\n` +
                          `Periode: *${month.name} ${year}*\n` +
                          `Nominal: *${formatRupiah(orgConfig.monthlyDuesAmount)}* ${terbilangText}\n` +
                          `Tanggal Bayar: ${formattedPaidDate}\n` +
                          `Status: *LUNAS*\n` +
                          `Bendahara PGRI Ranting Gelang: ${bendaharaName} (${bendaharaNpa})\n\n` +
                          `_Terima kasih atas kontribusi Bapak/Ibu di PGRI Ranting Gelang._`;
                        if (cleanPhone.length >= 9) {
                          openWhatsAppShare(msg, cleanPhone);
                        } else {
                          openWhatsAppShare(msg);
                        }
                      }}
                      className="px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm transition-all active:scale-95 cursor-pointer"
                    >
                      <Share2 className="w-4 h-4" />
                      <span>Kirim WA</span>
                    </button>

                    <button
                      type="button"
                      disabled={isDownloadingReceipt}
                      onClick={handleDownloadReceiptPng}
                      className="px-5 py-2.5 rounded-xl bg-red-800 hover:bg-red-700 disabled:opacity-60 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm transition-all active:scale-95 cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      <span>{isDownloadingReceipt ? 'Memproses...' : 'Unduh Kuitansi PNG'}</span>
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};