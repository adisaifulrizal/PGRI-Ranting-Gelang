import React, { useRef, useState, useEffect, useMemo } from 'react';
import { 
  Users, 
  BookOpen, 
  Calendar, 
  MessageSquare, 
  ChevronRight, 
  Star, 
  Clock, 
  Sparkles, 
  ArrowRight, 
  Cpu, 
  ExternalLink, 
  UserX, 
  CheckCircle2, 
  User, 
  UserCheck,
  Award,
  Wallet,
  TrendingUp,
  Building2,
  ShieldCheck
} from 'lucide-react';
import { ActiveTab, ActivityEvent, Teacher, Material, CashPayment, AttendanceRecord } from '../../types';
import { getOrgConfig } from '../../lib/orgConfig';

interface BerandaViewProps {
  onNavigate: (tab: ActiveTab) => void;
  events: ActivityEvent[];
  announcements?: any[];
  onOpenAttendance: (event: ActivityEvent) => void;
  theme?: 'light' | 'dark';
  teachers?: Teacher[];
  materials?: Material[];
  forumPosts?: any[];
  discussions?: any[];
  totalDiscussionCount?: number;
  cashPayments?: CashPayment[];
  attendanceList?: AttendanceRecord[];
  activeRole?: 'guru' | 'admin';
  isEntryReady?: boolean;
}

// Data sampel cadangan jika props dari App.tsx belum terhubung
const DEFAULT_TEACHERS_SAMPLE: Partial<Teacher>[] = [
  { id: 't1', name: 'Adi Saiful Rizal, S.Pd', nip: '198905202022211005', gender: 'L', school: 'SDN GELANG 03', role: 'Anggota Aktif' },
  { id: 't2', name: 'Siti Nurul, S.Pd', nip: '199104122023212008', gender: 'P', school: 'SDN GELANG 01', role: 'Anggota Aktif' },
  { id: 't3', name: 'Dwi Rahayu, S.Pd', nip: '198703152020122004', gender: 'P', school: 'SDN GELANG 02', role: 'Anggota Aktif' },
  { id: 't4', name: 'Budi Santoso, S.Pd', nip: '198506102019031002', gender: 'L', school: 'SDN JAMBESARI 01', role: 'Anggota Aktif' },
  { id: 't5', name: 'Ahmad Fauzi, S.Pd', nip: '199308252024211003', gender: 'L', school: 'SDN JATIROTO 01', role: 'Anggota Aktif' },
];

const DEFAULT_MATERIALS_SAMPLE: Partial<Material>[] = [
  { id: 'm1', title: 'Panduan Organisasi PGRI Ranting' },
  { id: 'm2', title: 'Agenda Kerja PGRI Ranting Gelang' },
  { id: 'm3', title: 'Tata Tertib Rapat Anggota' },
];

const useCountUp = (target: number, duration = 500, isActive = true): number => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isActive) {
      setCount(0);
      return;
    }

    let startTime: number | null = null;
    let animationFrameId: number;
    const startValue = 0;

    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(startValue + (target - startValue) * easeOut));

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(step);
      }
    };

    animationFrameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animationFrameId);
  }, [target, duration, isActive]);

  return count;
};

export const BerandaView: React.FC<BerandaViewProps> = ({
  onNavigate,
  events = [],
  onOpenAttendance,
  theme = 'light',
  teachers,
  materials,
  forumPosts,
  discussions,
  totalDiscussionCount,
  cashPayments,
  attendanceList,
  isEntryReady = true
}) => {
  const isLight = theme === 'light';
  const bannerRef = useRef<HTMLDivElement>(null);

  // State Sinkronisasi Data Real-Time
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [expiredEventAlert, setExpiredEventAlert] = useState<ActivityEvent | null>(null);
  const [logoKombel, setLogoKombel] = useState<string | null>(() =>
    typeof window !== 'undefined' ? (localStorage.getItem('logo-pgri') || localStorage.getItem('logo-kombel')) : null
  );

  const readKepalaSekolahCount = (): number => {
    try {
      const schools = getOrgConfig().schools;
      if (Array.isArray(schools)) {
        return schools.filter((s) => String(s || '').trim() !== '').length;
      }
    } catch {}
    return 0;
  };

  const readPengurusCount = (): number => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('kombel-pengurus') : null;
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter((item: any) => {
            const name = String(item?.name || '').trim();
            const lower = name.toLowerCase();
            return name !== '' && lower !== '-' && !lower.startsWith('semua ');
          }).length;
        }
      }
    } catch {}
    // Default jumlah Pengurus dari PengaturanView (DEFAULT_PENGURUS tanpa 'Semua Kepala Sekolah')
    return 9;
  };

  const [kepalaSekolahCount, setKepalaSekolahCount] = useState<number>(() => readKepalaSekolahCount());
  const [pengurusCount, setPengurusCount] = useState<number>(() => readPengurusCount());

  useEffect(() => {
    const syncLogoAndOrgCounts = () => {
      setLogoKombel(localStorage.getItem('logo-pgri') || localStorage.getItem('logo-kombel'));
      setKepalaSekolahCount(readKepalaSekolahCount());
      setPengurusCount(readPengurusCount());
    };
    syncLogoAndOrgCounts();
    window.addEventListener('storage', syncLogoAndOrgCounts);
    window.addEventListener('kombel-settings-updated', syncLogoAndOrgCounts);
    return () => {
      window.removeEventListener('storage', syncLogoAndOrgCounts);
      window.removeEventListener('kombel-settings-updated', syncLogoAndOrgCounts);
    };
  }, []);
  
  const [localAttendance, setLocalAttendance] = useState<AttendanceRecord[]>(() => {
    if (attendanceList && attendanceList.length > 0) return attendanceList;
    try {
      const saved = localStorage.getItem('kombel-attendance') || localStorage.getItem('kombel-attendance-list');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [localCashPayments, setLocalCashPayments] = useState<CashPayment[]>(() => {
    if (cashPayments && cashPayments.length > 0) return cashPayments;
    try {
      const saved = localStorage.getItem('kombel-cashPayments') || localStorage.getItem('kombel-cash-payments');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [selectedMembersByEvent, setSelectedMembersByEvent] = useState<Record<string, string[]>>(() => {
    try {
      const saved = localStorage.getItem('kombel-event-selected-members');
      const parsed: Record<string, string[]> = saved ? JSON.parse(saved) : {};
      if (events && events.length > 0) {
        events.forEach(evt => {
          if ((evt as any).selectedMemberIds && Array.isArray((evt as any).selectedMemberIds)) {
            if (!parsed[evt.id]) {
              parsed[evt.id] = (evt as any).selectedMemberIds;
            }
          }
        });
      }
      return parsed;
    } catch {
      return {};
    }
  });

  useEffect(() => {
    if (events && events.length > 0) {
      setSelectedMembersByEvent(prev => {
        let changed = false;
        const next = { ...prev };
        events.forEach(evt => {
          if ((evt as any).selectedMemberIds && Array.isArray((evt as any).selectedMemberIds)) {
            const newIds = (evt as any).selectedMemberIds;
            const currentIds = next[evt.id];
            if (!currentIds || JSON.stringify(currentIds) !== JSON.stringify(newIds)) {
              next[evt.id] = newIds;
              changed = true;
            }
          }
        });
        return changed ? next : prev;
      });
    }
  }, [events]);

  // Sinkronisasi Data via event storage (tanpa JSON.parse berulang tiap detik) & live clock
  useEffect(() => {
    const syncLocalData = () => {
      try {
        const savedAtt = localStorage.getItem('kombel-attendance') || localStorage.getItem('kombel-attendance-list');
        if (savedAtt) setLocalAttendance(JSON.parse(savedAtt));

        const savedCash = localStorage.getItem('kombel-cashPayments') || localStorage.getItem('kombel-cash-payments');
        if (savedCash) setLocalCashPayments(JSON.parse(savedCash));

        const savedSelectedMembers = localStorage.getItem('kombel-event-selected-members');
        if (savedSelectedMembers) setSelectedMembersByEvent(JSON.parse(savedSelectedMembers));
      } catch (e) {
        console.warn("Gagal melakukan sync storage", e);
      }
    };

    syncLocalData();
    window.addEventListener('storage', syncLocalData);
    window.addEventListener('kombel-settings-updated', syncLocalData);

    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => {
      clearInterval(timer);
      window.removeEventListener('storage', syncLocalData);
      window.removeEventListener('kombel-settings-updated', syncLocalData);
    };
  }, []);

  // Helper konversi tanggal event ke objek Date untuk sorting & komparasi
  const getEventDateObj = (evt: ActivityEvent): Date => {
    let year = currentTime.getFullYear();
    let month = currentTime.getMonth();
    let day = currentTime.getDate();

    const dateStr = (evt.fullDate || evt.date || '').toLowerCase();

    const matchYear = dateStr.match(/\b(20\d{2})\b/);
    if (matchYear) year = parseInt(matchYear[1], 10);

    const matchDay = dateStr.match(/\b(\d{1,2})\b/);
    if (matchDay) day = parseInt(matchDay[1], 10);

    const months = ['jan', 'feb', 'mar', 'apr', 'mei', 'jun', 'jul', 'agu', 'sep', 'okt', 'nov', 'des'];
    const mIndex = months.findIndex(m => dateStr.includes(m));
    if (mIndex !== -1) {
      month = mIndex;
    } else {
      const dateParts = dateStr.split(/[-/]/);
      if (dateParts.length >= 2) {
        if (dateParts[0].length === 4) {
          year = parseInt(dateParts[0], 10);
          month = parseInt(dateParts[1], 10) - 1;
          day = parseInt(dateParts[2], 10);
        } else {
          day = parseInt(dateParts[0], 10);
          month = parseInt(dateParts[1], 10) - 1;
          if (dateParts.length === 3) year = parseInt(dateParts[2], 10);
        }
      }
    }

    return new Date(year, month, day);
  };

  // Helper mendapatkan waktu mulai kegiatan (Start Time)
  const getEventStartDateTime = (evt: ActivityEvent): Date | null => {
    if (!evt) return null;

    let year = currentTime.getFullYear();
    let month = currentTime.getMonth();
    let day = currentTime.getDate();

    const dateStr = (evt.fullDate || evt.date || '').toLowerCase();

    const matchYear = dateStr.match(/\b(20\d{2})\b/);
    if (matchYear) year = parseInt(matchYear[1], 10);

    const matchDay = dateStr.match(/\b(\d{1,2})\b/);
    if (matchDay) day = parseInt(matchDay[1], 10);

    const months = ['jan', 'feb', 'mar', 'apr', 'mei', 'jun', 'jul', 'agu', 'sep', 'okt', 'nov', 'des'];
    const mIndex = months.findIndex(m => dateStr.includes(m));
    if (mIndex !== -1) month = mIndex;
    else {
      const dateParts = dateStr.split(/[-/]/);
      if (dateParts.length >= 2) {
        if (dateParts[0].length === 4) {
          year = parseInt(dateParts[0], 10);
          month = parseInt(dateParts[1], 10) - 1;
          day = parseInt(dateParts[2], 10);
        } else {
          day = parseInt(dateParts[0], 10);
          month = parseInt(dateParts[1], 10) - 1;
          if (dateParts.length === 3) year = parseInt(dateParts[2], 10);
        }
      }
    }

    let hours = 0;
    let minutes = 0;
    if (evt.time) {
      const timeMatches = Array.from(String(evt.time).matchAll(/(\d{1,2})[:.](\d{2})/g));
      if (timeMatches.length > 0) {
        hours = parseInt(timeMatches[0][1], 10);
        minutes = parseInt(timeMatches[0][2], 10);
      }
    }

    const startDate = new Date(year, month, day, hours, minutes, 0);
    return isNaN(startDate.getTime()) ? null : startDate;
  };

  // Helper mendapatkan batas waktu selesai kegiatan (End Time)
  const getEventEndDateTime = (evt: ActivityEvent): Date | null => {
    if (!evt) return null;

    let year = currentTime.getFullYear();
    let month = currentTime.getMonth();
    let day = currentTime.getDate();

    const dateStr = (evt.fullDate || evt.date || '').toLowerCase();

    const matchYear = dateStr.match(/\b(20\d{2})\b/);
    if (matchYear) year = parseInt(matchYear[1], 10);

    const matchDay = dateStr.match(/\b(\d{1,2})\b/);
    if (matchDay) day = parseInt(matchDay[1], 10);

    const months = ['jan', 'feb', 'mar', 'apr', 'mei', 'jun', 'jul', 'agu', 'sep', 'okt', 'nov', 'des'];
    const mIndex = months.findIndex(m => dateStr.includes(m));
    if (mIndex !== -1) month = mIndex;
    else {
      const dateParts = dateStr.split(/[-/]/);
      if (dateParts.length >= 2) {
        if (dateParts[0].length === 4) {
          year = parseInt(dateParts[0], 10);
          month = parseInt(dateParts[1], 10) - 1;
          day = parseInt(dateParts[2], 10);
        } else {
          day = parseInt(dateParts[0], 10);
          month = parseInt(dateParts[1], 10) - 1;
          if (dateParts.length === 3) year = parseInt(dateParts[2], 10);
        }
      }
    }

    let hours = 23;
    let minutes = 59;
    if (evt.time) {
      const tLow = String(evt.time).toLowerCase();
      if (tLow.includes('selesai')) {
        hours = 23;
        minutes = 59;
      } else {
        const timeMatches = Array.from(String(evt.time).matchAll(/(\d{1,2})[:.](\d{2})/g));
        if (timeMatches.length > 1) {
          const lastMatch = timeMatches[timeMatches.length - 1];
          hours = parseInt(lastMatch[1], 10);
          minutes = parseInt(lastMatch[2], 10);
        } else if (timeMatches.length === 1) {
          hours = 23;
          minutes = 59;
        }
      }
    }

    const endDate = new Date(year, month, day, hours, minutes, 0);
    return isNaN(endDate.getTime()) ? null : endDate;
  };

  // Helper status dan countdown kegiatan
  const getEventCountdownOrStatus = (evt: ActivityEvent) => {
    const start = getEventStartDateTime(evt);
    const end = getEventEndDateTime(evt);
    const now = currentTime.getTime();

    if (end && now > end.getTime()) {
      return { text: 'Sudah Selesai', isFinished: true, isOngoing: false, isCountdown: false };
    }

    if (start && now >= start.getTime() && (!end || now <= end.getTime())) {
      return { text: 'Sedang berlangsung', isFinished: false, isOngoing: true, isCountdown: false };
    }

    if (start && now < start.getTime()) {
      const diff = start.getTime() - now;
      const totalSeconds = Math.floor(diff / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      const pad = (n: number) => String(n).padStart(2, '0');
      return { 
        h: pad(hours),
        m: pad(minutes),
        s: pad(seconds),
        text: `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`, 
        isFinished: false, 
        isOngoing: false, 
        isCountdown: true,
        isUrgent: totalSeconds <= 3600
      };
    }

    return { text: 'Sudah Selesai', isFinished: true, isOngoing: false, isCountdown: false, isUrgent: false };
  };

  // Handler klik Absen dengan validasi batas waktu
  const handleAttendanceClick = (evt: ActivityEvent) => {
    const eventEnd = getEventEndDateTime(evt);
    const now = new Date();

    if (eventEnd && now.getTime() > eventEnd.getTime()) {
      setExpiredEventAlert(evt);
      return;
    }

    onOpenAttendance(evt);
  };

  // Helper gender
  const getTeacherGender = (t: Partial<Teacher> & Record<string, any>): 'L' | 'P' => {
    if (!t) return 'L';
    if (t.gender) return t.gender;
    const femaleNames = ['Siti', 'Rina', 'Dewi', 'Sri', 'Nurul', 'Fitriani', 'Lilik', 'Maya', 'Anisa', 'Yulia', 'Titin', 'Dwi', 'Neni', 'Ratna', 'Ika', 'Indah'];
    return femaleNames.some(n => t.name && t.name.includes(n)) ? 'P' : 'L';
  };

  // Data Terkini yang disinkronisasi
  const effectiveTeachers = (teachers && teachers.length > 0) ? teachers : (DEFAULT_TEACHERS_SAMPLE as Teacher[]);
  const effectiveAttendanceList = (attendanceList && attendanceList.length > 0) ? attendanceList : localAttendance;
  const effectiveCashPayments = (cashPayments && cashPayments.length > 0) ? cashPayments : localCashPayments;

  // Helper status keaktifan anggota
  const isMemberActive = (t: Partial<Teacher> & Record<string, any>): boolean => {
    if (!t) return false;
    if (t.isActive !== undefined) return Boolean(t.isActive);
    if (t.activeStatus !== undefined) return t.activeStatus === 'Aktif' || t.activeStatus === true;
    if (t.status !== undefined) return t.status === 'Aktif' || t.status === 'active';
    return true;
  };

  // FILTER GLOBAL UNTUK MENGAMBIL ANGGOTA AKTIF SAJA
  const activeTeachersList = effectiveTeachers.filter(isMemberActive);

  // Daftar Gabungan Anggota Aktif + Pengurus Wajib Kontribusi (Sinkron 100% dengan KeuanganView)
  const cashContributionMembersList = useMemo(() => {
    const fallbackPengurus = [
      { id: 'pengurus-1', name: 'Umar Ali Kusuma', nip: '198912092025211092', school: 'SDN GELANG 03', gender: 'L', kategoriProfil: 'Pengurus Ranting' },
      { id: 'pengurus-2', name: 'Hartatik, S.Pd', nip: '198301072022212001', school: 'SDN KALIGLAGAH 02', gender: 'P', kategoriProfil: 'Pengurus Ranting' },
      { id: 'pengurus-3', name: 'Adi Saiful Rizal, S.Pd', nip: '199401162025211089', school: 'SDN GELANG 03', gender: 'L', kategoriProfil: 'Pengurus Ranting' },
      { id: 'pengurus-4', name: 'Atik Andriyati, S.Pd', nip: '197701142014122002', school: 'SDN GELANG 06', gender: 'P', kategoriProfil: 'Pengurus Ranting' },
      { id: 'pengurus-5', name: 'Saiful Arif, S.Pd', nip: '198604122022211003', school: 'SDN GELANG 07', gender: 'L', kategoriProfil: 'Pengurus Ranting' },
      { id: 'pengurus-6', name: 'Siti Oktavia, S.Pd', nip: '197910072022212001', school: 'SDN GELANG 04', gender: 'P', kategoriProfil: 'Pengurus Ranting' },
      { id: 'pengurus-7', name: 'Rohman, S.Pd', nip: '198904202022211002', school: 'SDN KALIGLAGAH 02', gender: 'L', kategoriProfil: 'Pengurus Ranting' },
      { id: 'pengurus-8', name: 'Jasuri Budianto, S.Pd', nip: '196918082022211001', school: 'SDN GELANG 01', gender: 'L', kategoriProfil: 'Pengurus Ranting' },
      { id: 'pengurus-9', name: 'Muhammad Jupri, S.Pd.I', nip: '', school: 'SD NU 21 MIFTAHUL ULUM', gender: 'L', kategoriProfil: 'Pengurus Ranting' },
      { id: 'pj-1', name: 'Ghufron Atok Urrohman, S.Pd', nip: '197805192014121003', school: 'Ketua Kelompok Kerja Kepala Sekolah', gender: 'L', kategoriProfil: 'Penanggung Jawab' },
      { id: 'pj-2', name: 'Christian Dri Firman Widodo, S.Pd', nip: '198012262014121002', school: 'Ketua PGRI Cabang Kecamatan Sumberbaru', gender: 'L', kategoriProfil: 'Penanggung Jawab' },
      { id: 'pembina-1', name: 'Hanifatul Susmiyah, S.Pd', nip: '197306022002122005', school: 'Pengawas Bina Kecamatan Sumberbaru', gender: 'P', kategoriProfil: 'Pembina' },
    ];

    let candidates: any[] = [];
    let selectedNames: string[] = fallbackPengurus
      .filter(f => f.kategoriProfil === 'Pengurus Ranting')
      .map(f => f.name.trim().toLowerCase());

    if (typeof window !== 'undefined') {
      try {
        const savedPengurus = localStorage.getItem('kombel-pengurus');
        if (savedPengurus) {
          const parsed = JSON.parse(savedPengurus);
          if (Array.isArray(parsed)) {
            parsed.forEach((p: any, idx: number) => {
              const nm = String(p?.name || '').trim();
              if (!nm || nm === '-' || nm.toLowerCase().startsWith('semua ')) return;
              candidates.push({
                id: p.id || `pengurus-${idx + 1}`,
                name: nm,
                nip: p.nip && p.nip !== '-' ? p.nip : '',
                school: p.instansi && p.instansi !== '-' ? p.instansi : 'PGRI Ranting Gelang',
                gender: p.gender
              });
            });
          }
        }
        const savedPj = localStorage.getItem('kombel-penanggungjawab');
        if (savedPj) {
          const parsed = JSON.parse(savedPj);
          if (Array.isArray(parsed)) {
            parsed.forEach((p: any, idx: number) => {
              const nm = String(p?.name || '').trim();
              if (!nm || nm === '-' || nm.toLowerCase().startsWith('semua ')) return;
              if (!candidates.some(c => c.name.trim().toLowerCase() === nm.toLowerCase())) {
                candidates.push({
                  id: `pj-${idx + 1}`,
                  name: nm,
                  nip: p.nip && p.nip !== '-' ? p.nip : '',
                  school: p.instansi && p.instansi !== '-' ? p.instansi : 'Penanggung Jawab',
                  gender: p.gender
                });
              }
            });
          }
        }
        const savedPembina = localStorage.getItem('kombel-pembina');
        if (savedPembina) {
          const parsed = JSON.parse(savedPembina);
          const nm = String(parsed?.name || '').trim();
          if (nm && nm !== '-' && !nm.toLowerCase().startsWith('semua ')) {
            if (!candidates.some(c => c.name.trim().toLowerCase() === nm.toLowerCase())) {
              candidates.push({
                id: 'pembina-1',
                name: nm,
                nip: parsed.nip && parsed.nip !== '-' ? parsed.nip : '',
                school: parsed.instansi && parsed.instansi !== '-' ? parsed.instansi : 'Pembina',
                gender: parsed.gender
              });
            }
          }
        }
        const savedSelected = localStorage.getItem('pgri-verified-pengurus-names');
        if (savedSelected) {
          const parsedSel = JSON.parse(savedSelected);
          if (Array.isArray(parsedSel)) selectedNames = parsedSel;
        }
      } catch {}
    }

    fallbackPengurus.forEach(f => {
      if (!candidates.some(c => c.name.trim().toLowerCase() === f.name.trim().toLowerCase())) {
        candidates.push(f);
      }
    });

    const activePengurus = candidates.filter(c => selectedNames.includes(c.name.trim().toLowerCase()));
    const normalizeName = (name?: string) =>
      (name || '').replace(/(,?\s*(S\.Pd\.I|S\.Pd|M\.Pd|S\.Kom|M\.Si|Dr|Dra|Drs)\.?)/gi, '').trim().toLowerCase();

    const combined: any[] = [...activeTeachersList];
    activePengurus.forEach(p => {
      const pNorm = normalizeName(p.name);
      const exists = combined.some(
        c =>
          String(c.id).trim() === String(p.id).trim() ||
          (p.nip && c.nip && String(c.nip).trim() === String(p.nip).trim()) ||
          (pNorm && normalizeName(c.name) === pNorm)
      );
      if (!exists) {
        combined.push(p);
      }
    });

    return combined.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'id', { sensitivity: 'base' }));
  }, [activeTeachersList, localCashPayments, cashPayments]);

  // 1. Hitung jumlah anggota aktif
  const activeTeachersCount = activeTeachersList.length;

  // 2. Hitung jumlah anggota Laki-laki dan Perempuan dari anggota AKTIF
  const maleCount = activeTeachersList.filter(t => getTeacherGender(t) === 'L').length;
  const femaleCount = activeTeachersList.filter(t => getTeacherGender(t) === 'P').length;

  // 3. Hitung jumlah seluruh kegiatan
  const totalEventsCount = events.length;

  // Pengurutan Agenda Kegiatan Berdasarkan Tanggal Terbaru
  const sortedEvents = useMemo(() => {
    return [...(events || [])].sort((a, b) => {
      const timeA = getEventDateObj(a).getTime();
      const timeB = getEventDateObj(b).getTime();
      return timeB - timeA;
    });
  }, [events]);

  // Daftar Bulan & Rentang Periode (Dari Bulan Awal Pembayaran s.d. Bulan Sekarang)
  const CASH_MONTH_OPTIONS = useMemo(() => [
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

  const [duesStartPeriod, setDuesStartPeriod] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('pgri-dues-start-period');
      if (saved && /^\d{4}-\d{2}$/.test(saved)) return saved;
    }
    return '2026-11';
  });

  const nowYearStr = String(currentTime.getFullYear());
  const nowMonthStr = String(currentTime.getMonth() + 1).padStart(2, '0');
  const nowPeriodCode = `${nowYearStr}-${nowMonthStr}`;

  // Batas maksimum periode dropdown: nilai terjauh antara bulan sekarang & pembayaran lunas terjauh di Keuangan
  const maxCashDropdownPeriod = useMemo(() => {
    let maxCode = nowPeriodCode < duesStartPeriod ? duesStartPeriod : nowPeriodCode;
    effectiveCashPayments.forEach(cp => {
      if (cp?.status !== 'Lunas') return;
      const rawKey = String((cp as any).month || (cp as any).eventId || '').replace(/^month-/, '').trim();
      if (/^\d{4}-\d{2}$/.test(rawKey) && rawKey > maxCode) {
        maxCode = rawKey;
      }
    });
    return maxCode;
  }, [effectiveCashPayments, nowPeriodCode, duesStartPeriod]);

  const cashYearOptions = useMemo(() => {
    const startYr = Number(duesStartPeriod.split('-')[0]) || currentTime.getFullYear();
    const endYr = Number(maxCashDropdownPeriod.split('-')[0]) || currentTime.getFullYear();
    const years: string[] = [];
    for (let y = startYr; y <= Math.max(startYr, endYr); y++) {
      years.push(String(y));
    }
    return years;
  }, [duesStartPeriod, maxCashDropdownPeriod, nowYearStr]);

  // State untuk filter jadwal pada kotak Kehadiran & Tab Status Kontribusi (Default: Bulan & Tahun Sekarang)
  const [selectedAttendanceEventId, setSelectedAttendanceEventId] = useState<string>('');
  const [cashFilterTab, setCashFilterTab] = useState<'unpaid' | 'paid'>('unpaid');
  const [selectedCashYear, setSelectedCashYear] = useState<string>(() => {
    const curCode = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const saved = typeof window !== 'undefined' ? localStorage.getItem('pgri-dues-start-period') : null;
    const startCode = saved && /^\d{4}-\d{2}$/.test(saved) ? saved : '2026-11';
    return (curCode < startCode ? startCode : curCode).split('-')[0];
  });
  const [selectedCashMonth, setSelectedCashMonth] = useState<string>(() => {
    const curCode = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const saved = typeof window !== 'undefined' ? localStorage.getItem('pgri-dues-start-period') : null;
    const startCode = saved && /^\d{4}-\d{2}$/.test(saved) ? saved : '2026-11';
    return (curCode < startCode ? startCode : curCode).split('-')[1];
  });

  // Daftar bulan valid pada tahun terpilih (mulai dari bulan awal pembayaran s.d. periode terjauh yang sudah dibayar)
  const validCashMonthsForSelectedYear = useMemo(() => {
    return CASH_MONTH_OPTIONS.filter(m => {
      const code = `${selectedCashYear}-${m.id}`;
      return code >= duesStartPeriod && code <= maxCashDropdownPeriod;
    });
  }, [CASH_MONTH_OPTIONS, selectedCashYear, duesStartPeriod, maxCashDropdownPeriod]);

  useEffect(() => {
    const syncDuesStart = () => {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('pgri-dues-start-period');
        if (saved && /^\d{4}-\d{2}$/.test(saved)) {
          setDuesStartPeriod(saved);
        }
      }
    };
    window.addEventListener('storage', syncDuesStart);
    window.addEventListener('kombel-settings-updated', syncDuesStart);
    return () => {
      window.removeEventListener('storage', syncDuesStart);
      window.removeEventListener('kombel-settings-updated', syncDuesStart);
    };
  }, []);

  // Jaga agar tahun & bulan terpilih selalu berada dalam rentang [bulan awal pembayaran .. periode terjauh]
  useEffect(() => {
    const currentSelectedCode = `${selectedCashYear}-${selectedCashMonth}`;
    if (currentSelectedCode < duesStartPeriod || currentSelectedCode > maxCashDropdownPeriod) {
      const fallbackCode = nowPeriodCode >= duesStartPeriod && nowPeriodCode <= maxCashDropdownPeriod ? nowPeriodCode : maxCashDropdownPeriod;
      const [validY, validM] = fallbackCode.split('-');
      setSelectedCashYear(validY);
      setSelectedCashMonth(validM);
    }
  }, [duesStartPeriod, maxCashDropdownPeriod, nowPeriodCode, selectedCashYear, selectedCashMonth]);

  useEffect(() => {
    if (sortedEvents.length > 0) {
      if (!selectedAttendanceEventId || !sortedEvents.some(e => e.id === selectedAttendanceEventId)) {
        setSelectedAttendanceEventId(sortedEvents[0].id);
      }
    } else {
      setSelectedAttendanceEventId('');
    }
  }, [sortedEvents, selectedAttendanceEventId]);

  // Helper cek status pembayaran anggota pada Tahun & Bulan terpilih (YYYY-MM)
  const isTeacherPaidForSelectedMonth = (teacher: Partial<Teacher>): boolean => {
    const yearMonthCode = `${selectedCashYear}-${selectedCashMonth}`;
    const targetKey = `month-${yearMonthCode}`;
    const tId = String(teacher.id || '').trim();
    const tName = (teacher.name || '').trim().toLowerCase();

    const payment = effectiveCashPayments.find(cp => {
      const cpKey = String((cp as any).month || (cp as any).eventId || '').trim();
      const isSamePeriod = cpKey === targetKey || cpKey === yearMonthCode;
      const isSameTeacher =
        (cp.teacherId && String(cp.teacherId).trim() === tId) ||
        (tName && (cp as any).teacherName && String((cp as any).teacherName).trim().toLowerCase() === tName);
      return isSamePeriod && isSameTeacher;
    });

    return payment?.status === 'Lunas';
  };

  // Helper menghitung total bulan tunggakan jatuh tempo (dari bulan awal pembayaran s.d. bulan kalender sekarang)
  const getTeacherUnpaidMonthsCount = (teacher: Partial<Teacher>): number => {
    if (nowPeriodCode < duesStartPeriod) return 0;
    const [startY, startM] = duesStartPeriod.split('-').map(Number);
    const [endY, endM] = nowPeriodCode.split('-').map(Number);
    if (!startY || !startM || !endY || !endM) return 0;

    const tId = String(teacher.id || '').trim();
    const tName = (teacher.name || '').trim().toLowerCase();
    let unpaidMonths = 0;

    let y = startY;
    let m = startM;
    while (y < endY || (y === endY && m <= endM)) {
      const ymCode = `${y}-${String(m).padStart(2, '0')}`;
      const targetKey = `month-${ymCode}`;
      const payment = effectiveCashPayments.find(cp => {
        const cpKey = String((cp as any).month || (cp as any).eventId || '').trim();
        const isSamePeriod = cpKey === targetKey || cpKey === ymCode;
        const isSameTeacher =
          (cp.teacherId && String(cp.teacherId).trim() === tId) ||
          (tName && (cp as any).teacherName && String((cp as any).teacherName).trim().toLowerCase() === tName);
        return isSamePeriod && isSameTeacher;
      });
      if (payment?.status !== 'Lunas') {
        unpaidMonths += 1;
      }
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }

    return unpaidMonths;
  };

  // Data anggota & pengurus wajib kontribusi yang BELUM BAYAR kas pada bulan & tahun terpilih
  const unpaidTeachers = useMemo(() => {
    return [...cashContributionMembersList]
      .filter(t => !isTeacherPaidForSelectedMonth(t))
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'id', { sensitivity: 'base' }));
  }, [cashContributionMembersList, effectiveCashPayments, selectedCashYear, selectedCashMonth]);

  const unpaidMaleTeachers = useMemo(() => {
    return unpaidTeachers.filter(t => getTeacherGender(t) === 'L');
  }, [unpaidTeachers]);

  const unpaidFemaleTeachers = useMemo(() => {
    return unpaidTeachers.filter(t => getTeacherGender(t) === 'P');
  }, [unpaidTeachers]);

  // Data anggota & pengurus wajib kontribusi yang SUDAH LUNAS kas pada bulan & tahun terpilih
  const paidTeachers = useMemo(() => {
    return [...cashContributionMembersList]
      .filter(t => isTeacherPaidForSelectedMonth(t))
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'id', { sensitivity: 'base' }));
  }, [cashContributionMembersList, effectiveCashPayments, selectedCashYear, selectedCashMonth]);

  const paidMaleTeachers = useMemo(() => {
    return paidTeachers.filter(t => getTeacherGender(t) === 'L');
  }, [paidTeachers]);

  const paidFemaleTeachers = useMemo(() => {
    return paidTeachers.filter(t => getTeacherGender(t) === 'P');
  }, [paidTeachers]);

  const totalCashMembersCount = cashContributionMembersList.length;
  const paidTeachersCount = paidTeachers.length;
  const cashPaidPercentage = totalCashMembersCount > 0 ? Math.round((paidTeachersCount / totalCashMembersCount) * 100) : 0;

  // Helper kandidat peserta (Profil Kombel: Pembina, Penanggung Jawab, Pengurus + Daftar Anggota)
  const getAllCandidateMembers = useMemo(() => {
    let pembinaData = {
      name: 'Hanifatul Susmiyah, S.Pd',
      nip: '197306022002122005',
      school: 'Pengawas Bina Kecamatan Sumberbaru',
      role: 'Pengawas Bina',
      phone: '6285859083645'
    };
    try {
      const saved = localStorage.getItem('kombel-pembina');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.name) {
          pembinaData = {
            name: parsed.name,
            nip: parsed.nip || pembinaData.nip,
            school: parsed.instansi || parsed.school || pembinaData.school,
            role: parsed.role || pembinaData.role,
            phone: parsed.wa || parsed.phone || pembinaData.phone
          };
        }
      }
    } catch {}

    let pjData = [
      {
        name: 'Ghufron Atok Urrohman, S.Pd',
        nip: '197805192014121003',
        school: 'Ketua Kelompok Kerja Kepala Sekolah',
        role: 'Ketua K3S',
        phone: '6285859342500'
      },
      {
        name: 'Christian Dri Firman Widodo, S.Pd',
        nip: '198012262014121002',
        school: 'Penanggungjawab PGRI Cabang Sumberbaru',
        role: 'Penanggungjawab',
        phone: '6281217910263'
      }
    ];
    try {
      const saved = localStorage.getItem('kombel-penanggungjawab');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          pjData = parsed.map((p: any) => ({
            name: p.name || '',
            nip: p.nip || '-',
            school: p.instansi || p.school || '-',
            role: p.role || 'Penanggung Jawab',
            phone: p.wa || p.phone || '-'
          }));
        }
      }
    } catch {}

    let pengurusData = [
      {
        name: 'Umar Ali Kusuma',
        nip: '198912092025211092',
        school: 'SDN Gelang 03',
        role: 'Ketua PGRI Ranting Gelang',
        phone: '-'
      },
      {
        name: 'Hartatik, S.Pd',
        nip: '-',
        school: 'SDN Gelang 01',
        role: 'Wakil Ketua',
        phone: '-'
      },
      {
        name: 'Adi Saiful Rizal, S.Pd',
        nip: '199401162025211089',
        school: 'SDN Gelang 03',
        role: 'Sekretaris',
        phone: '6282292232649'
      },
      {
        name: 'Atik Andriyati, S.Pd',
        nip: '-',
        school: 'SDN Gelang 04',
        role: 'Bendahara',
        phone: '-'
      },
      {
        name: 'Saiful Arif, S.Pd',
        nip: '-',
        school: 'SDN Gelang 05',
        role: 'Seksi Pembinaan Olahraga',
        phone: '-'
      },
      {
        name: 'Siti Oktavia, S.Pd',
        nip: '-',
        school: 'SDN Gelang 06',
        role: 'Seksi Pemberdayaan Perempuan',
        phone: '-'
      },
      {
        name: 'Rohman, S.Pd',
        nip: '-',
        school: 'SDN Gelang 07',
        role: 'Seksi Pengembangan Profesi & Karir',
        phone: '-'
      },
      {
        name: 'Jasuri Budianto, S.Pd',
        nip: '-',
        school: 'SDN Kaliglagah 02',
        role: 'Seksi Humas',
        phone: '-'
      },
      {
        name: 'Muhammad Jupri, S.Pd.I',
        nip: '-',
        school: 'SD NU 21 Miftahul Ulum',
        role: 'Seksi Keagamaan',
        phone: '-'
      }
    ];
    try {
      const saved = localStorage.getItem('kombel-pengurus');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          pengurusData = parsed.map((p: any) => ({
            name: p.name || '',
            nip: p.nip || '-',
            school: p.instansi || p.school || '-',
            role: p.role || 'Pengurus PGRI Ranting',
            phone: p.wa || p.phone || '-'
          }));
        }
      }
    } catch {}

    const rawProfilKombel = [pembinaData, ...pjData, ...pengurusData];
    const seenNames = new Set<string>();
    const profilMembers: Teacher[] = [];

    rawProfilKombel.forEach((p, idx) => {
      const cleanName = (p.name || '').trim();
      const lower = cleanName.toLowerCase();
      if (!cleanName || cleanName === '-' || lower.startsWith('semua ') || seenNames.has(lower)) return;
      seenNames.add(lower);

      const matchInTeachers = (effectiveTeachers || []).find(t =>
        (t.name && t.name.trim().toLowerCase() === lower) ||
        (p.nip && p.nip !== '-' && t.nip && String(t.nip).trim() === String(p.nip).trim())
      );

      profilMembers.push({
        id: matchInTeachers ? String(matchInTeachers.id) : `profil-kombel-${idx}-${p.nip && p.nip !== '-' ? p.nip : cleanName.replace(/\s+/g, '-').toLowerCase()}`,
        name: cleanName,
        school: String(matchInTeachers ? matchInTeachers.school : (p.school || '-')).toUpperCase(),
        nip: matchInTeachers ? (matchInTeachers.nip || p.nip) : (p.nip || '-'),
        role: p.role || (matchInTeachers ? matchInTeachers.role : 'Pengurus PGRI'),
        phone: matchInTeachers ? (matchInTeachers.phone || p.phone) : (p.phone || '-'),
        email: matchInTeachers ? (matchInTeachers.email || '') : '',
        avatar: matchInTeachers ? (matchInTeachers.avatar || '') : ''
      });
    });

    const regularMembers: Teacher[] = [];
    (effectiveTeachers || []).forEach(t => {
      const lower = (t.name || '').trim().toLowerCase();
      if (!seenNames.has(lower)) {
        regularMembers.push(t);
      }
    });

    return [...profilMembers, ...regularMembers];
  }, [effectiveTeachers]);

  // Event terpilih untuk kehadiran
  const currentSelectedAttendanceEvent = useMemo(() => {
    return sortedEvents.find(e => e.id === selectedAttendanceEventId) || sortedEvents[0] || null;
  }, [sortedEvents, selectedAttendanceEventId]);

  // Daftar peserta terceklist pada event terpilih (sinkron dengan JadwalView)
  const selectedEventTargetMembers = useMemo(() => {
    if (!currentSelectedAttendanceEvent) return getAllCandidateMembers;
    let selectedIds: string[] | null = null;
    if ((currentSelectedAttendanceEvent as any).selectedMemberIds && Array.isArray((currentSelectedAttendanceEvent as any).selectedMemberIds)) {
      selectedIds = (currentSelectedAttendanceEvent as any).selectedMemberIds;
    } else if (selectedMembersByEvent[currentSelectedAttendanceEvent.id] !== undefined) {
      selectedIds = selectedMembersByEvent[currentSelectedAttendanceEvent.id];
    }

    if (selectedIds === null) {
      return getAllCandidateMembers;
    }

    const idSet = new Set(selectedIds.map(id => String(id).trim()));
    return getAllCandidateMembers.filter(t =>
      idSet.has(String(t.id).trim()) ||
      (t.name && idSet.has(t.name.trim().toLowerCase()))
    );
  }, [currentSelectedAttendanceEvent, getAllCandidateMembers, selectedMembersByEvent]);

  const selectedEventTargetCount = selectedEventTargetMembers.length;

  // Data Kehadiran Peserta Terceklist (Sinkron 100% dengan JadwalView)
  let hadirCount = 0;
  let sakitCount = 0;
  let izinCount = 0;
  let alphaCount = 0;
  let attendancePercentage = 0;
  let tidakHadirPercentage = 0;

  if (currentSelectedAttendanceEvent) {
    const rawRecords = effectiveAttendanceList.filter(a =>
      (a.eventId && String(a.eventId).trim() === String(currentSelectedAttendanceEvent.id).trim()) ||
      (!a.eventId && a.eventTitle && currentSelectedAttendanceEvent.title && a.eventTitle.trim().toLowerCase() === currentSelectedAttendanceEvent.title.trim().toLowerCase())
    );

    // Deduplikasi per peserta: 1 peserta hanya dihitung 1 kali per kegiatan
    const teacherMap = new Map<string, AttendanceRecord>();
    for (const rec of rawRecords) {
      const key = rec.teacherId ? String(rec.teacherId).trim() : (rec.teacherName || '').trim().toLowerCase();
      if (!key) continue;

      if (!teacherMap.has(key)) {
        teacherMap.set(key, rec);
      } else {
        const existing = teacherMap.get(key)!;
        const priorityOrder: Record<string, number> = {
          'Hadir': 5,
          'Sakit': 4,
          'Izin': 3,
          'Verifikasi': 2,
          'Tugas Luar': 2,
          'Alpha': 1
        };
        if ((priorityOrder[rec.status] || 0) > (priorityOrder[existing.status] || 0)) {
          teacherMap.set(key, rec);
        }
      }
    }

    const eventMemberKeys = new Set([
      ...selectedEventTargetMembers.map(t => String(t.id).trim()),
      ...selectedEventTargetMembers.map(t => (t.name || '').trim().toLowerCase())
    ]);

    const records = Array.from(teacherMap.values()).filter(r =>
      (r.teacherId && eventMemberKeys.has(String(r.teacherId).trim())) ||
      (r.teacherName && eventMemberKeys.has(r.teacherName.trim().toLowerCase()))
    );

    hadirCount = records.filter(a => a.status === 'Hadir').length;
    sakitCount = records.filter(a => a.status === 'Sakit').length;
    izinCount = records.filter(a => a.status === 'Izin').length;

    const submittedTeacherKeys = new Set<string>();
    records.forEach(r => {
      if (r.teacherId) submittedTeacherKeys.add(String(r.teacherId).trim());
      if (r.teacherName) submittedTeacherKeys.add(r.teacherName.trim().toLowerCase());
    });

    const implicitAlphasCount = selectedEventTargetMembers.filter(t =>
      !submittedTeacherKeys.has(String(t.id).trim()) &&
      !submittedTeacherKeys.has((t.name || '').trim().toLowerCase())
    ).length;
    const explicitAlphasCount = records.filter(r => r.status === 'Alpha').length;

    alphaCount = implicitAlphasCount + explicitAlphasCount;

    attendancePercentage = selectedEventTargetCount > 0 ? Math.round((hadirCount / selectedEventTargetCount) * 100) : 0;
    tidakHadirPercentage = selectedEventTargetCount > 0 ? 100 - attendancePercentage : 0;
  }

  // Ringkasan Eksekutif PGRI Ranting: Purna Tugas & Agenda Terdekat
  const currentYearNum = currentTime.getFullYear();
  const retiringSoonTeachers = useMemo(() => {
    return activeTeachersList.filter((t) => {
      const yr = Number(t.retirementYear);
      return !isNaN(yr) && yr >= currentYearNum && yr <= currentYearNum + 1;
    });
  }, [activeTeachersList, currentYearNum]);

  // Animasi Count-Up untuk angka statistik utama (sinkron dengan pembukaan layar loading)
  const animatedActiveTeachers = useCountUp(activeTeachersCount, 550, isEntryReady);
  const animatedTotalEvents = useCountUp(totalEventsCount, 550, isEntryReady);
  const animatedMaleCount = useCountUp(maleCount, 550, isEntryReady);
  const animatedFemaleCount = useCountUp(femaleCount, 550, isEntryReady);
  const animatedKepalaSekolahCount = useCountUp(kepalaSekolahCount, 550, isEntryReady);
  const animatedPengurusCount = useCountUp(pengurusCount, 550, isEntryReady);
  const animatedCashPercentage = useCountUp(cashPaidPercentage, 550, isEntryReady);
  const animatedRetiringCount = useCountUp(retiringSoonTeachers.length, 550, isEntryReady);
  const animatedAttendancePct = useCountUp(attendancePercentage, 550, isEntryReady);
  
  // Helper Render Diagram Donut SVG dengan padding viewBox yang aman dari cropping
  const renderDonut = (pct1: number, pct2: number, stroke1Class: string, stroke2Class: string) => {
    const val1 = isEntryReady ? Math.min(100, Math.max(0, pct1)) : 0;
    const val2 = isEntryReady ? Math.min(100 - val1, Math.max(0, pct2)) : 0;

    return (
      <svg viewBox="0 0 38 38" className="w-40 h-40 sm:w-44 sm:h-44 transform -rotate-90 drop-shadow-sm overflow-visible">
        <circle
          cx="19" cy="19" r="15.9155"
          fill="none"
          className={isLight ? 'stroke-slate-100' : 'stroke-slate-800/80'}
          strokeWidth="4.5"
        />
        {val2 > 0 && (
          <circle
            cx="19" cy="19" r="15.9155"
            fill="none"
            className={`${stroke2Class} transition-all duration-700 ease-out`}
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeDasharray={`${val2} ${100 - val2}`}
            strokeDashoffset={`-${val1}`}
          />
        )}
        {val1 > 0 && (
          <circle
            cx="19" cy="19" r="15.9155"
            fill="none"
            className={`${stroke1Class} transition-all duration-700 ease-out`}
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeDasharray={`${val1} ${100 - val1}`}
            strokeDashoffset="0"
          />
        )}
      </svg>
    );
  };

  const cardBgClass = isLight 
    ? 'bg-white border-stone-200/90 text-stone-800 shadow-[0_2px_12px_rgba(28,25,23,0.04)]' 
    : 'bg-stone-900 border-stone-800 text-stone-100 shadow-[0_2px_16px_rgba(0,0,0,0.28)]';

  const itemBgClass = isLight 
    ? 'bg-[#faf8f5] hover:bg-red-50/50 border-stone-200/80' 
    : 'bg-stone-800/60 hover:bg-stone-800 border-stone-700/60';

  const buttonSubtleClass = isLight 
    ? 'bg-stone-100 hover:bg-red-50 text-red-900' 
    : 'bg-stone-800 hover:bg-stone-700 text-amber-300';

  return (
    <div className={`font-sans space-y-6 ${isEntryReady ? 'beranda-entry-ready animate-in fade-in duration-300' : 'beranda-entry-waiting'}`}>
      
      {/* CSS Animasi & Kustomisasi Scrollbar Ramping dan Modern */}
      <style>{`
        @keyframes bannerEntry {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes colonPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.25; }
        }
        @keyframes progressShimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(250%); }
        }
        .animate-progress-shimmer {
          animation: progressShimmer 2.4s ease-in-out infinite;
        }
        .beranda-entry-waiting .animate-banner-entry,
        .beranda-entry-waiting .stagger-1,
        .beranda-entry-waiting .stagger-2,
        .beranda-entry-waiting .stagger-3,
        .beranda-entry-waiting .stagger-4,
        .beranda-entry-waiting .stagger-5 {
          animation: none !important;
          opacity: 0;
          transform: translateY(10px);
        }
        .animate-banner-entry {
          animation: bannerEntry 0.48s cubic-bezier(0.16, 1, 0.3, 1) 40ms both;
        }
        .animate-colon {
          animation: colonPulse 1s ease-in-out infinite;
        }
        .stagger-1 { animation: bannerEntry 0.48s cubic-bezier(0.16, 1, 0.3, 1) 100ms both; }
        .stagger-2 { animation: bannerEntry 0.48s cubic-bezier(0.16, 1, 0.3, 1) 160ms both; }
        .stagger-3 { animation: bannerEntry 0.48s cubic-bezier(0.16, 1, 0.3, 1) 220ms both; }
        .stagger-4 { animation: bannerEntry 0.48s cubic-bezier(0.16, 1, 0.3, 1) 280ms both; }
        .stagger-5 { animation: bannerEntry 0.48s cubic-bezier(0.16, 1, 0.3, 1) 340ms both; }
        @media (prefers-reduced-motion: reduce) {
          .beranda-entry-waiting .animate-banner-entry,
          .beranda-entry-waiting .stagger-1,
          .beranda-entry-waiting .stagger-2,
          .beranda-entry-waiting .stagger-3,
          .beranda-entry-waiting .stagger-4,
          .beranda-entry-waiting .stagger-5 {
            opacity: 1;
            transform: none;
          }
          .animate-banner-entry,
          .stagger-1,
          .stagger-2,
          .stagger-3,
          .stagger-4,
          .stagger-5 {
            animation: none !important;
          }
        }
        .custom-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: ${isLight ? '#d6d3d1 transparent' : '#44403c transparent'};
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: ${isLight ? 'rgba(214, 211, 209, 0.85)' : 'rgba(68, 64, 60, 0.85)'};
          border-radius: 9999px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: ${isLight ? 'rgba(168, 162, 158, 1)' : 'rgba(87, 83, 78, 1)'};
        }
      `}</style>

      {/* 1. Hero Welcome Banner — Wibawa Kusuma Bangsa */}
      <div
        ref={bannerRef}
        id="welcome-banner"
        className={`rounded-2xl p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 relative overflow-hidden group animate-banner-entry min-h-[200px] sm:min-h-[164px] border ${
          isLight
            ? 'bg-gradient-to-br from-[#fdfbf7] via-white to-red-50/60 border-stone-200/90 text-stone-900 shadow-[0_6px_24px_rgba(127,29,29,0.07)] pgri-batik-pattern'
            : 'bg-gradient-to-br from-[#231214] via-stone-900 to-[#1a1112] border-red-900/40 text-stone-100 shadow-[0_10px_28px_rgba(0,0,0,0.45)] pgri-batik-pattern-dark'
        }`}
      >
        <div className="absolute top-0 inset-x-0 h-[3px] pgri-top-accent pointer-events-none" />

        {/* Subtle Institutional Corner Accent */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl select-none">
          <div className={`absolute -right-24 -bottom-24 w-72 h-72 rounded-full blur-3xl ${
            isLight ? 'bg-amber-500/10' : 'bg-red-700/15'
          }`} />
        </div>

        {/* Bagian Kiri: Logo & Information */}
        <div className="flex gap-4 sm:gap-5 items-center relative z-10">
          <div className="relative flex items-center justify-center shrink-0">
            <div className={`w-20 h-20 sm:w-24 sm:h-24 rounded-2xl flex items-center justify-center shrink-0 overflow-hidden relative z-10 border backdrop-blur-md transition-transform duration-300 group-hover:scale-[1.03] ${
              isLight
                ? 'bg-white/95 border-red-200/90 ring-4 ring-amber-500/10 text-red-800 shadow-[0_8px_20px_rgba(127,29,29,0.12)]'
                : 'bg-red-950/70 border-amber-500/30 ring-4 ring-amber-500/10 text-amber-300 shadow-[0_8px_24px_rgba(0,0,0,0.5)]'
            }`}>
              {logoKombel ? (
                <img src={logoKombel} alt="Logo PGRI" className="w-full h-full object-cover" />
              ) : (
                <Sparkles className={`w-10 h-10 sm:w-12 sm:h-12 ${
                  isLight ? 'text-red-800' : 'text-amber-400'
                }`} />
              )}
            </div>
          </div>

          <div className="flex flex-col justify-center">
            <div className="flex items-center gap-2">
              <h1 className={`font-display font-extrabold text-2xl sm:text-3xl md:text-4xl tracking-tight ${
                isLight ? 'text-stone-900' : 'text-white'
              }`}>
                Selamat Datang!
              </h1>
            </div>

            <h2 className="text-base sm:text-xl md:text-2xl font-extrabold mt-0.5">
              <span className={`font-display ${
                isLight ? 'text-red-800' : 'text-amber-300'
              }`}>
                di PGRI Ranting Gelang
              </span>
            </h2>

            <div className="flex items-center gap-1.5 mt-1.5">
              <Cpu className={`w-3.5 h-3.5 shrink-0 ${isLight ? 'text-amber-700' : 'text-amber-400'}`} />
              <span className={`text-[10px] sm:text-xs font-bold tracking-wider block ${
                isLight ? 'text-stone-500' : 'text-stone-400'
              }`}>
                Integritas, Solidaritas, &amp; Profesionalitas
              </span>
            </div>
          </div>
        </div>

        {/* Bagian Kanan: Action Buttons */}
        <div className="flex flex-col md:flex-col items-center md:items-end justify-center gap-3 shrink-0 relative z-10 w-full sm:w-auto">
          <div className="flex flex-row md:flex-col gap-2.5 w-full sm:w-auto justify-center">
            <button
              onClick={() => onNavigate('jadwal')}
              className="flex-1 sm:flex-none sm:w-auto px-3 sm:px-5 py-2.5 rounded-xl bg-red-800 hover:bg-red-700 text-white font-bold text-xs sm:text-sm shadow-sm active:scale-95 flex items-center justify-center gap-2 transition-colors cursor-pointer shrink-0"
            >
              <Calendar className="w-4 h-4 stroke-[2.2]" />
              <span className="tracking-wide whitespace-nowrap">Jadwal &amp; Absensi</span>
            </button>

            <a
              href="https://ruangpembelajaran.ai.studio/"
              target="_blank"
              rel="noopener noreferrer"
              className={`flex-1 sm:flex-none sm:w-auto px-3 sm:px-4 py-2.5 rounded-xl border font-semibold text-xs sm:text-sm active:scale-95 flex items-center justify-center gap-2 transition-colors cursor-pointer shrink-0 shadow-sm no-underline ${
                isLight
                  ? 'bg-white border-stone-300 hover:border-red-300 text-stone-800 hover:bg-red-50/40'
                  : 'bg-stone-800/90 border-stone-700 hover:border-amber-500/40 text-stone-200 hover:bg-stone-800'
              }`}
            >
              <ExternalLink className={`w-4 h-4 stroke-[2.2] ${isLight ? 'text-red-800' : 'text-amber-400'}`} />
              <span className="whitespace-nowrap">Ruang Pembelajaran</span>
            </a>
          </div>
        </div>
      </div>

      {/* 2. Stat / Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 stagger-1">
        {/* Card 1: Anggota Aktif */}
        <div 
          onClick={() => onNavigate('anggota')}
          className={`${cardBgClass} relative overflow-hidden rounded-2xl p-5 border flex items-center gap-4 hover:-translate-y-0.5 hover:shadow-md ${isLight ? 'hover:border-red-300' : 'hover:border-amber-500/40'} transition-all duration-200 cursor-pointer group`}
        >
          <div className="absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-red-800 to-red-600" />
          <div className={`pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out bg-gradient-to-r from-transparent ${isLight ? 'via-red-500/[0.06]' : 'via-white/[0.05]'} to-transparent`} />
          <Users className={`absolute -right-3 -bottom-3 w-20 h-20 pointer-events-none transition-transform duration-300 group-hover:scale-110 ${isLight ? 'text-red-900/[0.04]' : 'text-red-400/[0.06]'}`} />
          <div className="w-14 h-14 rounded-xl bg-gradient-to-tr from-red-900 to-red-700 text-amber-100 flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform duration-200 shrink-0 relative z-10">
            <Users className="w-7 h-7" />
          </div>
          <div className="relative z-10">
            <p className={`text-xs font-semibold ${isLight ? 'text-stone-500' : 'text-stone-400'}`}>Anggota Aktif</p>
            <p className={`font-display font-mono tabular-nums text-2xl sm:text-3xl font-extrabold tracking-tight flex items-baseline gap-1 ${isLight ? 'text-stone-900' : 'text-stone-100'}`}>
              {animatedActiveTeachers} <span className="text-[11px] text-stone-400 font-medium font-sans">Orang</span>
            </p>
            <p className="text-[10px] font-medium text-stone-400 mt-0.5">Terdaftar Aktif</p>
          </div>
        </div>

        {/* Card 2: Jumlah Kegiatan */}
        <div 
          onClick={() => onNavigate('jadwal')}
          className={`${cardBgClass} relative overflow-hidden rounded-2xl p-5 border flex items-center gap-4 hover:-translate-y-0.5 hover:shadow-md ${isLight ? 'hover:border-red-300' : 'hover:border-amber-500/40'} transition-all duration-200 cursor-pointer group`}
        >
          <div className="absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-emerald-700 to-emerald-500" />
          <div className={`pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out bg-gradient-to-r from-transparent ${isLight ? 'via-emerald-500/[0.06]' : 'via-white/[0.05]'} to-transparent`} />
          <Calendar className={`absolute -right-3 -bottom-3 w-20 h-20 pointer-events-none transition-transform duration-300 group-hover:scale-110 ${isLight ? 'text-emerald-900/[0.04]' : 'text-emerald-400/[0.06]'}`} />
          <div className="w-14 h-14 rounded-xl bg-gradient-to-tr from-emerald-700 to-emerald-600 text-white flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform duration-200 shrink-0 relative z-10">
            <Calendar className="w-7 h-7" />
          </div>
          <div className="relative z-10">
            <p className={`text-xs font-semibold ${isLight ? 'text-stone-500' : 'text-stone-400'}`}>Jumlah</p>
            <p className={`font-display font-mono tabular-nums text-2xl sm:text-3xl font-extrabold tracking-tight flex items-baseline gap-1 ${isLight ? 'text-stone-900' : 'text-stone-100'}`}>
              {animatedTotalEvents} <span className="text-[11px] text-stone-400 font-medium font-sans">Kegiatan</span>
            </p>
            <p className="text-[10px] font-medium text-stone-400 mt-0.5">Agenda Terjadwal</p>
          </div>
        </div>

        {/* Card 3: Laki - laki */}
        <div 
          onClick={() => onNavigate('anggota')}
          className={`${cardBgClass} relative overflow-hidden rounded-2xl p-5 border flex items-center gap-4 hover:-translate-y-0.5 hover:shadow-md ${isLight ? 'hover:border-red-300' : 'hover:border-amber-500/40'} transition-all duration-200 cursor-pointer group`}
        >
          <div className="absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-stone-700 to-stone-500" />
          <div className={`pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out bg-gradient-to-r from-transparent ${isLight ? 'via-stone-500/[0.06]' : 'via-white/[0.05]'} to-transparent`} />
          <User className={`absolute -right-3 -bottom-3 w-20 h-20 pointer-events-none transition-transform duration-300 group-hover:scale-110 ${isLight ? 'text-stone-900/[0.04]' : 'text-stone-300/[0.06]'}`} />
          <div className="w-14 h-14 rounded-xl bg-gradient-to-tr from-stone-700 to-stone-600 text-amber-100 flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform duration-200 shrink-0 relative z-10">
            <User className="w-7 h-7" />
          </div>
          <div className="relative z-10">
            <p className={`text-xs font-semibold ${isLight ? 'text-stone-500' : 'text-stone-400'}`}>Laki - laki</p>
            <p className={`font-display font-mono tabular-nums text-2xl sm:text-3xl font-extrabold tracking-tight flex items-baseline gap-1 ${isLight ? 'text-stone-900' : 'text-stone-100'}`}>
              {animatedMaleCount} <span className="text-[11px] text-stone-400 font-medium font-sans">Orang</span>
            </p>
            <p className="text-[10px] font-medium text-stone-400 tabular-nums mt-0.5">
              {activeTeachersCount > 0 ? Math.round((maleCount / activeTeachersCount) * 100) : 0}% dari anggota
            </p>
          </div>
        </div>

        {/* Card 4: Perempuan */}
        <div 
          onClick={() => onNavigate('anggota')}
          className={`${cardBgClass} relative overflow-hidden rounded-2xl p-5 border flex items-center gap-4 hover:-translate-y-0.5 hover:shadow-md ${isLight ? 'hover:border-red-300' : 'hover:border-amber-500/40'} transition-all duration-200 cursor-pointer group`}
        >
          <div className="absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-amber-700 to-amber-500" />
          <div className={`pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out bg-gradient-to-r from-transparent ${isLight ? 'via-amber-500/[0.06]' : 'via-white/[0.05]'} to-transparent`} />
          <User className={`absolute -right-3 -bottom-3 w-20 h-20 pointer-events-none transition-transform duration-300 group-hover:scale-110 ${isLight ? 'text-amber-900/[0.04]' : 'text-amber-400/[0.06]'}`} />
          <div className="w-14 h-14 rounded-xl bg-gradient-to-tr from-amber-700 to-amber-600 text-white flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform duration-200 shrink-0 relative z-10">
            <User className="w-7 h-7" />
          </div>
          <div className="relative z-10">
            <p className={`text-xs font-semibold ${isLight ? 'text-stone-500' : 'text-stone-400'}`}>Perempuan</p>
            <p className={`font-display font-mono tabular-nums text-2xl sm:text-3xl font-extrabold tracking-tight flex items-baseline gap-1 ${isLight ? 'text-stone-900' : 'text-stone-100'}`}>
              {animatedFemaleCount} <span className="text-[11px] text-stone-400 font-medium font-sans">Orang</span>
            </p>
            <p className="text-[10px] font-medium text-stone-400 tabular-nums mt-0.5">
              {activeTeachersCount > 0 ? Math.round((femaleCount / activeTeachersCount) * 100) : 0}% dari anggota
            </p>
          </div>
        </div>
      </div>

      {/* 2.2 Ringkasan Eksekutif PGRI Ranting */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 stagger-2">
        {/* Card 5 (dibawah Anggota Aktif): Kepala Sekolah */}
        <div
          onClick={() => onNavigate('anggota')}
          className={`${cardBgClass} relative overflow-hidden rounded-2xl p-5 border flex items-center gap-4 hover:-translate-y-0.5 hover:shadow-md ${isLight ? 'hover:border-red-300' : 'hover:border-amber-500/40'} transition-all duration-200 cursor-pointer group`}
        >
          <div className="absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-blue-800 to-blue-600" />
          <div className={`pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out bg-gradient-to-r from-transparent ${isLight ? 'via-blue-500/[0.06]' : 'via-white/[0.05]'} to-transparent`} />
          <Building2 className={`absolute -right-3 -bottom-3 w-20 h-20 pointer-events-none transition-transform duration-300 group-hover:scale-110 ${isLight ? 'text-blue-900/[0.04]' : 'text-blue-400/[0.06]'}`} />
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-gradient-to-tr from-blue-800 to-blue-600 text-white flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform duration-200 shrink-0 relative z-10">
            <Building2 className="w-6 h-6 sm:w-7 sm:h-7" />
          </div>
          <div className="relative z-10 min-w-0">
            <p className={`text-xs font-semibold truncate ${isLight ? 'text-stone-500' : 'text-stone-400'}`}>Kepala Sekolah</p>
            <p className={`font-display font-mono tabular-nums text-2xl sm:text-3xl font-extrabold tracking-tight flex items-baseline gap-1 ${isLight ? 'text-stone-900' : 'text-stone-100'}`}>
              {animatedKepalaSekolahCount} <span className="text-[11px] text-stone-400 font-medium font-sans">Orang</span>
            </p>
            <p className="text-[10px] font-medium text-stone-400 mt-0.5 truncate">Sekolah Binaan</p>
          </div>
        </div>

        {/* Card 6 (dibawah Jumlah): Pengurus */}
        <div
          onClick={() => onNavigate('profil')}
          className={`${cardBgClass} relative overflow-hidden rounded-2xl p-5 border flex items-center gap-4 hover:-translate-y-0.5 hover:shadow-md ${isLight ? 'hover:border-red-300' : 'hover:border-amber-500/40'} transition-all duration-200 cursor-pointer group`}
        >
          <div className="absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-violet-700 to-violet-500" />
          <div className={`pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out bg-gradient-to-r from-transparent ${isLight ? 'via-violet-500/[0.06]' : 'via-white/[0.05]'} to-transparent`} />
          <ShieldCheck className={`absolute -right-3 -bottom-3 w-20 h-20 pointer-events-none transition-transform duration-300 group-hover:scale-110 ${isLight ? 'text-violet-900/[0.04]' : 'text-violet-400/[0.06]'}`} />
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-gradient-to-tr from-violet-800 to-violet-600 text-white flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform duration-200 shrink-0 relative z-10">
            <ShieldCheck className="w-6 h-6 sm:w-7 sm:h-7" />
          </div>
          <div className="relative z-10 min-w-0">
            <p className={`text-xs font-semibold truncate ${isLight ? 'text-stone-500' : 'text-stone-400'}`}>Pengurus</p>
            <p className={`font-display font-mono tabular-nums text-2xl sm:text-3xl font-extrabold tracking-tight flex items-baseline gap-1 ${isLight ? 'text-stone-900' : 'text-stone-100'}`}>
              {animatedPengurusCount} <span className="text-[11px] text-stone-400 font-medium font-sans">Orang</span>
            </p>
            <p className="text-[10px] font-medium text-stone-400 mt-0.5 truncate">Struktur Pengurus</p>
          </div>
        </div>

        {/* Card 7 (dibawah Laki - laki): Pelunasan Kontribusi */}
        <div
          onClick={() => onNavigate('keuangan')}
          className={`${cardBgClass} relative overflow-hidden rounded-2xl p-5 border flex items-center justify-between gap-2 hover:-translate-y-0.5 hover:shadow-md ${isLight ? 'hover:border-red-300' : 'hover:border-amber-500/40'} transition-all duration-200 cursor-pointer group`}
        >
          <div className="absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-emerald-700 to-emerald-500" />
          <div className={`pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out bg-gradient-to-r from-transparent ${isLight ? 'via-emerald-500/[0.06]' : 'via-white/[0.05]'} to-transparent`} />
          <Wallet className={`absolute -right-3 -bottom-3 w-20 h-20 pointer-events-none transition-transform duration-300 group-hover:scale-110 ${isLight ? 'text-emerald-900/[0.04]' : 'text-emerald-400/[0.06]'}`} />
          <div className="flex items-center gap-3 sm:gap-4 min-w-0 relative z-10">
            <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform duration-200 ${isLight ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/80' : 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/50'}`}>
              <Wallet className="w-6 h-6 sm:w-7 sm:h-7" />
            </div>
            <div className="min-w-0">
              <p className={`text-xs font-semibold truncate ${isLight ? 'text-stone-500' : 'text-stone-400'}`}>Pelunasan Kontribusi</p>
              <p className={`font-display font-mono tabular-nums text-2xl sm:text-3xl font-extrabold tracking-tight flex items-baseline gap-1 ${isLight ? 'text-stone-900' : 'text-stone-100'}`}>
                {animatedCashPercentage}% <span className="text-[11px] font-medium text-stone-400 font-sans">({paidTeachersCount}/{totalCashMembersCount})</span>
              </p>
              <p className="text-[10px] font-medium text-stone-400 mt-0.5 truncate">Status Kas Ranting</p>
            </div>
          </div>
          <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500 shrink-0 relative z-10 hidden sm:block" />
        </div>

        {/* Card 8 (dibawah Perempuan): Purna Tugas */}
        <div
          onClick={() => onNavigate('anggota')}
          className={`${cardBgClass} relative overflow-hidden rounded-2xl p-5 border flex items-center gap-4 hover:-translate-y-0.5 hover:shadow-md ${isLight ? 'hover:border-red-300' : 'hover:border-amber-500/40'} transition-all duration-200 cursor-pointer group`}
        >
          <div className="absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-amber-600 to-amber-500" />
          <div className={`pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out bg-gradient-to-r from-transparent ${isLight ? 'via-amber-500/[0.06]' : 'via-white/[0.05]'} to-transparent`} />
          <Award className={`absolute -right-3 -bottom-3 w-20 h-20 pointer-events-none transition-transform duration-300 group-hover:scale-110 ${isLight ? 'text-amber-900/[0.04]' : 'text-amber-400/[0.06]'}`} />
          <div className="flex items-center gap-3 sm:gap-4 min-w-0 relative z-10">
            <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform duration-200 ${isLight ? 'bg-amber-50 text-amber-700 border border-amber-200/80' : 'bg-amber-950/60 text-amber-400 border border-amber-800/50'}`}>
              <Award className="w-6 h-6 sm:w-7 sm:h-7" />
            </div>
            <div className="min-w-0">
              <p className={`text-xs font-semibold truncate ${isLight ? 'text-stone-500' : 'text-stone-400'}`}>Purna Tugas ({currentYearNum}-{currentYearNum + 1})</p>
              <p className={`font-display font-mono tabular-nums text-2xl sm:text-3xl font-extrabold tracking-tight flex items-baseline gap-1 ${isLight ? 'text-stone-900' : 'text-stone-100'}`}>
                {animatedRetiringCount} <span className="text-[11px] font-medium text-stone-400 font-sans">Anggota</span>
              </p>
              {retiringSoonTeachers.length > 0 ? (
                <p className="text-[10px] text-amber-500 font-semibold truncate mt-0.5">{retiringSoonTeachers.map(t => t.name).join(', ')}</p>
              ) : (
                <p className="text-[10px] font-medium text-stone-400 mt-0.5 truncate">Estimasi Pensiun</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 2.5 Kotak Diagram Lingkaran (Pie Chart) & Jadwal Kegiatan */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch stagger-3">
        
        {/* Chart: Kehadiran Anggota (Kiri) */}
        <div className={`${cardBgClass} rounded-2xl p-6 border flex flex-col justify-between hover:-translate-y-0.5 transition-all duration-200`}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 shrink-0">
              <UserCheck className={`w-4 h-4 ${isLight ? 'text-red-800' : 'text-amber-400'}`} />
              <h3 className={`text-base font-extrabold ${isLight ? 'text-stone-900' : 'text-stone-100'}`}>
                Kehadiran
              </h3>
            </div>
            <div className="flex items-center gap-2">
              {sortedEvents.length > 0 && (
                <select
                  value={selectedAttendanceEventId}
                  onChange={(e) => setSelectedAttendanceEventId(e.target.value)}
                  className={`w-32 sm:w-44 px-2.5 py-1 rounded-xl border text-[10px] font-bold focus:outline-none focus:ring-2 focus:ring-red-800/20 focus:border-red-700 truncate transition-all cursor-pointer ${
                    isLight 
                      ? 'bg-[#faf8f5] border-stone-200 text-stone-800' 
                      : 'bg-stone-800 border-stone-700 text-stone-200'
                  }`}
                >
                  {sortedEvents.map(evt => (
                    <option key={evt.id} value={evt.id} className={isLight ? 'bg-white text-stone-800' : 'bg-stone-800 text-stone-100'}>
                      {evt.title} ({evt.date})
                    </option>
                  ))}
                </select>
              )}
              <button 
                onClick={() => onNavigate('jadwal')}
                className={`text-[10px] font-extrabold uppercase px-2.5 py-1 rounded-lg border transition-colors cursor-pointer shrink-0 ${
                  isLight
                    ? 'bg-red-50 text-red-800 border-red-200 hover:bg-red-100'
                    : 'bg-red-950/70 text-amber-300 border-red-800/60 hover:bg-red-900/60'
                }`}
              >
                Detail
              </button>
            </div>
          </div>

          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4 items-center py-4">
            {/* Kiri: Diagram Donat */}
            <div className="flex flex-col items-center justify-center relative">
              {renderDonut(attendancePercentage, tidakHadirPercentage, 'stroke-emerald-500', 'stroke-red-700')}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className={`font-display tabular-nums text-2xl sm:text-3xl font-black ${isLight ? 'text-stone-900' : 'text-white'} leading-none`}>{animatedAttendancePct}%</span>
                <span className={`text-[10px] sm:text-xs font-extrabold uppercase tracking-widest mt-1 ${isLight ? 'text-emerald-700' : 'text-emerald-400'}`}>Hadir</span>
                <span className="text-[10px] font-medium text-stone-400 mt-0.5">dari {selectedEventTargetCount} Peserta</span>
              </div>
            </div>

            {/* Kanan: 4 Kartu Mini Rincian Status */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className={`p-3 rounded-xl border text-center sm:text-left ${isLight ? 'bg-emerald-50/70 border-emerald-200/80' : 'bg-emerald-950/40 border-emerald-800/50'}`}>
                <div className="flex items-center justify-center sm:justify-start gap-1.5 mb-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className={`text-[10px] font-extrabold uppercase tracking-wider ${isLight ? 'text-emerald-800' : 'text-emerald-300'}`}>Hadir</span>
                </div>
                <p className={`font-display tabular-nums text-xl font-black ${isLight ? 'text-emerald-900' : 'text-white'}`}>{hadirCount}</p>
                <p className="text-[10px] text-stone-400 font-medium">Peserta</p>
              </div>

              <div className={`p-3 rounded-xl border text-center sm:text-left ${isLight ? 'bg-amber-50/70 border-amber-200/80' : 'bg-amber-950/40 border-amber-800/50'}`}>
                <div className="flex items-center justify-center sm:justify-start gap-1.5 mb-1">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className={`text-[10px] font-extrabold uppercase tracking-wider ${isLight ? 'text-amber-800' : 'text-amber-300'}`}>Sakit</span>
                </div>
                <p className={`font-display tabular-nums text-xl font-black ${isLight ? 'text-amber-900' : 'text-white'}`}>{sakitCount}</p>
                <p className="text-[10px] text-stone-400 font-medium">Peserta</p>
              </div>

              <div className={`p-3 rounded-xl border text-center sm:text-left ${isLight ? 'bg-blue-50/70 border-blue-200/80' : 'bg-blue-950/40 border-blue-800/50'}`}>
                <div className="flex items-center justify-center sm:justify-start gap-1.5 mb-1">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  <span className={`text-[10px] font-extrabold uppercase tracking-wider ${isLight ? 'text-blue-800' : 'text-blue-300'}`}>Izin</span>
                </div>
                <p className={`font-display tabular-nums text-xl font-black ${isLight ? 'text-blue-900' : 'text-white'}`}>{izinCount}</p>
                <p className="text-[10px] text-stone-400 font-medium">Peserta</p>
              </div>

              <div className={`p-3 rounded-xl border text-center sm:text-left ${isLight ? 'bg-red-50/70 border-red-200/80' : 'bg-red-950/40 border-red-800/50'}`}>
                <div className="flex items-center justify-center sm:justify-start gap-1.5 mb-1">
                  <span className="w-2 h-2 rounded-full bg-red-700" />
                  <span className={`text-[10px] font-extrabold uppercase tracking-wider ${isLight ? 'text-red-800' : 'text-red-300'}`}>Alpha</span>
                </div>
                <p className={`font-display tabular-nums text-xl font-black ${isLight ? 'text-red-900' : 'text-white'}`}>{alphaCount}</p>
                <p className="text-[10px] text-stone-400 font-medium">Belum Hadir</p>
              </div>
            </div>
          </div>

          <div className={`pt-3.5 border-t ${isLight ? 'border-stone-200/80' : 'border-stone-800'} flex items-center justify-center gap-6 mt-1`}>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm relative flex items-center justify-center">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40"></span>
              </div>
              <span className={`text-xs font-bold tabular-nums ${isLight ? 'text-stone-600' : 'text-stone-300'}`}>Hadir ({attendancePercentage}%)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-red-700 shadow-sm"></div>
              <span className={`text-xs font-bold tabular-nums ${isLight ? 'text-stone-600' : 'text-stone-300'}`}>Belum/Tidak ({tidakHadirPercentage}%)</span>
            </div>
          </div>
        </div>

        {/* A. Jadwal Kegiatan (Samping Kanan Kehadiran, Tampil Responsif di Semua Layar) */}
        <div className={`flex flex-col ${cardBgClass} rounded-2xl p-6 border hover:-translate-y-0.5 transition-all duration-200`}>
          <div className={`flex items-center justify-between pb-4 mb-4 border-b ${isLight ? 'border-stone-200/80' : 'border-stone-800'}`}>
            <div className="flex items-center gap-2.5">
              <div className={`p-2 rounded-xl border ${isLight ? 'bg-red-50 text-red-800 border-red-200/80' : 'bg-red-950/60 text-amber-400 border-red-800/50'}`}>
                <Calendar className="w-5 h-5" />
              </div>
              <h3 className={`text-base font-extrabold ${isLight ? 'text-stone-900' : 'text-stone-100'}`}>Jadwal Kegiatan</h3>
            </div>
          </div>

          <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1 custom-scrollbar">
            {sortedEvents.map((event) => {
              const categoryBadgeMap: Record<string, string> = {
                'Pertemuan Rutin': isLight ? 'bg-red-50 text-red-800 border border-red-200/80' : 'bg-red-950/70 text-amber-300 border border-red-800/60',
                'Belajar Bersama': isLight ? 'bg-red-50 text-red-800 border border-red-200/80' : 'bg-red-950/70 text-amber-300 border border-red-800/60',
                'Diskusi': isLight ? 'bg-emerald-50 text-emerald-800 border border-emerald-200/80' : 'bg-emerald-950/70 text-emerald-300 border border-emerald-800/60',
                'Berbagi': isLight ? 'bg-amber-50 text-amber-800 border border-amber-200/80' : 'bg-amber-950/70 text-amber-300 border border-amber-800/60',
                'Rapat': isLight ? 'bg-amber-50 text-amber-800 border border-amber-200/80' : 'bg-amber-950/70 text-amber-300 border border-amber-800/60',
                'Sosialisasi': isLight ? 'bg-blue-50 text-blue-800 border border-blue-200/80' : 'bg-blue-950/70 text-blue-300 border border-blue-800/60',
                'Workshop': isLight ? 'bg-stone-100 text-stone-800 border border-stone-200' : 'bg-stone-800 text-stone-200 border border-stone-700',
                'Apel': isLight ? 'bg-rose-50 text-rose-800 border border-rose-200/80' : 'bg-rose-950/70 text-rose-300 border border-rose-800/60',
                'Upacara': isLight ? 'bg-rose-50 text-rose-800 border border-rose-200/80' : 'bg-rose-950/70 text-rose-300 border border-rose-800/60'
              };

              const dateColorMap: Record<string, string> = {
                'purple': isLight ? 'bg-gradient-to-br from-red-900 to-red-700 text-amber-200 border-red-800' : 'bg-gradient-to-br from-red-950 to-red-800 text-amber-300 border-red-800/70',
                'green': isLight ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-emerald-950/80 text-emerald-200 border-emerald-800',
                'blue': isLight ? 'bg-amber-100 text-amber-900 border-amber-200' : 'bg-amber-950/80 text-amber-200 border-amber-800/70'
              };

              const statusInfo = getEventCountdownOrStatus(event);
              const dateParts = (event.date || ' -').split(' ');

              const eventCardStatusClass = statusInfo.isOngoing
                ? (isLight
                    ? 'bg-emerald-50/75 hover:bg-emerald-50 border-emerald-300/90 shadow-[0_2px_10px_rgba(16,185,129,0.08)]'
                    : 'bg-emerald-950/35 hover:bg-emerald-950/50 border-emerald-700/70 shadow-[0_2px_12px_rgba(16,185,129,0.12)]')
                : statusInfo.isFinished
                ? (isLight
                    ? 'bg-stone-100/85 hover:bg-stone-100 border-stone-200/90 opacity-85'
                    : 'bg-stone-900/70 hover:bg-stone-800/70 border-stone-800 opacity-80')
                : (isLight
                    ? 'bg-amber-50/65 hover:bg-amber-50 border-amber-200/90 shadow-[0_2px_10px_rgba(245,158,11,0.06)]'
                    : 'bg-amber-950/25 hover:bg-amber-950/40 border-amber-800/50');

              return (
                <div
                  key={event.id}
                  className={`flex flex-col xl:flex-row items-start xl:items-center justify-between p-3.5 rounded-2xl border transition-all duration-200 hover:-translate-y-0.5 gap-3 ${eventCardStatusClass}`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    {/* Date Badge Box */}
                    <div className={`w-12 h-12 rounded-xl border flex flex-col items-center justify-center font-black leading-none shadow-sm shrink-0 ${
                      statusInfo.isFinished
                        ? (isLight ? 'bg-stone-200/90 text-stone-600 border-stone-300' : 'bg-stone-800 text-stone-400 border-stone-700')
                        : (dateColorMap[event.categoryColor] || (isLight ? 'bg-gradient-to-br from-red-900 to-red-700 text-amber-200 border-red-800' : 'bg-gradient-to-br from-red-950 to-red-800 text-amber-300 border-red-800/70'))
                    }`}>
                      <span className="font-display text-base">{dateParts[0]}</span>
                      <span className="text-[9px] uppercase font-extrabold tracking-wider">{dateParts[1] || ''}</span>
                    </div>

                    {/* Info */}
                    <div className="min-w-0">
                      <h4 className={`font-bold text-sm truncate transition-colors ${
                        statusInfo.isFinished
                          ? (isLight ? 'text-stone-600' : 'text-stone-400')
                          : (isLight ? 'text-stone-900 hover:text-red-800' : 'text-stone-100 hover:text-amber-300')
                      }`}>
                        {event.title}
                      </h4>
                      <p className={`text-xs font-medium flex items-center gap-1 mt-0.5 ${
                        statusInfo.isOngoing
                          ? (isLight ? 'text-emerald-700' : 'text-emerald-400')
                          : 'text-stone-400'
                      }`}>
                        <Clock className={`w-3.5 h-3.5 shrink-0 ${
                          statusInfo.isOngoing
                            ? (isLight ? 'text-emerald-600' : 'text-emerald-400')
                            : 'text-stone-400'
                        }`} />
                        <span className="truncate">{event.time || '-'}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-stretch sm:self-end xl:self-center w-full sm:w-auto flex-wrap justify-between sm:justify-end shrink-0">
                    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-lg ${categoryBadgeMap[event.category] || (isLight ? 'bg-stone-100 text-stone-700 border border-stone-200' : 'bg-stone-800 text-stone-300 border border-stone-700')}`}>
                      {event.category}
                    </span>

                    <div className="flex items-center gap-2 flex-wrap justify-end">
                    {/* Countdown / Status Pill */}
                    <div className={`px-2.5 py-1.5 rounded-lg border shadow-sm inline-flex items-center justify-center gap-1.5 leading-none ${
                      statusInfo.isOngoing
                        ? (isLight ? 'bg-emerald-100/90 border-emerald-300 text-emerald-900' : 'bg-emerald-950/80 border-emerald-700/80 text-emerald-300')
                        : statusInfo.isFinished
                        ? (isLight ? 'bg-stone-200/80 border-stone-300 text-stone-600' : 'bg-stone-800/90 border-stone-700 text-stone-400')
                        : (isLight ? 'bg-amber-100/80 border-amber-300/80 text-amber-900' : 'bg-amber-950/70 border-amber-700/70 text-amber-300')
                    }`}>
                      {statusInfo.isOngoing ? (
                        <span className="relative flex h-2 w-2 shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                      ) : statusInfo.isFinished ? (
                        <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${isLight ? 'text-stone-500' : 'text-stone-400'}`} />
                      ) : (
                        <Clock className={`w-3.5 h-3.5 shrink-0 ${isLight ? 'text-amber-700' : 'text-amber-400'}`} />
                      )}
                      {statusInfo.isCountdown ? (
                        <span className={`text-[11px] font-bold font-mono tabular-nums tracking-wide leading-none ${isLight ? 'text-amber-900' : 'text-amber-300'} inline-flex items-center`}>
                          <span className="leading-none">{statusInfo.h}</span>
                          <span className="animate-colon mx-0.5 leading-none">:</span>
                          <span className="leading-none">{statusInfo.m}</span>
                          <span className="animate-colon mx-0.5 leading-none">:</span>
                          <span className="leading-none">{statusInfo.s}</span>
                        </span>
                      ) : (
                        <span className={`text-[11px] font-bold font-mono tracking-wide leading-none inline-flex items-center ${
                          statusInfo.isOngoing
                            ? (isLight ? 'text-emerald-800' : 'text-emerald-300')
                            : statusInfo.isFinished
                            ? (isLight ? 'text-stone-600' : 'text-stone-400')
                            : (isLight ? 'text-amber-900' : 'text-amber-300')
                        }`}>
                          {statusInfo.text}
                        </span>
                      )}
                    </div>

                    {!statusInfo.isFinished && (
                      <button
                        onClick={() => handleAttendanceClick(event)}
                        className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-all active:scale-95 shrink-0 bg-red-800 text-white hover:bg-red-700 cursor-pointer shadow-sm ${
                          (statusInfo.isOngoing || statusInfo.isUrgent)
                            ? 'ring-2 ring-red-500/40 shadow-[0_0_12px_rgba(185,28,28,0.35)]'
                            : ''
                        }`}
                      >
                        Absen
                      </button>
                    )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>

      {/* 3. Main Dashboard Content */}
      <div className="space-y-6 stagger-4">

        {/* Kotak Status Kas Anggota */}
        <div className="grid grid-cols-1 gap-6">

          {/* Kotak 1: Status Kontribusi Anggota */}
          <div className={`${cardBgClass} rounded-2xl p-6 border flex flex-col justify-between hover:-translate-y-0.5 transition-all duration-200`}>
            <div>
              <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-4 border-b ${isLight ? 'border-stone-200/80' : 'border-stone-800'}`}>
                <div className="flex items-center gap-2.5">
                  <div className={`p-2 rounded-xl border ${
                    cashFilterTab === 'unpaid'
                      ? (isLight ? 'bg-red-50 text-red-800 border-red-200/80' : 'bg-red-950/60 text-red-400 border-red-800/50')
                      : (isLight ? 'bg-emerald-50 text-emerald-700 border-emerald-200/80' : 'bg-emerald-950/60 text-emerald-400 border-emerald-800/50')
                  }`}>
                    {cashFilterTab === 'unpaid' ? <UserX className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
                  </div>
                  <div>
                    <h3 className={`text-base font-extrabold ${isLight ? 'text-stone-900' : 'text-stone-100'}`}>
                      {cashFilterTab === 'unpaid' ? 'Belum Membayar Kontribusi' : 'Telah Melunasi Kontribusi'}
                    </h3>
                    <p className="text-[11px] text-stone-400 font-medium">Status pembayaran kontribusi anggota aktif</p>
                  </div>
                </div>

                {/* Filter Tahun, Bulan & Tab Switcher: Belum Lunas vs Sudah Lunas */}
                <div className="flex flex-nowrap sm:flex-wrap items-center gap-1.5 sm:gap-2 w-full sm:w-auto overflow-x-auto sm:overflow-visible self-start sm:self-auto">
                  {/* Dropdown Filter Tahun */}
                  <select
                    value={selectedCashYear}
                    onChange={(e) => {
                      const nextYr = e.target.value;
                      setSelectedCashYear(nextYr);
                      const validMonths = CASH_MONTH_OPTIONS.filter(m => {
                        const code = `${nextYr}-${m.id}`;
                        return code >= duesStartPeriod && code <= maxCashDropdownPeriod;
                      });
                      if (validMonths.length > 0 && !validMonths.some(m => m.id === selectedCashMonth)) {
                        const defaultMonthInYear = validMonths.find(m => m.id === nowMonthStr && nextYr === nowYearStr);
                        setSelectedCashMonth(defaultMonthInYear ? defaultMonthInYear.id : validMonths[0].id);
                      }
                    }}
                    aria-label="Filter Tahun Kontribusi"
                    className={`pl-2 pr-5 sm:pl-3 sm:pr-7 py-1.5 rounded-xl border text-[10px] sm:text-[11px] font-bold shrink-0 focus:outline-none focus:ring-2 focus:ring-red-800/20 focus:border-red-700 transition-all cursor-pointer ${
                      isLight
                        ? 'bg-[#faf8f5] border-stone-200 text-stone-800'
                        : 'bg-stone-800 border-stone-700 text-stone-200'
                    }`}
                  >
                    {cashYearOptions.map((yr) => (
                      <option key={yr} value={yr} className={isLight ? 'bg-white text-stone-800' : 'bg-stone-800 text-stone-100'}>
                        {yr}
                      </option>
                    ))}
                  </select>

                  {/* Dropdown Filter Bulan (Dari Awal Pembayaran s.d. Bulan Sekarang) */}
                  <select
                    value={selectedCashMonth}
                    onChange={(e) => setSelectedCashMonth(e.target.value)}
                    aria-label="Filter Bulan Kontribusi"
                    className={`pl-2 pr-5 sm:pl-3 sm:pr-7 py-1.5 rounded-xl border text-[10px] sm:text-[11px] font-bold shrink-0 focus:outline-none focus:ring-2 focus:ring-red-800/20 focus:border-red-700 transition-all cursor-pointer ${
                      isLight
                        ? 'bg-[#faf8f5] border-stone-200 text-stone-800'
                        : 'bg-stone-800 border-stone-700 text-stone-200'
                    }`}
                  >
                    {validCashMonthsForSelectedYear.map((m) => (
                      <option key={m.id} value={m.id} className={isLight ? 'bg-white text-stone-800' : 'bg-stone-800 text-stone-100'}>
                        {m.name}
                      </option>
                    ))}
                  </select>

                  {/* Tab Switcher: Belum Lunas vs Sudah Lunas */}
                  <div className={`inline-flex p-0.5 sm:p-1 rounded-xl border shrink-0 ml-auto sm:ml-0 ${isLight ? 'bg-stone-100 border-stone-200/80' : 'bg-stone-800/90 border-stone-700'}`}>
                    <button
                      type="button"
                      onClick={() => setCashFilterTab('unpaid')}
                      className={`px-2 py-1 sm:px-3 sm:py-1.5 rounded-lg text-[10px] sm:text-[11px] font-extrabold tabular-nums whitespace-nowrap transition-all cursor-pointer ${
                        cashFilterTab === 'unpaid'
                          ? (isLight ? 'bg-white text-red-800 shadow-sm' : 'bg-red-950 text-amber-300 shadow-sm')
                          : (isLight ? 'text-stone-500 hover:text-stone-800' : 'text-stone-400 hover:text-stone-200')
                      }`}
                    >
                      Belum ({unpaidTeachers.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setCashFilterTab('paid')}
                      className={`px-2 py-1 sm:px-3 sm:py-1.5 rounded-lg text-[10px] sm:text-[11px] font-extrabold tabular-nums whitespace-nowrap transition-all cursor-pointer ${
                        cashFilterTab === 'paid'
                          ? (isLight ? 'bg-white text-emerald-700 shadow-sm' : 'bg-emerald-950 text-emerald-300 shadow-sm')
                          : (isLight ? 'text-stone-500 hover:text-stone-800' : 'text-stone-400 hover:text-stone-200')
                      }`}
                    >
                      Lunas ({paidTeachers.length})
                    </button>
                  </div>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="mb-4">
                <div className="flex items-center justify-between gap-2 text-[11px] font-bold tabular-nums mb-1.5">
                  <span className={isLight ? 'text-stone-500' : 'text-stone-400'}>
                    {(() => {
                      const [startY, startM] = duesStartPeriod.split('-');
                      const startMonthName = CASH_MONTH_OPTIONS.find(m => m.id === startM)?.name || startM;
                      const endMonthName = CASH_MONTH_OPTIONS.find(m => m.id === selectedCashMonth)?.name || selectedCashMonth;
                      return (
                        <>
                          <span className="block sm:inline">Progres Kelunasan</span>{' '}
                          <span className="block sm:inline">({startMonthName} {startY} - {endMonthName} {selectedCashYear})</span>
                        </>
                      );
                    })()}
                  </span>
                  <span className={`shrink-0 ${isLight ? 'text-stone-700' : 'text-stone-200'}`}>{paidTeachersCount}/{totalCashMembersCount} Anggota ({animatedCashPercentage}%)</span>
                </div>
                <div className={`w-full h-2 rounded-full overflow-hidden ${isLight ? 'bg-stone-100' : 'bg-stone-800'}`}>
                  <div 
                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-700 ease-out rounded-full relative overflow-hidden" 
                    style={{ width: `${isEntryReady ? cashPaidPercentage : 0}%` }}
                  >
                    {cashPaidPercentage > 0 && (
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/35 to-transparent animate-progress-shimmer" />
                    )}
                  </div>
                </div>
              </div>

              {/* List Guru Berdasarkan Tab Terpilih */}
              {cashFilterTab === 'unpaid' ? (
                <div key="tab-unpaid" className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[290px] overflow-y-auto pr-2 custom-scrollbar items-start animate-in fade-in duration-200">
                  {unpaidTeachers.length === 0 ? (
                    <div className={`md:col-span-2 py-10 px-4 rounded-2xl border border-dashed flex flex-col items-center justify-center text-center animate-in fade-in duration-300 ${
                      isLight ? 'bg-emerald-50/40 border-emerald-200 text-stone-600' : 'bg-emerald-950/20 border-emerald-900/40 text-stone-300'
                    }`}>
                      <CheckCircle2 className="w-10 h-10 mb-2 text-emerald-500" />
                      <p className="text-xs font-black text-emerald-600">Semua Anggota Telah Lunas</p>
                      <p className="text-[11px] text-stone-400 mt-0.5">Tidak ada tanggungan kontribusi yang belum diselesaikan.</p>
                    </div>
                  ) : (
                    <>
                      {/* Kolom Kiri: Laki-laki */}
                      <div className="space-y-2.5">
                        {unpaidMaleTeachers.map((teacher, index) => {
                          const unpaidMonths = getTeacherUnpaidMonthsCount(teacher);
                          const isFuturePeriod = `${selectedCashYear}-${selectedCashMonth}` > nowPeriodCode;
                          return (
                            <div
                              key={teacher.id}
                              className={`p-3 rounded-2xl border transition-all duration-200 hover:-translate-y-0.5 flex items-center justify-between gap-3 ${itemBgClass}`}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs shrink-0 border ${
                                  isLight ? 'bg-stone-100 text-stone-700 border-stone-200' : 'bg-stone-800 text-stone-200 border-stone-700'
                                }`}>
                                  L
                                </div>

                                <div className="min-w-0">
                                  <h4 className={`font-bold text-xs sm:text-sm truncate ${isLight ? 'text-stone-900' : 'text-stone-100'}`}>
                                    {index + 1}. {teacher.name || 'Tanpa Nama'}
                                  </h4>
                                  <div className="flex items-center gap-2 text-[10px] text-stone-400 font-medium mt-0.5">
                                    <span>NIP: {teacher.nip || '-'}</span>
                                    <span>•</span>
                                    <span className="truncate">{teacher.school || '-'}</span>
                                  </div>
                                </div>
                              </div>

                              <div className="flex flex-col sm:flex-row items-end sm:items-center gap-1 sm:gap-1.5 shrink-0">
                                {unpaidMonths > 0 && (
                                  <span
                                    title={`Total tunggakan jatuh tempo: ${unpaidMonths} bulan`}
                                    className={`text-[10px] font-extrabold tabular-nums px-2.5 py-1 rounded-lg border shrink-0 ${
                                      isLight
                                        ? 'bg-amber-50 text-amber-800 border-amber-200/80'
                                        : 'bg-amber-950/70 text-amber-300 border-amber-800/60'
                                    }`}
                                  >
                                    {unpaidMonths} Bulan
                                  </span>
                                )}
                                <span 
                                  title={`${isFuturePeriod && unpaidMonths === 0 ? 'Belum jatuh tempo untuk bulan' : 'Belum bayar kontribusi bulan'} ${CASH_MONTH_OPTIONS.find(m => m.id === selectedCashMonth)?.name || ''} ${selectedCashYear}`}
                                  className={`text-[10px] font-extrabold px-2.5 py-1 rounded-lg border shrink-0 ${
                                    isFuturePeriod && unpaidMonths === 0
                                      ? (isLight
                                          ? 'bg-stone-100 text-stone-600 border-stone-200/90'
                                          : 'bg-stone-800 text-stone-300 border-stone-700')
                                      : (isLight 
                                          ? 'bg-red-50 text-red-800 border-red-200/80' 
                                          : 'bg-red-950/80 text-red-300 border-red-800/70')
                                  }`}
                                >
                                  {isFuturePeriod && unpaidMonths === 0 ? 'Belum Jatuh Tempo' : 'Belum Bayar'}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Kolom Kanan: Perempuan */}
                      <div className="space-y-2.5">
                        {unpaidFemaleTeachers.map((teacher, index) => {
                          const unpaidMonths = getTeacherUnpaidMonthsCount(teacher);
                          const isFuturePeriod = `${selectedCashYear}-${selectedCashMonth}` > nowPeriodCode;
                          return (
                            <div
                              key={teacher.id}
                              className={`p-3 rounded-2xl border transition-all duration-200 hover:-translate-y-0.5 flex items-center justify-between gap-3 ${itemBgClass}`}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs shrink-0 border ${
                                  isLight ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-amber-950/70 text-amber-300 border-amber-800/60'
                                }`}>
                                  P
                                </div>

                                <div className="min-w-0">
                                  <h4 className={`font-bold text-xs sm:text-sm truncate ${isLight ? 'text-stone-900' : 'text-stone-100'}`}>
                                    {index + 1}. {teacher.name || 'Tanpa Nama'}
                                  </h4>
                                  <div className="flex items-center gap-2 text-[10px] text-stone-400 font-medium mt-0.5">
                                    <span>NIP: {teacher.nip || '-'}</span>
                                    <span>•</span>
                                    <span className="truncate">{teacher.school || '-'}</span>
                                  </div>
                                </div>
                              </div>

                              <div className="flex flex-col sm:flex-row items-end sm:items-center gap-1 sm:gap-1.5 shrink-0">
                                {unpaidMonths > 0 && (
                                  <span
                                    title={`Total tunggakan jatuh tempo: ${unpaidMonths} bulan`}
                                    className={`text-[10px] font-extrabold tabular-nums px-2.5 py-1 rounded-lg border shrink-0 ${
                                      isLight
                                        ? 'bg-amber-50 text-amber-800 border-amber-200/80'
                                        : 'bg-amber-950/70 text-amber-300 border-amber-800/60'
                                    }`}
                                  >
                                    {unpaidMonths} Bulan
                                  </span>
                                )}
                                <span 
                                  title={`${isFuturePeriod && unpaidMonths === 0 ? 'Belum jatuh tempo untuk bulan' : 'Belum bayar kontribusi bulan'} ${CASH_MONTH_OPTIONS.find(m => m.id === selectedCashMonth)?.name || ''} ${selectedCashYear}`}
                                  className={`text-[10px] font-extrabold px-2.5 py-1 rounded-lg border shrink-0 ${
                                    isFuturePeriod && unpaidMonths === 0
                                      ? (isLight
                                          ? 'bg-stone-100 text-stone-600 border-stone-200/90'
                                          : 'bg-stone-800 text-stone-300 border-stone-700')
                                      : (isLight 
                                          ? 'bg-red-50 text-red-800 border-red-200/80' 
                                          : 'bg-red-950/80 text-red-300 border-red-800/70')
                                  }`}
                                >
                                  {isFuturePeriod && unpaidMonths === 0 ? 'Belum Jatuh Tempo' : 'Belum Bayar'}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div key="tab-paid" className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[290px] overflow-y-auto pr-2 custom-scrollbar items-start animate-in fade-in duration-200">
                  {paidTeachers.length === 0 ? (
                    <div className={`md:col-span-2 py-10 px-4 rounded-2xl border border-dashed flex flex-col items-center justify-center text-center ${
                      isLight ? 'bg-stone-50 border-stone-200 text-stone-500' : 'bg-stone-800/40 border-stone-700 text-stone-400'
                    }`}>
                      <Wallet className="w-9 h-9 mb-2 text-stone-400" />
                      <p className="text-xs font-bold">Belum Ada Anggota yang Lunas Penuh</p>
                      <p className="text-[11px] text-stone-400 mt-0.5">Data akan muncul otomatis setelah pembayaran dicatat di menu Keuangan.</p>
                    </div>
                  ) : (
                    <>
                      {/* Kolom Kiri: Laki-laki */}
                      <div className="space-y-2.5">
                        {paidMaleTeachers.map((teacher, index) => (
                          <div
                            key={teacher.id}
                            className={`p-3 rounded-2xl border transition-all duration-200 hover:-translate-y-0.5 flex items-center justify-between gap-3 ${itemBgClass}`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs shrink-0 border ${
                                isLight ? 'bg-stone-100 text-stone-700 border-stone-200' : 'bg-stone-800 text-stone-200 border-stone-700'
                              }`}>
                                L
                              </div>
                              <div className="min-w-0">
                                <h4 className={`font-bold text-xs sm:text-sm truncate ${isLight ? 'text-stone-900' : 'text-stone-100'}`}>
                                  {index + 1}. {teacher.name || 'Tanpa Nama'}
                                </h4>
                                <div className="flex items-center gap-2 text-[10px] text-stone-400 font-medium mt-0.5">
                                  <span>NIP: {teacher.nip || '-'}</span>
                                  <span>•</span>
                                  <span className="truncate">{teacher.school || '-'}</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {`${selectedCashYear}-${selectedCashMonth}` > nowPeriodCode && (
                                <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-lg border shrink-0 ${
                                  isLight
                                    ? 'bg-sky-50 text-sky-800 border-sky-200/80'
                                    : 'bg-sky-950/70 text-sky-300 border-sky-800/60'
                                }`}>
                                  Bayar di Muka
                                </span>
                              )}
                              <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-lg border shrink-0 ${
                                isLight
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60'
                              }`}>
                                Lunas
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Kolom Kanan: Perempuan */}
                      <div className="space-y-2.5">
                        {paidFemaleTeachers.map((teacher, index) => (
                          <div
                            key={teacher.id}
                            className={`p-3 rounded-2xl border transition-all duration-200 hover:-translate-y-0.5 flex items-center justify-between gap-3 ${itemBgClass}`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs shrink-0 border ${
                                isLight ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-amber-950/70 text-amber-300 border-amber-800/60'
                              }`}>
                                P
                              </div>
                              <div className="min-w-0">
                                <h4 className={`font-bold text-xs sm:text-sm truncate ${isLight ? 'text-stone-900' : 'text-stone-100'}`}>
                                  {index + 1}. {teacher.name || 'Tanpa Nama'}
                                </h4>
                                <div className="flex items-center gap-2 text-[10px] text-stone-400 font-medium mt-0.5">
                                  <span>NIP: {teacher.nip || '-'}</span>
                                  <span>•</span>
                                  <span className="truncate">{teacher.school || '-'}</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {`${selectedCashYear}-${selectedCashMonth}` > nowPeriodCode && (
                                <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-lg border shrink-0 ${
                                  isLight
                                    ? 'bg-sky-50 text-sky-800 border-sky-200/80'
                                    : 'bg-sky-950/70 text-sky-300 border-sky-800/60'
                                }`}>
                                  Bayar di Muka
                                </span>
                              )}
                              <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-lg border shrink-0 ${
                                isLight
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60'
                              }`}>
                                Lunas
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>

      </div>

      {/* 4. Bottom Banner -> Menuju Menu Catatan Keuangan */}
      <div className={`relative overflow-hidden rounded-2xl p-6 border shadow-sm stagger-5 ${
        isLight
          ? 'bg-gradient-to-r from-[#fdfbf7] via-red-50/70 to-amber-50/70 border-stone-200/90'
          : 'bg-gradient-to-r from-[#231214] via-stone-900 to-[#1f1612] border-red-900/40'
      }`}>
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left relative z-10">
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 rounded-xl bg-gradient-to-br from-red-900 via-red-800 to-amber-700 text-amber-200 flex items-center justify-center shadow-md shrink-0 border ${
              isLight ? 'border-red-200' : 'border-red-700/60'
            }`}>
              <Star className="w-7 h-7 text-amber-300 fill-amber-300/30" />
            </div>
            <div>
              <h3 className={`font-display text-base sm:text-lg font-black tracking-tight ${isLight ? 'text-stone-900' : 'text-stone-100'}`}>
                &ldquo;Transparansi dan amanah adalah kunci kepercayaan bersama.&rdquo;
              </h3>
              <p className={`text-xs sm:text-sm font-medium mt-0.5 ${isLight ? 'text-red-800' : 'text-amber-300/90'}`}>
                Pantau laporan buku kas umum dan status pembayaran kontribusi anggota.
              </p>
            </div>
          </div>

          <button
            onClick={() => onNavigate('keuangan')}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-red-800 hover:bg-red-700 text-white font-bold text-xs sm:text-sm shadow-sm active:scale-95 flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer shrink-0"
          >
            <span className="tracking-wide">Buka Catatan Keuangan</span>
            <ArrowRight className="w-4 h-4 stroke-[2.5]" />
          </button>
        </div>
      </div>

      {/* POPUP ALERT: ABSENSI KADALUARSA */}
      {expiredEventAlert && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className={`${isLight ? 'bg-white border-stone-200/90' : 'bg-stone-900 border-stone-800'} rounded-2xl max-w-sm w-full p-6 shadow-2xl border space-y-4 animate-in zoom-in-95 duration-200 text-center`}>
            <div className={`w-16 h-16 mx-auto rounded-2xl border ${isLight ? 'bg-amber-50 border-amber-200' : 'bg-amber-950/60 border-amber-800/60'} flex items-center justify-center`}>
              <Clock className={`w-8 h-8 ${isLight ? 'text-amber-700' : 'text-amber-400'}`} />
            </div>
            <div>
              <h3 className={`font-display font-black text-lg ${isLight ? 'text-stone-900' : 'text-white'}`}>
                Absensi Ditutup
              </h3>
              <p className={`text-sm mt-2 leading-relaxed ${isLight ? 'text-stone-600' : 'text-stone-400'}`}>
                Batas waktu pengisian absensi untuk kegiatan <br/>
                <span className={`font-bold ${isLight ? 'text-red-800' : 'text-amber-400'}`}>"{expiredEventAlert.title}"</span><br/>
                telah berakhir.
              </p>
            </div>
            <div className="pt-4">
              <button
                onClick={() => setExpiredEventAlert(null)}
                className="w-full px-4 py-3 rounded-xl bg-red-800 hover:bg-red-700 text-white font-bold text-sm shadow-sm transition-all active:scale-95 cursor-pointer"
              >
                Mengerti
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};