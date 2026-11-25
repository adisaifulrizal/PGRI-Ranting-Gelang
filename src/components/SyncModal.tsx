import React, { useState, useEffect } from 'react';
import { 
  X, 
  RefreshCw, 
  Check, 
  Users, 
  Calendar, 
  Wallet, 
  Bell,
  ArrowDownToLine,
  ShieldCheck,
  ClipboardList,
  HeartHandshake,
  FileText,
  Phone,
  Clock
} from 'lucide-react';
import { getLocalVersions, SyncVersionKey } from '../lib/sync';

const MODULE_LAST_SYNC_KEY = 'pgri-module-last-sync';

const MODULE_VERSION_KEYS: Record<string, SyncVersionKey[]> = {
  anggota: ['teachers'],
  jadwal: ['events', 'attendanceList'],
  keuangan: ['financialTransactions', 'cashPayments'],
  sosial: ['dana_sosial', 'aspirasi_items'],
  proker: ['proker_items'],
  forum_pengumuman: ['announcements'],
  undangan: ['invitations', 'suratAgenda', 'notulen'],
  kontak: ['kontakFeedback'],
  pengaturan: ['settings']
};

function readModuleLastSyncMap(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(MODULE_LAST_SYNC_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch {}
  return {};
}

function formatSyncTimestamp(ts: number): string {
  if (!ts || ts <= 1000000000000) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  const timeStr = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Hari ini, ${timeStr}`;
  const dateStr = d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  return `${dateStr} • ${timeStr}`;
}

export interface SyncModuleOption {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
  hoverBorder: string;
  associatedTabs: string[];
}

export const SYNC_MODULES: SyncModuleOption[] = [
  {
    id: 'anggota',
    label: 'Daftar Anggota PGRI',
    description: 'Data biodata anggota, nomor WA, NIP/NPA, status keaktifan & pendaftar baru',
    icon: Users,
    color: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
    hoverBorder: 'hover:border-amber-500/50 hover:bg-amber-500/5',
    associatedTabs: ['anggota']
  },
  {
    id: 'jadwal',
    label: 'Jadwal Kegiatan & Presensi',
    description: 'Daftar pertemuan, jadwal, & presensi kehadiran peserta',
    icon: Calendar,
    color: 'text-red-500 bg-red-500/10 border-red-500/20',
    hoverBorder: 'hover:border-red-500/50 hover:bg-red-500/5',
    associatedTabs: ['jadwal']
  },
  {
    id: 'keuangan',
    label: 'Catatan Keuangan & Kas',
    description: 'Catatan kas masuk/keluar, buku kas, & status pembayaran kontribusi',
    icon: Wallet,
    color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20',
    hoverBorder: 'hover:border-emerald-500/50 hover:bg-emerald-500/5',
    associatedTabs: ['keuangan']
  },
  {
    id: 'sosial',
    label: 'Dana Aspirasi',
    description: 'Penggalangan & penyaluran dana sosial serta aspirasi anggota',
    icon: HeartHandshake,
    color: 'text-red-500 bg-red-500/10 border-red-500/20',
    hoverBorder: 'hover:border-red-500/50 hover:bg-red-500/5',
    associatedTabs: ['sosial']
  },
  {
    id: 'proker',
    label: 'Program Kerja',
    description: 'Daftar program kerja per seksi, progres pelaksanaan, & rencana anggaran',
    icon: ClipboardList,
    color: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
    hoverBorder: 'hover:border-amber-500/50 hover:bg-amber-500/5',
    associatedTabs: ['proker']
  },
  {
    id: 'forum_pengumuman',
    label: 'Pengumuman',
    description: 'Informasi pengumuman resmi & pemberitahuan kegiatan PGRI',
    icon: Bell,
    color: 'text-red-500 bg-red-500/10 border-red-500/20',
    hoverBorder: 'hover:border-red-500/50 hover:bg-red-500/5',
    associatedTabs: ['dokumen']
  },
  {
    id: 'undangan',
    label: 'Buat Undangan & E-Office',
    description: 'Arsip surat undangan, buku agenda surat, & notulen rapat',
    icon: FileText,
    color: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
    hoverBorder: 'hover:border-amber-500/50 hover:bg-amber-500/5',
    associatedTabs: ['undangan']
  },
  {
    id: 'kontak',
    label: 'Layanan Informasi & Masukan',
    description: 'Pesan, saran, pertanyaan anggota & penggabungan kiriman masuk',
    icon: Phone,
    color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20',
    hoverBorder: 'hover:border-emerald-500/50 hover:bg-emerald-500/5',
    associatedTabs: ['kontak']
  },
  {
    id: 'pengaturan',
    label: 'Kepengurusan & Pengaturan',
    description: 'Logo PGRI, konfigurasi organisasi, struktur pengurus, & kunci menu',
    icon: ShieldCheck,
    color: 'text-red-500 bg-red-500/10 border-red-500/20',
    hoverBorder: 'hover:border-red-500/50 hover:bg-red-500/5',
    associatedTabs: ['profil', 'pengaturan']
  }
];

interface SyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: string;
  theme: 'light' | 'dark';
  onExecuteSync: (selectedModuleIds: string[]) => Promise<void>;
  isSyncing: boolean;
}

export const SyncModal: React.FC<SyncModalProps> = ({
  isOpen,
  onClose,
  activeTab,
  theme,
  onExecuteSync,
  isSyncing
}) => {
  const isDark = theme === 'dark';
  const [syncingModuleId, setSyncingModuleId] = useState<string | null>(null);
  const [successModuleId, setSuccessModuleId] = useState<string | null>(null);
  const [moduleLastSyncMap, setModuleLastSyncMap] = useState<Record<string, number>>(() => readModuleLastSyncMap());

  useEffect(() => {
    if (isOpen) {
      setModuleLastSyncMap(readModuleLastSyncMap());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const localVersions = getLocalVersions();

  const getModuleSyncStatusText = (moduleId: string): string => {
    const explicitTs = moduleLastSyncMap[moduleId] || 0;
    if (explicitTs > 0) {
      const formatted = formatSyncTimestamp(explicitTs);
      if (formatted) return `Terakhir ditarik: ${formatted}`;
    }
    const vKeys = MODULE_VERSION_KEYS[moduleId] || [];
    const maxVersionTs = vKeys.reduce((acc, k) => {
      const val = Number(localVersions[k] || 0);
      return val > acc ? val : acc;
    }, 0);
    if (maxVersionTs > 1000000000000) {
      const formatted = formatSyncTimestamp(maxVersionTs);
      if (formatted) return `Versi lokal: ${formatted}`;
    }
    if (maxVersionTs > 0) {
      return 'Data lokal tersedia';
    }
    return 'Belum pernah ditarik manual';
  };

  const handleSyncSingleModule = async (moduleId: string) => {
    if (isSyncing || syncingModuleId) return;
    setSyncingModuleId(moduleId);
    setSuccessModuleId(null);
    try {
      await onExecuteSync([moduleId]);
      const nowTs = Date.now();
      const nextMap = { ...readModuleLastSyncMap() };
      if (moduleId === 'semua') {
        SYNC_MODULES.forEach((m) => {
          nextMap[m.id] = nowTs;
        });
      } else {
        nextMap[moduleId] = nowTs;
      }
      try {
        localStorage.setItem(MODULE_LAST_SYNC_KEY, JSON.stringify(nextMap));
      } catch {}
      setModuleLastSyncMap(nextMap);
      setSuccessModuleId(moduleId);
      setTimeout(() => {
        setSyncingModuleId(null);
        setSuccessModuleId(null);
        onClose();
      }, 900);
    } catch (e) {
      setSyncingModuleId(null);
      setSuccessModuleId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-stone-950/70 animate-backdrop-fade">
      <style>{`
        @keyframes backdropFade { from { opacity: 0; backdrop-filter: blur(0px); } to { opacity: 1; backdrop-filter: blur(8px); } }
        .animate-backdrop-fade { animation: backdropFade 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        @keyframes modalPopIn { 0% { opacity: 0; transform: scale(0.95) translateY(8px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
        .animate-modal-pop { animation: modalPopIn 0.24s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}</style>
      <div 
        className={`relative w-full max-w-lg rounded-2xl shadow-2xl border transition-all duration-200 overflow-hidden flex flex-col max-h-[90vh] animate-modal-pop ${
          isDark 
            ? 'bg-stone-900 border-stone-800 text-stone-100' 
            : 'bg-white border-stone-200 text-stone-900'
        }`}
      >
        <div className="h-[3px] w-full pgri-top-accent shrink-0" />

        {/* Header Modal */}
        <div className={`px-5 py-4 border-b flex items-center justify-between shrink-0 ${
          isDark ? 'border-stone-800 bg-stone-900/90' : 'border-stone-100 bg-[#faf8f5]'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${
              isDark
                ? 'bg-red-950/60 border-red-800/50 text-amber-400'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}>
              <RefreshCw className={`w-5 h-5 ${isSyncing ? 'animate-spin' : ''}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display font-bold text-base sm:text-lg tracking-tight">
                  Pilih Menu Sinkronisasi
                </h3>
              </div>
              <p className={`text-xs ${isDark ? 'text-stone-400' : 'text-stone-500'}`}>
                Tarik data per menu dari Cloud agar kuota Firebase tetap hemat
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSyncing || syncingModuleId !== null}
            className={`p-2 rounded-xl transition-colors active:scale-95 disabled:opacity-50 cursor-pointer ${
              isDark ? 'hover:bg-stone-800 text-stone-400 hover:text-stone-100' : 'hover:bg-stone-100 text-stone-500 hover:text-stone-900'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* List Tombol Modul (Single Click Sync Per-Menu) */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-2.5 flex-1 custom-scrollbar">
          {SYNC_MODULES.map((mod) => {
            const isCurrentlySyncing = syncingModuleId === mod.id;
            const isSuccess = successModuleId === mod.id;
            const isCurrentActiveTab = mod.associatedTabs.includes(activeTab);
            const IconComp = mod.icon;

            return (
              <button
                key={mod.id}
                type="button"
                onClick={() => handleSyncSingleModule(mod.id)}
                disabled={isSyncing || syncingModuleId !== null}
                className={`w-full p-3 sm:p-3.5 rounded-xl border text-left flex items-center justify-between gap-3.5 transition-all duration-150 active:scale-[0.99] group cursor-pointer disabled:cursor-not-allowed ${
                  isSuccess
                    ? 'bg-emerald-700 border-emerald-600 text-white shadow-sm'
                    : isCurrentlySyncing
                    ? isDark
                      ? 'bg-red-950/60 border-red-700/70 text-amber-100 shadow-sm'
                      : 'bg-red-50 border-red-300 text-red-950 shadow-sm'
                    : isDark
                    ? `bg-stone-800/45 border-stone-800 hover:bg-stone-800/90 hover:border-red-800/60`
                    : `bg-[#faf8f5] border-stone-200/90 hover:bg-white hover:border-red-300 hover:shadow-sm`
                } ${isSyncing && !isCurrentlySyncing ? 'opacity-50 pointer-events-none' : ''}`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 transition-colors ${
                    isSuccess 
                      ? 'bg-white/20 border-white/30 text-white' 
                      : mod.color
                  }`}>
                    <IconComp className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-bold text-xs sm:text-sm truncate ${
                        isSuccess ? 'text-white' : ''
                      }`}>
                        {mod.label}
                      </span>
                      {isCurrentActiveTab && !isSuccess && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-red-800 dark:text-amber-400 shrink-0">
                          • Aktif
                        </span>
                      )}
                    </div>
                    <p className={`text-[11px] truncate mt-0.5 ${
                      isSuccess 
                        ? 'text-white/85' 
                        : isDark 
                        ? 'text-stone-400' 
                        : 'text-stone-500'
                    }`}>
                      {mod.description}
                    </p>
                    <p className={`text-[10px] mt-1 inline-flex items-center gap-1 font-medium ${
                      isSuccess
                        ? 'text-white/90'
                        : isDark
                        ? 'text-stone-500'
                        : 'text-stone-400'
                    }`}>
                      <Clock className="w-2.5 h-2.5 shrink-0" />
                      <span>{getModuleSyncStatusText(mod.id)}</span>
                    </p>
                  </div>
                </div>

                {/* Right Action Indicator */}
                <div className="shrink-0 flex items-center pl-1">
                  {isCurrentlySyncing ? (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-800 text-white text-xs font-bold shadow-sm">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span className="hidden sm:inline">Menarik...</span>
                    </div>
                  ) : isSuccess ? (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-emerald-800 text-xs font-bold shadow-sm">
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                      <span>Tersinkron</span>
                    </div>
                  ) : (
                    <div className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                      isDark
                        ? 'bg-stone-800 text-stone-200 border border-stone-700 group-hover:bg-red-800 group-hover:border-red-700 group-hover:text-white'
                        : 'bg-stone-200/80 text-stone-700 group-hover:bg-red-800 group-hover:text-white'
                    }`}>
                      <ArrowDownToLine className="w-3.5 h-3.5" />
                      <span>Tarik</span>
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer Info & Aksi Tarik Semua */}
        <div className={`px-5 py-3.5 border-t flex flex-wrap items-center justify-between gap-2.5 shrink-0 ${
          isDark ? 'border-stone-800 bg-stone-900' : 'border-stone-100 bg-[#faf8f5]'
        }`}>
          <p className={`text-[11px] flex-1 min-w-[160px] ${isDark ? 'text-stone-400' : 'text-stone-500'}`}>
            Tarik per menu untuk hemat kuota, atau gunakan <strong>Tarik Semua</strong> bila perlu sinkron penuh.
          </p>

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={() => handleSyncSingleModule('semua')}
              disabled={isSyncing || syncingModuleId !== null}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-60 cursor-pointer shadow-sm ${
                successModuleId === 'semua'
                  ? 'bg-emerald-700 text-white'
                  : 'bg-red-800 hover:bg-red-700 text-white'
              }`}
            >
              {syncingModuleId === 'semua' ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : successModuleId === 'semua' ? (
                <Check className="w-3.5 h-3.5 stroke-[3]" />
              ) : (
                <ArrowDownToLine className="w-3.5 h-3.5" />
              )}
              <span>
                {syncingModuleId === 'semua'
                  ? 'Menarik Semua...'
                  : successModuleId === 'semua'
                  ? 'Semua Tersinkron'
                  : 'Tarik Semua'}
              </span>
            </button>

            <button
              onClick={onClose}
              disabled={isSyncing || syncingModuleId !== null}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold border transition-colors active:scale-95 disabled:opacity-50 cursor-pointer ${
                isDark ? 'border-stone-700 hover:bg-stone-800 text-stone-300' : 'border-stone-300 hover:bg-stone-100 text-stone-700'
              }`}
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
