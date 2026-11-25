import React, { useState, useEffect, useRef } from 'react';
import {
  mutateCloudCollection,
  syncFromFirebase,
  subscribeSyncStatus,
  emitSyncStatus,
  SyncStatusEvent,
  savePerDocItem,
  saveBatchPerDocItems,
  fetchPerDocCollection,
  fetchCloudVersions,
  shouldFetchByVersion,
  markLocalVersionSynced,
  getLocalVersions,
  removeFromOfflineQueue,
  mergePendingMemberRegistrations,
  mergePendingAttendanceSubmissions,
  mergePendingKontakSubmissions,
  SyncVersionKey
} from './lib/sync';
import { collection, doc, deleteDoc, getDoc, getDocFromServer, getDocs, query, where } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { CheckCircle2, AlertTriangle, XCircle, Volume2, VolumeX } from 'lucide-react';
import { auth, db } from './lib/firebase';
import { canAccessAdminForTab, isPengurusRole, logAuditEvent, PENGURUS_ROLE_LABELS, resolvePengurusRole } from './lib/auth';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { OfflineIndicator } from './components/OfflineIndicator';
import { MenuTransitionCurtain } from './components/MenuTransitionCurtain';
import batikKusumaBangsaBg from './assets/images/batik_kusuma_bangsa_1795456604040.webp';

const BerandaView = React.lazy(() => import('./components/views/BerandaView').then((m) => ({ default: m.BerandaView })));
const ProfilKBView = React.lazy(() => import('./components/views/ProfilKBView').then((m) => ({ default: m.ProfilKBView })));
const AnggotaView = React.lazy(() => import('./components/views/AnggotaView').then((m) => ({ default: m.AnggotaView })));
const JadwalView = React.lazy(() => import('./components/views/JadwalView').then((m) => ({ default: m.JadwalView })));
const KeuanganView = React.lazy(() => import('./components/views/KeuanganView').then((m) => ({ default: m.KeuanganView })));
const PengumumanView = React.lazy(() => import('./components/views/PengumumanView').then((m) => ({ default: m.PengumumanView })));
const KontakView = React.lazy(() => import('./components/views/KontakView').then((m) => ({ default: m.KontakView })));
const PengaturanView = React.lazy(() => import('./components/views/PengaturanView').then((m) => ({ default: m.PengaturanView })));
const BuatUndangan = React.lazy(() => import('./components/views/BuatUndangan').then((m) => ({ default: m.BuatUndangan })));
const ProkerView = React.lazy(() => import('./components/views/ProkerView').then((m) => ({ default: m.ProkerView })));
const SosialAspirasiView = React.lazy(() => import('./components/views/SosialAspirasiView').then((m) => ({ default: m.SosialAspirasiView })));
const SyncModal = React.lazy(() => import('./components/SyncModal').then((m) => ({ default: m.SyncModal })));

import {
  ActiveTab,
  ActivityEvent,
  AttendanceRecord,
  Announcement,
  Teacher,
  FinancialTransaction,
  CashPayment,
  PengurusRole,
  PengaturanSubTab
} from './types';

import {
  INITIAL_TEACHERS,
  INITIAL_EVENTS,
  INITIAL_ATTENDANCE,
  INITIAL_ANNOUNCEMENTS,
  INITIAL_FINANCIAL_TRANSACTIONS,
  INITIAL_CASH_PAYMENTS
} from './data/initialData';

const getFormattedFullDate = () => {
  return new Date().toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
};

const getFormattedShortDate = () => {
  return new Date().toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
};

// Helper untuk memastikan data dari Firebase selalu berbentuk Array
const ensureArray = <T,>(data: any): T[] | null => {
  if (data === undefined || data === null) return null;
  if (Array.isArray(data)) return data.filter(Boolean);
  if (typeof data === 'object') {
    return Object.keys(data).map(key => ({
      id: key,
      ...data[key]
    })).filter(Boolean);
  }
  return null;
};

// Helper penyimpanan localStorage aman yang otomatis membersihkan cache lama jika kuota penuh
const safeSetLocalStorage = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch (err: any) {
    if (err && (err.name === 'QuotaExceededError' || err.code === 22)) {
      const legacyKeys = [
        'kombel-materials',
        'kombel_materi_list',
        'kombel-forumPosts',
        'kombel-webinars',
        'kombel-transactions',
        'kombel-cash-payments',
        'kombel-attendance-list'
      ];
      legacyKeys.forEach((legacyKey) => {
        try {
          localStorage.removeItem(legacyKey);
        } catch {}
      });
      try {
        localStorage.setItem(key, value);
      } catch {}
    }
  }
};

export default function App() {
  const [showWelcomePopup, setShowWelcomePopup] = useState(true);
  const [welcomeProgress, setWelcomeProgress] = useState(0);
  const [welcomePhase, setWelcomePhase] = useState<'loading' | 'ready' | 'showcase' | 'blackout' | 'exiting' | 'done'>('loading');
  const [isWelcomeAudioMuted, setIsWelcomeAudioMuted] = useState(false);
  const [isWelcomeAudioUnlocked, setIsWelcomeAudioUnlocked] = useState(false);
  const welcomeAudioCtxRef = useRef<AudioContext | null>(null);
  const welcomeMasterGainRef = useRef<GainNode | null>(null);
  const welcomeBacksoundPlayedRef = useRef(false);
  const welcomePhaseRef = useRef(welcomePhase);
  const isWelcomeAudioMutedRef = useRef(isWelcomeAudioMuted);
  welcomePhaseRef.current = welcomePhase;
  isWelcomeAudioMutedRef.current = isWelcomeAudioMuted;
  const [kombelLogo, setKombelLogo] = useState<string | null>(() => {
    try {
      return localStorage.getItem('logo-pgri');
    } catch {
      return null;
    }
  });

  const ensureWelcomeAudioContext = (): AudioContext | null => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      if (!welcomeAudioCtxRef.current || welcomeAudioCtxRef.current.state === 'closed') {
        const ctx = new AudioCtx();
        ctx.addEventListener?.('statechange', () => {
          setIsWelcomeAudioUnlocked(ctx.state === 'running');
        });
        welcomeAudioCtxRef.current = ctx;
      }
      setIsWelcomeAudioUnlocked(welcomeAudioCtxRef.current.state === 'running');
      return welcomeAudioCtxRef.current;
    } catch {
      return null;
    }
  };

  const playWelcomeBacksound = (ctx: AudioContext) => {
    if (welcomeBacksoundPlayedRef.current || isWelcomeAudioMutedRef.current || ctx.state !== 'running') return;
    welcomeBacksoundPlayedRef.current = true;
    try {
      const now = ctx.currentTime;

      // Compressor agar suara penuh, padat, keras, namun tetap jernih tanpa pecah
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-14, now);
      compressor.knee.setValueAtTime(12, now);
      compressor.ratio.setValueAtTime(4, now);
      compressor.attack.setValueAtTime(0.01, now);
      compressor.release.setValueAtTime(0.25, now);
      compressor.connect(ctx.destination);

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.0001, now);
      masterGain.gain.exponentialRampToValueAtTime(0.36, now + 0.9);
      masterGain.gain.setValueAtTime(0.38, now + 4.3);
      masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 5.6);
      masterGain.connect(compressor);
      welcomeMasterGainRef.current = masterGain;

      // 1. Cinematic Sub-Bass Boom & Rumble (Dentuman rendah menggelegar di awal)
      const boomOsc = ctx.createOscillator();
      const boomGain = ctx.createGain();
      boomOsc.type = 'sine';
      boomOsc.frequency.setValueAtTime(115, now);
      boomOsc.frequency.exponentialRampToValueAtTime(42, now + 0.5);
      boomOsc.frequency.exponentialRampToValueAtTime(32.7, now + 4.8);
      boomGain.gain.setValueAtTime(0.0001, now);
      boomGain.gain.exponentialRampToValueAtTime(0.42, now + 0.1);
      boomGain.gain.exponentialRampToValueAtTime(0.24, now + 1.4);
      boomGain.gain.setValueAtTime(0.22, now + 4.2);
      boomGain.gain.exponentialRampToValueAtTime(0.0001, now + 5.5);
      boomOsc.connect(boomGain);
      boomGain.connect(masterGain);
      boomOsc.start(now);
      boomOsc.stop(now + 5.7);

      // Lapisan Sub-Bass kedua (C1 = 32.7Hz & C2 = 65.41Hz) untuk getaran bass yang dalam
      [32.7, 65.41].forEach((bassFreq, i) => {
        const bOsc = ctx.createOscillator();
        const bGain = ctx.createGain();
        bOsc.type = i === 0 ? 'sine' : 'triangle';
        bOsc.frequency.setValueAtTime(bassFreq, now);
        bGain.gain.setValueAtTime(0.0001, now);
        bGain.gain.exponentialRampToValueAtTime(i === 0 ? 0.3 : 0.2, now + 0.8);
        bGain.gain.setValueAtTime(i === 0 ? 0.3 : 0.2, now + 4.3);
        bGain.gain.exponentialRampToValueAtTime(0.0001, now + 5.6);
        bOsc.connect(bGain);
        bGain.connect(masterGain);
        bOsc.start(now);
        bOsc.stop(now + 5.8);
      });

      // 2. Filter Dinamis yang Membuka Lebar (Cinematic Brass & String Swell)
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.setValueAtTime(2.2, now);
      filter.frequency.setValueAtTime(280, now);
      filter.frequency.exponentialRampToValueAtTime(2400, now + 3.4);
      filter.frequency.exponentialRampToValueAtTime(520, now + 5.5);
      filter.connect(masterGain);

      // Harmoni akor megah Cmaj9 (C2, G2, C3, G3, B3, D4, E4, G4) dengan karakter sawtooth/triangle
      const padNotes = [
        { freq: 65.41, type: 'sawtooth' as OscillatorType, gain: 0.18, detune: -6 },
        { freq: 98.0, type: 'sawtooth' as OscillatorType, gain: 0.16, detune: 5 },
        { freq: 130.81, type: 'sawtooth' as OscillatorType, gain: 0.19, detune: -4 },
        { freq: 196.0, type: 'triangle' as OscillatorType, gain: 0.17, detune: 4 },
        { freq: 246.94, type: 'sawtooth' as OscillatorType, gain: 0.12, detune: -3 },
        { freq: 293.66, type: 'triangle' as OscillatorType, gain: 0.13, detune: 3 },
        { freq: 329.63, type: 'sawtooth' as OscillatorType, gain: 0.14, detune: -5 },
        { freq: 392.0, type: 'triangle' as OscillatorType, gain: 0.13, detune: 6 }
      ];

      padNotes.forEach(({ freq, type, gain, detune }) => {
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, now);
        osc.detune.setValueAtTime(detune, now);
        oscGain.gain.setValueAtTime(gain, now);
        osc.connect(oscGain);
        oscGain.connect(filter);
        osc.start(now);
        osc.stop(now + 5.8);
      });

      // 3. Dentingan Emas Megah (Golden Chime) bertahap saat logo membesar ke tengah
      const chimeNotes = [
        { freq: 523.25, delay: 0.05, peak: 0.2 },
        { freq: 659.25, delay: 0.4, peak: 0.19 },
        { freq: 783.99, delay: 0.8, peak: 0.19 },
        { freq: 987.77, delay: 1.25, peak: 0.17 },
        { freq: 1046.5, delay: 1.75, peak: 0.18 }
      ];

      chimeNotes.forEach(({ freq, delay, peak }) => {
        const osc = ctx.createOscillator();
        const chimeGain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + delay);
        chimeGain.gain.setValueAtTime(0.0001, now + delay);
        chimeGain.gain.exponentialRampToValueAtTime(peak, now + delay + 0.05);
        chimeGain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 2.4);
        osc.connect(chimeGain);
        chimeGain.connect(masterGain);
        osc.start(now + delay);
        osc.stop(now + delay + 2.5);
      });
    } catch {}
  };

  // Pembuka izin AudioContext browser saat pengguna berinteraksi di layar loading/showcase
  const unlockWelcomeAudio = () => {
    if (isWelcomeAudioMutedRef.current) return;
    const ctx = ensureWelcomeAudioContext();
    if (!ctx) return;
    if (ctx.state === 'running') {
      setIsWelcomeAudioUnlocked(true);
      if (welcomePhaseRef.current === 'showcase' && !welcomeBacksoundPlayedRef.current) {
        playWelcomeBacksound(ctx);
      }
      return;
    }
    if (ctx.state === 'suspended') {
      ctx
        .resume()
        .then(() => {
          const running = ctx.state === 'running';
          setIsWelcomeAudioUnlocked(running);
          if (running && welcomePhaseRef.current === 'showcase' && !welcomeBacksoundPlayedRef.current && !isWelcomeAudioMutedRef.current) {
            playWelcomeBacksound(ctx);
          }
        })
        .catch(() => {});
    }
  };

  useEffect(() => {
    if (!showWelcomePopup) return;
    // Cek status awal AudioContext (apakah browser sudah mengizinkan autoplay)
    ensureWelcomeAudioContext();
    const handleFirstGesture = () => unlockWelcomeAudio();
    window.addEventListener('pointerdown', handleFirstGesture, { passive: true });
    window.addEventListener('keydown', handleFirstGesture, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', handleFirstGesture);
      window.removeEventListener('keydown', handleFirstGesture);
    };
  }, [showWelcomePopup, isWelcomeAudioMuted]);

  // Memutar backsound Cinematic Warm Swell + Golden Chime tepat saat logo mulai membesar (fase 'showcase')
  useEffect(() => {
    if (!showWelcomePopup) return;

    if (welcomePhase === 'showcase' && !welcomeBacksoundPlayedRef.current && !isWelcomeAudioMuted) {
      const ctx = ensureWelcomeAudioContext();
      if (ctx) {
        if (ctx.state === 'running') {
          setIsWelcomeAudioUnlocked(true);
          playWelcomeBacksound(ctx);
        } else if (ctx.state === 'suspended') {
          ctx
            .resume()
            .then(() => {
              if (ctx.state === 'running' && welcomePhaseRef.current === 'showcase' && !welcomeBacksoundPlayedRef.current && !isWelcomeAudioMutedRef.current) {
                setIsWelcomeAudioUnlocked(true);
                playWelcomeBacksound(ctx);
              }
            })
            .catch(() => {});
        }
      }
    }

    if ((welcomePhase === 'blackout' || welcomePhase === 'exiting') && welcomeAudioCtxRef.current && welcomeMasterGainRef.current) {
      try {
        const ctx = welcomeAudioCtxRef.current;
        const now = ctx.currentTime;
        welcomeMasterGainRef.current.gain.cancelScheduledValues(now);
        welcomeMasterGainRef.current.gain.setValueAtTime(Math.max(0.0001, welcomeMasterGainRef.current.gain.value), now);
        welcomeMasterGainRef.current.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);
      } catch {}
    }

    if (welcomePhase === 'done' && welcomeAudioCtxRef.current) {
      try {
        welcomeAudioCtxRef.current.close().catch(() => {});
        welcomeAudioCtxRef.current = null;
      } catch {}
    }
  }, [welcomePhase, showWelcomePopup, isWelcomeAudioMuted, isWelcomeAudioUnlocked]);

  const [isSyncing, setIsSyncing] = useState(false);
  const isSyncingRef = useRef(false);
  const hasSyncedOnce = useRef(false);

  const [syncToast, setSyncToast] = useState<SyncStatusEvent | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeSyncStatus((event) => {
      setSyncToast(event);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        setSyncToast(null);
      }, event.type === 'success' ? 2800 : 4500);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const syncLogoFromLocal = () => {
      const savedLogo = localStorage.getItem('logo-pgri');
      if (savedLogo) setKombelLogo(savedLogo);
    };
    syncLogoFromLocal();
    window.addEventListener('storage', syncLogoFromLocal);
    window.addEventListener('kombel-settings-updated', syncLogoFromLocal);

    if (showWelcomePopup) {
      const duration = 5000;
      const intervalTime = 50;
      const startTime = Date.now();

      const progressInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const nextProgress = Math.min(100, Math.floor((elapsed / duration) * 100));
        setWelcomeProgress(nextProgress);
        if (nextProgress >= 100) {
          clearInterval(progressInterval);
        }
      }, intervalTime);

      const readyTimer = setTimeout(() => {
        setWelcomeProgress(100);
        setWelcomePhase('ready');
      }, duration);

      return () => {
        clearTimeout(readyTimer);
        clearInterval(progressInterval);
        window.removeEventListener('storage', syncLogoFromLocal);
        window.removeEventListener('kombel-settings-updated', syncLogoFromLocal);
      };
    }

    return () => {
      window.removeEventListener('storage', syncLogoFromLocal);
      window.removeEventListener('kombel-settings-updated', syncLogoFromLocal);
    };
  }, [showWelcomePopup]);

  // Transisi fase 'ready' -> 'showcase': otomatis bila AudioContext sudah aktif / dimatikan, atau menunggu ketukan tombol Buka Portal
  useEffect(() => {
    if (!showWelcomePopup || welcomePhase !== 'ready') return;
    if (isWelcomeAudioMuted || isWelcomeAudioUnlocked) {
      const showcaseTimer = setTimeout(() => {
        setWelcomePhase('showcase');
      }, 350);
      return () => clearTimeout(showcaseTimer);
    }
  }, [showWelcomePopup, welcomePhase, isWelcomeAudioMuted, isWelcomeAudioUnlocked]);

  // Penjadwalan fase lanjutan setelah masuk ke 'showcase' (5 detik pembesaran logo -> blackout -> exit -> selesai)
  useEffect(() => {
    if (!showWelcomePopup) return;
    if (welcomePhase === 'showcase') {
      const blackoutTimer = setTimeout(() => {
        setWelcomePhase('blackout');
      }, 5000);
      return () => clearTimeout(blackoutTimer);
    }
    if (welcomePhase === 'blackout') {
      const exitTimer = setTimeout(() => {
        setWelcomePhase('exiting');
      }, 950);
      return () => clearTimeout(exitTimer);
    }
    if (welcomePhase === 'exiting') {
      const doneTimer = setTimeout(() => {
        setWelcomePhase('done');
        setShowWelcomePopup(false);
      }, 700);
      return () => clearTimeout(doneTimer);
    }
  }, [showWelcomePopup, welcomePhase]);

  // Otomatis tarik data resmi dari Cloud saat aplikasi dibuka dengan pengecekan versi ringan (1 Read) + cooldown 60 detik
  useEffect(() => {
    let isMounted = true;
    const getTodayDateKey = () => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    };

    const fetchSettingsIfChanged = async (cloudVersions: Partial<Record<SyncVersionKey, number>> | null) => {
      const todayKey = getTodayDateKey();
      let isSameDaySynced = false;
      try {
        const lastSettingsSync = localStorage.getItem('kombel_settings_sync_ts');
        const isSameDayNumeric =
          lastSettingsSync &&
          !isNaN(Number(lastSettingsSync)) &&
          new Date(Number(lastSettingsSync)).toDateString() === new Date().toDateString();
        isSameDaySynced = Boolean(lastSettingsSync === todayKey || isSameDayNumeric);
      } catch (e) {}

      const localVersions = getLocalVersions();
      const localSettingsTs = Number(localVersions.settings || 0);
      const cloudSettingsTs = cloudVersions && typeof cloudVersions.settings === 'number' ? Number(cloudVersions.settings) : 0;

      // Jika sudah pernah tersinkron hari ini & versi server tidak berubah, lewati unduh aset berat (logo/TTD)
      if (localSettingsTs > 0 && cloudSettingsTs <= localSettingsTs) {
        return;
      }
      if (localSettingsTs === 0 && isSameDaySynced && cloudSettingsTs === 0) {
        markLocalVersionSynced('settings', cloudVersions);
        return;
      }

      try {
        const docRef = doc(db, 'settings', 'global');
        let docSnap;
        try {
          docSnap = await getDocFromServer(docRef);
        } catch (serverErr: any) {
          if (serverErr?.message?.includes('Quota') || serverErr?.code === 'resource-exhausted') {
            return;
          }
          docSnap = await getDoc(docRef);
        }
        if (!isMounted) return;
        if (docSnap && docSnap.exists()) {
          const data = docSnap.data();
          Object.entries(data).forEach(([k, v]) => {
            if (k === 'theme') return;
            if (v !== undefined && v !== null) {
              try {
                localStorage.setItem(k, String(v));
              } catch (e) {}
              if (k === 'logo-pgri') setKombelLogo(String(v));
            }
          });
          window.dispatchEvent(new Event('kombel-settings-updated'));
          markLocalVersionSynced('settings', cloudVersions);
        }
        try {
          localStorage.setItem('kombel_settings_sync_ts', todayKey);
        } catch (e) {}
      } catch (err) {
        console.warn('Auto sync logo/settings error:', err);
      }
    };

    const fetchCloudDataOnStart = async () => {
      try {
        const lastSyncStr = sessionStorage.getItem('kombel_startup_sync_ts');
        if (lastSyncStr && (Date.now() - Number(lastSyncStr)) < 60000) {
          return;
        }
      } catch (e) {}

      isSyncingRef.current = true;
      try {
        // 1 Read ringan untuk mengecek menu mana saja yang berubah di Cloud
        const cloudVersions = await fetchCloudVersions(45000);
        if (!isMounted) return;

        fetchSettingsIfChanged(cloudVersions);

        const startupKeys: SyncVersionKey[] = [
          'events',
          'teachers',
          'financialTransactions',
          'cashPayments',
          'attendanceList',
          'announcements'
        ];

        const keysToFetch = startupKeys.filter((k) => shouldFetchByVersion(k, cloudVersions));
        if (keysToFetch.length > 0) {
          const settled = await Promise.allSettled(keysToFetch.map((k) => syncFromFirebase(k)));
          if (!isMounted) return;

          keysToFetch.forEach((key, idx) => {
            const res = settled[idx];
            if (res.status !== 'fulfilled' || !Array.isArray(res.value)) return;
            const val = res.value;

            if (key === 'events') {
              setEvents(val);
              try {
                localStorage.setItem('kombel-events', JSON.stringify(val));
                const dlMap: Record<string, string> = {};
                const smMap: Record<string, string[]> = {};
                val.forEach((evt: any) => {
                  if (evt && evt.id) {
                    if (evt.uploadDeadline) dlMap[evt.id] = evt.uploadDeadline;
                    if (evt.selectedMemberIds && Array.isArray(evt.selectedMemberIds)) {
                      smMap[evt.id] = evt.selectedMemberIds;
                    }
                  }
                });
                localStorage.setItem('kombel-event-deadlines', JSON.stringify(dlMap));
                if (Object.keys(smMap).length > 0) {
                  const currentSm = localStorage.getItem('kombel-event-selected-members');
                  const parsedSm = currentSm ? JSON.parse(currentSm) : {};
                  localStorage.setItem('kombel-event-selected-members', JSON.stringify({ ...parsedSm, ...smMap }));
                }
              } catch (e) {}
            } else if (key === 'teachers') {
              setTeachers(val);
              try {
                localStorage.setItem('kombel-teachers', JSON.stringify(val));
              } catch (e) {}
            } else if (key === 'financialTransactions') {
              setFinancialTransactions(val);
              try {
                localStorage.setItem('kombel-financialTransactions', JSON.stringify(val));
                localStorage.removeItem('kombel-transactions');
              } catch (e) {}
            } else if (key === 'cashPayments') {
              setCashPayments(val);
              try {
                localStorage.setItem('kombel-cashPayments', JSON.stringify(val));
                localStorage.removeItem('kombel-cash-payments');
              } catch (e) {}
            } else if (key === 'attendanceList') {
              setAttendanceList(val);
              try {
                localStorage.setItem('kombel-attendance', JSON.stringify(val));
                localStorage.removeItem('kombel-attendance-list');
              } catch (e) {}
            } else if (key === 'announcements') {
              setAnnouncements(val);
              try {
                localStorage.setItem('kombel-announcements', JSON.stringify(val));
              } catch (e) {}
            }

            markLocalVersionSynced(key, cloudVersions);
          });
        }

        try {
          const nowStr = String(Date.now());
          sessionStorage.setItem('kombel_startup_sync_ts', nowStr);
          sessionStorage.setItem('kombel_jadwal_sync_ts', nowStr);
        } catch (e) {}
      } catch (err) {
        console.warn('Initial cloud sync error:', err);
      } finally {
        setTimeout(() => {
          isSyncingRef.current = false;
        }, 500);
      }
    };
    fetchCloudDataOnStart();
    return () => { isMounted = false; };
  }, []);

  const isInitialMount = useRef({
    teachers: true,
    events: true,
    attendanceList: true,
    financialTransactions: true,
    cashPayments: true,
    announcements: true
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>('beranda');
  const [pengaturanSubTab, setPengaturanSubTab] = useState<PengaturanSubTab>('logo');
  const menuTransitionKey = activeTab === 'pengaturan' ? `pengaturan:${pengaturanSubTab}` : activeTab;
  const [renderedTransitionKey, setRenderedTransitionKey] = useState<string>(menuTransitionKey);
  const [menuEntryPhase, setMenuEntryPhase] = useState<'intro' | 'revealing' | 'done'>('done');

  if (renderedTransitionKey !== menuTransitionKey) {
    setRenderedTransitionKey(menuTransitionKey);
    if (
      showWelcomePopup ||
      (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    ) {
      setMenuEntryPhase('done');
    } else {
      setMenuEntryPhase('intro');
    }
  }

  useEffect(() => {
    if (menuEntryPhase !== 'intro') return;
    const revealTimer = setTimeout(() => {
      setMenuEntryPhase('revealing');
    }, 360);
    return () => clearTimeout(revealTimer);
  }, [menuEntryPhase, renderedTransitionKey]);

  useEffect(() => {
    if (menuEntryPhase !== 'revealing') return;
    const doneTimer = setTimeout(() => {
      setMenuEntryPhase('done');
    }, 460);
    return () => clearTimeout(doneTimer);
  }, [menuEntryPhase, renderedTransitionKey]);
  
  useEffect(() => {
    try {
      localStorage.setItem('activeTab', activeTab);
    } catch {}
  }, [activeTab]);

  const [isOpenMobileSidebar, setIsOpenMobileSidebar] = useState(false);
  const [currentDate] = useState(getFormattedFullDate());

  const [activeRole, setActiveRole] = useState<'guru' | 'admin'>('guru');
  const [pengurusRole, setPengurusRole] = useState<PengurusRole>('guru');
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [authDisplayName, setAuthDisplayName] = useState<string | null>(null);

  // Sinkronkan status login Firebase Auth & RBAC Pengurus secara otomatis
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user && user.email) {
        setAuthEmail(user.email);
        setAuthDisplayName(user.displayName || user.email);
        const resolved = await resolvePengurusRole(user);
        setPengurusRole(resolved.role);
        const nextActive = isPengurusRole(resolved.role) ? 'admin' : 'guru';
        setActiveRole(nextActive);
        try {
          localStorage.setItem('activeRole', nextActive);
          localStorage.setItem('pgri-pengurus-role', resolved.role);
        } catch {}

        // Jika login sebagai Pengurus terverifikasi, gabungkan otomatis antrean kiriman Mode Guru ke daftar utama
        if (user.emailVerified && isPengurusRole(resolved.role)) {
          if (canAccessAdminForTab(resolved.role, 'anggota')) {
            void mergePendingMemberRegistrations<Teacher>().then((merged) => {
              if (Array.isArray(merged)) setTeachers(merged);
            });
          }
          if (canAccessAdminForTab(resolved.role, 'jadwal')) {
            void mergePendingAttendanceSubmissions<AttendanceRecord>().then((merged) => {
              if (Array.isArray(merged)) setAttendanceList(merged);
            });
          }
          if (canAccessAdminForTab(resolved.role, 'kontak')) {
            void mergePendingKontakSubmissions();
          }
        }
      } else {
        setAuthEmail(null);
        setAuthDisplayName(null);
        setPengurusRole('guru');
        setActiveRole('guru');
        try {
          localStorage.setItem('activeRole', 'guru');
          localStorage.setItem('pgri-pengurus-role', 'guru');
        } catch {}
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('activeRole', activeRole);
    } catch {}
  }, [activeRole]);

  useEffect(() => {
    setActiveTab('beranda');
  }, [activeRole]);

  const isTabLockedForGuru = (tab: ActiveTab): boolean => {
    if (activeRole === 'admin' && Boolean(authEmail) && isPengurusRole(pengurusRole)) {
      return false;
    }
    try {
      const saved = localStorage.getItem('kombel-locked-menus');
      if (!saved) return false;
      const parsed = JSON.parse(saved) as Record<string, boolean>;
      return Boolean(parsed[tab]);
    } catch {
      return false;
    }
  };

  const navigateWithLockCheck = (tab: ActiveTab) => {
    if (isTabLockedForGuru(tab)) {
      emitSyncStatus({
        type: 'warning',
        message: 'Menu tersebut sedang dikunci oleh Pengurus PGRI.'
      });
      return;
    }
    setActiveTab(tab);
    setSelectedEventForAbsensi(null);
  };

  useEffect(() => {
    if (activeTab === 'pengaturan' && (activeRole !== 'admin' || !canAccessAdminForTab(pengurusRole, 'pengaturan'))) {
      setActiveTab('beranda');
      return;
    }
    if (activeTab !== 'beranda' && isTabLockedForGuru(activeTab)) {
      setActiveTab('beranda');
    }
  }, [activeTab, activeRole, pengurusRole, authEmail]);

  const roleForTab = (tab: ActiveTab): 'guru' | 'admin' => {
    if (activeRole !== 'admin') return 'guru';
    return canAccessAdminForTab(pengurusRole, tab) ? 'admin' : 'guru';
  };

  const currentUser = {
    name: activeRole === 'admin' ? (authDisplayName || PENGURUS_ROLE_LABELS[pengurusRole]) : 'Semua Guru',
    school: 'PGRI Ranting Gelang',
    role: activeRole === 'admin' ? PENGURUS_ROLE_LABELS[pengurusRole] : 'Guru'
  };

  // Tidak melakukan auto-push cache lokal saat Admin aktif agar tidak menimpa data Cloud terbaru.

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme === 'light' || savedTheme === 'dark') {
        return savedTheme;
      }
    } catch {
      // Abaikan jika localStorage tidak tersedia
    }
    return 'light';
  });

  useEffect(() => {
    try {
      localStorage.setItem('theme', theme);
    } catch {
      // Abaikan jika localStorage tidak tersedia
    }
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.style.colorScheme = 'dark';
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.style.colorScheme = 'light';
    }
  }, [theme]);

  // Master State Data
  const [teachers, setTeachers] = useState<Teacher[]>(() => {
    try {
      const saved = localStorage.getItem('kombel-teachers');
      return saved ? JSON.parse(saved) : INITIAL_TEACHERS;
    } catch (e) {
      return INITIAL_TEACHERS;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('kombel-teachers', JSON.stringify(teachers));
    } catch {}
    if (isInitialMount.current.teachers) {
      isInitialMount.current.teachers = false;
    }
  }, [teachers]);
  
  const [events, setEvents] = useState<ActivityEvent[]>(() => {
    try {
      const saved = localStorage.getItem('kombel-events');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          if (parsed.length === 0) return [];
          // Jika masih tersimpan data dummy lama tahun 2025, migrasikan ke data resmi 2026
          if (parsed.some((e: any) => e.id === 'e1' || (e.title && e.title.includes('Pendampingan IPAS')))) {
            localStorage.setItem('kombel-events', JSON.stringify(INITIAL_EVENTS));
            return INITIAL_EVENTS;
          }
          // Merge uploadDeadline from INITIAL_EVENTS or kombel-event-deadlines if missing
          const savedDeadlinesStr = localStorage.getItem('kombel-event-deadlines');
          let savedDeadlines: Record<string, string> = {};
          try {
            if (savedDeadlinesStr) savedDeadlines = JSON.parse(savedDeadlinesStr);
          } catch (e) {}

          return parsed.map((e: ActivityEvent) => {
            let deadline = e.uploadDeadline;
            if (!deadline && savedDeadlines[e.id]) {
              deadline = savedDeadlines[e.id];
            }
            if (!deadline) {
              const matchedInit = INITIAL_EVENTS.find(ie => ie.id === e.id);
              if (matchedInit && matchedInit.uploadDeadline) {
                deadline = matchedInit.uploadDeadline;
              }
            }
            return deadline ? { ...e, uploadDeadline: deadline } : e;
          });
        }
      }
      return INITIAL_EVENTS;
    } catch (e) {
      console.warn('Gagal membaca data events:', e);
      return INITIAL_EVENTS;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('kombel-events', JSON.stringify(events));
      if (isInitialMount.current.events) {
        isInitialMount.current.events = false;
      }
    } catch (e) {
      console.warn('Gagal menyimpan data events:', e);
    }
  }, [events]);

  const [attendanceList, setAttendanceList] = useState<AttendanceRecord[]>(() => {
    try {
      const saved = localStorage.getItem('kombel-attendance');
      return saved ? JSON.parse(saved) : INITIAL_ATTENDANCE;
    } catch (e) {
      console.warn('Gagal membaca data absensi:', e);
      return INITIAL_ATTENDANCE;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('kombel-attendance', JSON.stringify(attendanceList));
      if (isInitialMount.current.attendanceList) {
        isInitialMount.current.attendanceList = false;
      }
    } catch (e) {
      console.warn('Gagal menyimpan data absensi:', e);
    }
  }, [attendanceList]);

  const [announcements, setAnnouncements] = useState<Announcement[]>(() => {
    try {
      const saved = localStorage.getItem('kombel-announcements');
      return saved ? JSON.parse(saved) : INITIAL_ANNOUNCEMENTS;
    } catch (e) {
      return INITIAL_ANNOUNCEMENTS;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('kombel-announcements', JSON.stringify(announcements));
    } catch {}
    if (isInitialMount.current.announcements) {
      isInitialMount.current.announcements = false;
    }
  }, [announcements]);

  const [financialTransactions, setFinancialTransactions] = useState<FinancialTransaction[]>(() => {
    try {
      const saved = localStorage.getItem('kombel-financialTransactions') || localStorage.getItem('kombel-transactions');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          if (parsed.length === 0) return [];
          // Jika masih tersimpan data dummy lama tahun 2025, migrasikan ke data resmi 2026
          if (parsed.some((t: any) => t.id === 'tx1' || (t.description && t.description.toLowerCase().includes('sisa saldo bulan april')))) {
            safeSetLocalStorage('kombel-financialTransactions', JSON.stringify(INITIAL_FINANCIAL_TRANSACTIONS));
            return INITIAL_FINANCIAL_TRANSACTIONS;
          }
          return parsed;
        }
      }
      return INITIAL_FINANCIAL_TRANSACTIONS;
    } catch (e) {
      return INITIAL_FINANCIAL_TRANSACTIONS;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('kombel-financialTransactions', JSON.stringify(financialTransactions));
      if (isInitialMount.current.financialTransactions) {
        isInitialMount.current.financialTransactions = false;
      }
    } catch (e) {
      console.warn('Gagal menyimpan financialTransactions:', e);
    }
  }, [financialTransactions]);

  const [cashPayments, setCashPayments] = useState<CashPayment[]>(() => {
    try {
      const saved = localStorage.getItem('kombel-cashPayments');
      return saved ? JSON.parse(saved) : INITIAL_CASH_PAYMENTS;
    } catch (e) {
      return INITIAL_CASH_PAYMENTS;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('kombel-cashPayments', JSON.stringify(cashPayments));
      if (isInitialMount.current.cashPayments) {
        isInitialMount.current.cashPayments = false;
      }
    } catch (e) {
      console.warn('Gagal menyimpan cashPayments:', e);
    }
  }, [cashPayments]);

  const [selectedEventForAbsensi, setSelectedEventForAbsensi] = useState<ActivityEvent | null>(null);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);

  // Trigger klik tombol 'Sync Cloud' di Header -> membuka popup pilihan modul
  const handleSync = () => {
    setIsSyncModalOpen(true);
  };

  // Eksekusi Sinkronisasi Modular Berdasarkan Menu yang Dipilih Pengguna (Pure Pull dari Cloud)
  const handleExecuteModularSync = async (selectedModuleIds: string[]) => {
    if (!selectedModuleIds || selectedModuleIds.length === 0) return;
    const isAll = selectedModuleIds.includes('semua') || selectedModuleIds.includes('all');
    isSyncingRef.current = true;
    setIsSyncing(true);
    try {
      const cloudVersions = await fetchCloudVersions(45000).catch(() => null);

      // 1. Modul Daftar Anggota Guru
      if (isAll || selectedModuleIds.includes('anggota')) {
        const fTeachers = await syncFromFirebase('teachers');
        const parsedCloudTeachers = ensureArray<Teacher>(fTeachers);
        if (parsedCloudTeachers && Array.isArray(parsedCloudTeachers)) {
          setTeachers(parsedCloudTeachers);
          try {
            localStorage.setItem('kombel-teachers', JSON.stringify(parsedCloudTeachers));
          } catch (e) {}
          markLocalVersionSynced('teachers', cloudVersions);
        }
        if (auth.currentUser?.emailVerified && canAccessAdminForTab(pengurusRole, 'anggota')) {
          const mergedTeachers = await mergePendingMemberRegistrations<Teacher>(
            Array.isArray(parsedCloudTeachers) ? parsedCloudTeachers : teachers
          );
          if (Array.isArray(mergedTeachers)) {
            setTeachers(mergedTeachers);
          }
        }
      }

      // 2. Modul Jadwal Kegiatan & Absensi
      if (isAll || selectedModuleIds.includes('jadwal')) {
        const [fEvents, fAttendance] = await Promise.all([
          syncFromFirebase('events'),
          syncFromFirebase('attendanceList')
        ]);
        const parsedCloudEvents = ensureArray<ActivityEvent>(fEvents);
        if (parsedCloudEvents && Array.isArray(parsedCloudEvents)) {
          setEvents(parsedCloudEvents);
          try {
            localStorage.setItem('kombel-events', JSON.stringify(parsedCloudEvents));
            const dlMap: Record<string, string> = {};
            const smMap: Record<string, string[]> = {};
            parsedCloudEvents.forEach(evt => {
              if (evt.uploadDeadline) dlMap[evt.id] = evt.uploadDeadline;
              if ((evt as any).selectedMemberIds && Array.isArray((evt as any).selectedMemberIds)) {
                smMap[evt.id] = (evt as any).selectedMemberIds;
              }
            });
            localStorage.setItem('kombel-event-deadlines', JSON.stringify(dlMap));
            if (Object.keys(smMap).length > 0) {
              const currentSm = localStorage.getItem('kombel-event-selected-members');
              const parsedSm = currentSm ? JSON.parse(currentSm) : {};
              localStorage.setItem('kombel-event-selected-members', JSON.stringify({ ...parsedSm, ...smMap }));
            }
          } catch (e) {}
          markLocalVersionSynced('events', cloudVersions);
        }

        const parsedCloudAttendance = ensureArray<AttendanceRecord>(fAttendance);
        if (parsedCloudAttendance && Array.isArray(parsedCloudAttendance)) {
          setAttendanceList(parsedCloudAttendance);
          try {
            localStorage.setItem('kombel-attendance', JSON.stringify(parsedCloudAttendance));
            localStorage.removeItem('kombel-attendance-list');
          } catch (e) {}
          markLocalVersionSynced('attendanceList', cloudVersions);
        }
        if (auth.currentUser?.emailVerified && canAccessAdminForTab(pengurusRole, 'jadwal')) {
          const mergedAtt = await mergePendingAttendanceSubmissions<AttendanceRecord>(
            Array.isArray(parsedCloudAttendance) ? parsedCloudAttendance : attendanceList
          );
          if (Array.isArray(mergedAtt)) {
            setAttendanceList(mergedAtt);
          }
        }
      }

      // 3. Modul Pengumuman Resmi
      if (isAll || selectedModuleIds.includes('forum_pengumuman')) {
        const fAnnouncements = await syncFromFirebase('announcements');
        const parsedCloudAnnouncements = ensureArray<Announcement>(fAnnouncements);
        if (parsedCloudAnnouncements && Array.isArray(parsedCloudAnnouncements)) {
          setAnnouncements(parsedCloudAnnouncements);
          try {
            localStorage.setItem('kombel-announcements', JSON.stringify(parsedCloudAnnouncements));
          } catch (e) {}
          markLocalVersionSynced('announcements', cloudVersions);
        }
      }

      // 5. Modul Kas & Keuangan Kombel (Termasuk seluruh data pembayaran kas)
      if (isAll || selectedModuleIds.includes('keuangan')) {
        const [fFin, fCash] = await Promise.all([
          syncFromFirebase('financialTransactions'),
          syncFromFirebase('cashPayments')
        ]);
        const parsedCloudFin = ensureArray<FinancialTransaction>(fFin);
        if (parsedCloudFin && Array.isArray(parsedCloudFin)) {
          setFinancialTransactions(parsedCloudFin);
          try {
            localStorage.setItem('kombel-financialTransactions', JSON.stringify(parsedCloudFin));
            localStorage.removeItem('kombel-transactions');
          } catch (e) {}
          markLocalVersionSynced('financialTransactions', cloudVersions);
        }

        const parsedCloudCash = ensureArray<CashPayment>(fCash);
        if (parsedCloudCash && Array.isArray(parsedCloudCash)) {
          setCashPayments(parsedCloudCash);
          try {
            localStorage.setItem('kombel-cashPayments', JSON.stringify(parsedCloudCash));
            localStorage.removeItem('kombel-cash-payments');
          } catch (e) {}
          markLocalVersionSynced('cashPayments', cloudVersions);
        }
      }

      // 5. Modul Program Kerja
      if (isAll || selectedModuleIds.includes('proker')) {
        try {
          const cloudProker = await fetchPerDocCollection<any>('proker_items');
          if (Array.isArray(cloudProker)) {
            const hasCloudVersion = Boolean(cloudVersions && Number(cloudVersions.proker_items || 0) > 0);
            if (cloudProker.length > 0 || hasCloudVersion) {
              try {
                localStorage.setItem('pgri-proker-items', JSON.stringify(cloudProker));
              } catch (e) {}
            }
            markLocalVersionSynced('proker_items', cloudVersions);
            try {
              sessionStorage.setItem('pgri_proker_sync_ts', String(Date.now()));
            } catch (e) {}
            window.dispatchEvent(new Event('pgri-proker-synced'));
          }
        } catch (e) {}
      }

      // 8. Modul Dana Aspirasi (Dana Sosial & Kotak Aspirasi)
      if (isAll || selectedModuleIds.includes('sosial')) {
        try {
          const cloudDana = await fetchPerDocCollection<any>('dana_sosial');
          if (Array.isArray(cloudDana)) {
            const hasCloudVersion = Boolean(cloudVersions && Number(cloudVersions.dana_sosial || 0) > 0);
            if (cloudDana.length > 0 || hasCloudVersion) {
              try {
                localStorage.setItem('pgri-dana-sosial', JSON.stringify(cloudDana));
              } catch (e) {}
            }
            markLocalVersionSynced('dana_sosial', cloudVersions);
            try {
              sessionStorage.setItem('pgri_dana_sosial_sync_ts', String(Date.now()));
            } catch (e) {}
          }
        } catch (e) {}

        try {
          const user = auth.currentUser;
          if (user && user.emailVerified) {
            const canReadAllAsp = activeRole === 'admin' && (pengurusRole === 'ketua' || pengurusRole === 'sekretaris');
            const q = canReadAllAsp
              ? collection(db, 'aspirasi_items')
              : query(collection(db, 'aspirasi_items'), where('authorUid', '==', user.uid));
            const snap = await getDocs(q);
            const rows: any[] = [];
            snap.forEach((d) => rows.push(d.data()));
            rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
            try {
              localStorage.setItem('pgri-aspirasi-local', JSON.stringify(rows));
              const scopeKey = `${user.uid}_${canReadAllAsp ? 'all' : 'own'}`;
              sessionStorage.setItem('pgri_aspirasi_last_scope', scopeKey);
              sessionStorage.setItem(`pgri_aspirasi_sync_ts_${scopeKey}`, String(Date.now()));
            } catch (e) {}
            markLocalVersionSynced('aspirasi_items', cloudVersions);
          }
        } catch (e) {}

        window.dispatchEvent(new Event('pgri-sosial-synced'));
      }

      // 9. Modul Buat Undangan & E-Office (Arsip Undangan, Agenda Surat, Notulen)
      if (isAll || selectedModuleIds.includes('undangan')) {
        try {
          const canReadProtected = Boolean(auth.currentUser && auth.currentUser.emailVerified);
          const [invRes, agendaRes, notulenRes] = await Promise.allSettled([
            canReadProtected ? syncFromFirebase('invitations') : Promise.resolve(null),
            canReadProtected ? syncFromFirebase('suratAgenda') : Promise.resolve(null),
            syncFromFirebase('notulen')
          ]);

          if (canReadProtected && invRes.status === 'fulfilled' && Array.isArray(invRes.value)) {
            try {
              localStorage.setItem('kombel-invitations', JSON.stringify(invRes.value));
            } catch (e) {}
            markLocalVersionSynced('invitations', cloudVersions);
          }

          if (canReadProtected && agendaRes.status === 'fulfilled' && Array.isArray(agendaRes.value)) {
            try {
              localStorage.setItem('pgri-surat-agenda', JSON.stringify(agendaRes.value));
            } catch (e) {}
            markLocalVersionSynced('suratAgenda', cloudVersions);
          }

          if (notulenRes.status === 'fulfilled' && Array.isArray(notulenRes.value)) {
            try {
              localStorage.setItem('pgri-notulen-rapat', JSON.stringify(notulenRes.value));
            } catch (e) {}
            markLocalVersionSynced('notulen', cloudVersions);
          }

          try {
            sessionStorage.setItem('pgri_eoffice_sync_ts', String(Date.now()));
          } catch (e) {}
          window.dispatchEvent(new Event('pgri-eoffice-synced'));
        } catch (e) {}
      }

      // 9b. Modul Layanan Informasi & Masukan (Kontak)
      if (isAll || selectedModuleIds.includes('kontak')) {
        try {
          const fKontak = await syncFromFirebase('kontakFeedback');
          const parsedKontak = ensureArray<any>(fKontak);
          if (parsedKontak && Array.isArray(parsedKontak)) {
            try {
              localStorage.setItem('pgri-kontak-feedback', JSON.stringify(parsedKontak));
            } catch (e) {}
            markLocalVersionSynced('kontakFeedback', cloudVersions);
          }
          if (auth.currentUser?.emailVerified && canAccessAdminForTab(pengurusRole, 'kontak')) {
            await mergePendingKontakSubmissions(Array.isArray(parsedKontak) ? parsedKontak : []);
          }
          try {
            sessionStorage.setItem('pgri_kontak_sync_ts', String(Date.now()));
          } catch (e) {}
          window.dispatchEvent(new Event('pgri-kontak-synced'));
        } catch (e) {}
      }

      // 10. Modul Kepengurusan & Pengaturan (Termasuk Status Kunci Menu)
      if (isAll || selectedModuleIds.includes('pengaturan')) {
        try {
          const docRef = doc(db, 'settings', 'global');
          let docSnap;
          try {
            docSnap = await getDocFromServer(docRef);
          } catch {
            docSnap = await getDoc(docRef);
          }
          if (docSnap.exists()) {
            const data = docSnap.data();
            Object.entries(data).forEach(([k, v]) => {
              if (k === 'theme') return;
              if (v !== undefined && v !== null) {
                try {
                  localStorage.setItem(k, String(v));
                } catch (e) {}
                if (k === 'logo-pgri') setKombelLogo(String(v));
              }
            });
            window.dispatchEvent(new Event('kombel-settings-updated'));
            markLocalVersionSynced('settings', cloudVersions);
          }
          try {
            const now = new Date();
            const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            localStorage.setItem('kombel_settings_sync_ts', todayKey);
          } catch (e) {}
        } catch (e) {}

        try {
          const lockRef = doc(db, 'settings', 'locked-menus');
          let lockSnap;
          try {
            lockSnap = await getDocFromServer(lockRef);
          } catch {
            lockSnap = await getDoc(lockRef);
          }
          if (lockSnap.exists()) {
            localStorage.setItem('kombel-locked-menus', JSON.stringify(lockSnap.data()));
            window.dispatchEvent(new Event('kombel-locked-menus-updated'));
          }
        } catch (e) {}
        try {
          sessionStorage.setItem('kombel_locked_menus_sync_ts', String(Date.now()));
        } catch (e) {}
      }

      try {
        const nowStr = String(Date.now());
        if (isAll || selectedModuleIds.includes('jadwal')) {
          sessionStorage.setItem('kombel_jadwal_sync_ts', nowStr);
        }
        if (isAll) {
          sessionStorage.setItem('kombel_startup_sync_ts', nowStr);
        }
      } catch (e) {}

      hasSyncedOnce.current = true;
    } catch (e: any) {
      console.warn(e);
      if (e?.message === 'QUOTA_LIMIT_EXCEEDED' || (e?.message && e.message.includes('Quota limit exceeded'))) {
        emitSyncStatus({
          type: 'warning',
          message: 'Batas kuota harian Firebase sedang tercapai hari ini. Sistem menyajikan data lokal.'
        });
      } else {
        emitSyncStatus({
          type: 'error',
          message: 'Gagal menarik data dari server Cloud. Periksa koneksi internet Anda.'
        });
      }
      throw e;
    } finally {
      setIsSyncing(false);
      setTimeout(() => {
        isSyncingRef.current = false;
      }, 500);
    }
  };

  // Sinkronisasi antar-tab browser secara lokal tanpa membebani kuota Firebase
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent | Event) => {
      try {
        const localCash = localStorage.getItem('kombel-cashPayments') || localStorage.getItem('kombel-cash-payments');
        const localFin = localStorage.getItem('kombel-financialTransactions') || localStorage.getItem('kombel-transactions');

        if (localCash) setCashPayments(JSON.parse(localCash));
        if (localFin) setFinancialTransactions(JSON.parse(localFin));
      } catch (err) {
        console.warn('Gagal membaca storage update:', err);
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);
  
  const handleAddAttendance = (rec: Omit<AttendanceRecord, 'id' | 'timestamp'>) => {
    const created: AttendanceRecord = {
      ...rec,
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: `${getFormattedShortDate()} ${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB`
    };
    setAttendanceList(prev => {
      const updated = [created, ...prev];
      safeSetLocalStorage('kombel-attendance', JSON.stringify(updated));
      return updated;
    });

    const isVerifiedSignedIn = Boolean(auth.currentUser && auth.currentUser.emailVerified);
    if (!isVerifiedSignedIn) {
      const attPayload: Record<string, any> = {
        id: created.id,
        eventId: String(created.eventId || 'evt').slice(0, 128),
        eventTitle: String(created.eventTitle || '').slice(0, 240),
        teacherName: String(created.teacherName || '-').trim().slice(0, 160) || '-',
        school: String(created.school || '-').slice(0, 160),
        status: created.status,
        timestamp: String(created.timestamp || new Date().toISOString()).slice(0, 64)
      };
      if (created.teacherId) attPayload.teacherId = String(created.teacherId).slice(0, 128);
      if (created.nip) attPayload.nip = String(created.nip).slice(0, 40);
      if (created.notes) attPayload.notes = String(created.notes).slice(0, 500);
      if (typeof (created as any).signature === 'string' && (created as any).signature.length <= 200000) {
        attPayload.signature = (created as any).signature;
      }

      void savePerDocItem('attendance_submissions', created.id, attPayload, 'Presensi Kehadiran').then((res) => {
        if (res.success) {
          emitSyncStatus({
            type: 'success',
            collectionName: 'attendanceList',
            message: 'Presensi kehadiran berhasil dikirim ke Cloud.'
          });
        } else if (res.error && !res.error.includes('Offline')) {
          emitSyncStatus({
            type: res.quotaExceeded ? 'warning' : 'error',
            collectionName: 'attendanceList',
            message: res.error
          });
        }
      });
      return;
    }

    savePerDocItem('attendance_docs', created.id, created, 'Presensi Kehadiran');
    mutateCloudCollection<AttendanceRecord>(
      'attendanceList',
      ['kombel-attendance'],
      (latest) => [created, ...latest.filter(a => a.id !== created.id)],
      attendanceList,
      'Presensi Kehadiran'
    ).then(res => setAttendanceList(res.items));
  };

  const handleAddBulkAttendance = (records: Omit<AttendanceRecord, 'id' | 'timestamp'>[]) => {
    if (!records || records.length === 0) return;
    const baseTime = Date.now();
    const formattedTs = `${getFormattedShortDate()} ${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB`;

    const createdList: AttendanceRecord[] = records.map((rec, idx) => ({
      ...rec,
      id: `att-${baseTime}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: formattedTs
    }));

    setAttendanceList(prev => {
      const updated = [...createdList, ...prev];
      safeSetLocalStorage('kombel-attendance', JSON.stringify(updated));
      return updated;
    });

    void saveBatchPerDocItems(
      'attendance_docs',
      createdList.map((created) => ({ docId: created.id, payload: created })),
      `Presensi Massal (${createdList.length} Anggota)`
    );

    const createdIds = new Set(createdList.map(c => c.id));
    mutateCloudCollection<AttendanceRecord>(
      'attendanceList',
      ['kombel-attendance'],
      (latest) => [...createdList, ...latest.filter(a => !createdIds.has(a.id))],
      attendanceList,
      `Presensi Massal (${createdList.length} Anggota)`
    ).then(res => setAttendanceList(res.items));
  };

  const handleUpdateAttendance = (updated: AttendanceRecord) => {
    const isDuplicateTeacherEvent = (a: AttendanceRecord, target: AttendanceRecord) => {
      if (a.id === target.id) return false;
      if (String(a.eventId || '').trim() !== String(target.eventId || '').trim()) return false;
      const aTid = a.teacherId ? String(a.teacherId).trim() : '';
      const tTid = target.teacherId ? String(target.teacherId).trim() : '';
      if (aTid && tTid && aTid === tTid) return true;
      const aName = (a.teacherName || '').trim().toLowerCase();
      const tName = (target.teacherName || '').trim().toLowerCase();
      return Boolean(aName && tName && aName === tName);
    };

    setAttendanceList(prev => {
      const cleaned = prev.filter(a => !isDuplicateTeacherEvent(a, updated));
      const updatedList = cleaned.some(a => a.id === updated.id)
        ? cleaned.map(a => a.id === updated.id ? updated : a)
        : [updated, ...cleaned];
      try {
        localStorage.setItem('kombel-attendance', JSON.stringify(updatedList));
      } catch (e) {}
      return updatedList;
    });
    if (auth.currentUser && auth.currentUser.emailVerified) {
      void savePerDocItem('attendance_docs', updated.id, updated, 'Presensi Kehadiran');
    }
    mutateCloudCollection<AttendanceRecord>(
      'attendanceList',
      ['kombel-attendance'],
      (latest) => {
        const cleaned = latest.filter(a => !isDuplicateTeacherEvent(a, updated));
        return cleaned.some(a => a.id === updated.id)
          ? cleaned.map(a => a.id === updated.id ? updated : a)
          : [updated, ...cleaned];
      },
      attendanceList,
      'Presensi Kehadiran'
    ).then(res => setAttendanceList(res.items));
  };

  const handleDeleteAttendance = async (id: string): Promise<boolean> => {
    const deletedRec = attendanceList.find(a => a.id === id);
    const nextFallback = attendanceList.filter(a => a.id !== id);
    setAttendanceList(prev => {
      const updatedList = prev.filter(a => a.id !== id);
      safeSetLocalStorage('kombel-attendance', JSON.stringify(updatedList));
      return updatedList;
    });
    removeFromOfflineQueue('attendance_docs', id);
    if (pengurusRole === 'ketua' || pengurusRole === 'sekretaris') {
      void deleteDoc(doc(db, 'attendance_docs', id)).catch(() => {});
    }
    const res = await mutateCloudCollection<AttendanceRecord>(
      'attendanceList',
      ['kombel-attendance'],
      (latest) => latest.filter(a => a.id !== id),
      nextFallback,
      'Presensi Kehadiran'
    );
    setAttendanceList(res.items);
    if (deletedRec) {
      void logAuditEvent(
        'Jadwal & Presensi',
        'Hapus Presensi',
        `Menghapus presensi ${deletedRec.teacherName} pada "${deletedRec.eventTitle}".`
      );
    }
    return res.success;
  };

  const handleAddEvent = (evt: Omit<ActivityEvent, 'id' | 'attendanceOpen'>) => {
    const created: ActivityEvent = {
      ...evt,
      id: `e-${Date.now()}`,
      attendanceOpen: true
    };
    setEvents(prev => {
      const updated = [created, ...prev];
      try {
        localStorage.setItem('kombel-events', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
    void logAuditEvent('Jadwal Kegiatan', 'Tambah Kegiatan', `Menambahkan kegiatan "${created.title}" (${created.fullDate || created.date}).`);
    mutateCloudCollection<ActivityEvent>(
      'events',
      ['kombel-events'],
      (latest) => [created, ...latest.filter(e => e.id !== created.id)],
      events,
      'Jadwal Kegiatan'
    ).then(res => setEvents(res.items));
  };

  const handleUpdateEvent = (updated: ActivityEvent) => {
    setEvents(prev => {
      const updatedList = prev.map(e => e.id === updated.id ? { ...e, ...updated } : e);
      try {
        localStorage.setItem('kombel-events', JSON.stringify(updatedList));
        if ((updated as any).selectedMemberIds && Array.isArray((updated as any).selectedMemberIds)) {
          const currentSm = localStorage.getItem('kombel-event-selected-members');
          const parsedSm = currentSm ? JSON.parse(currentSm) : {};
          parsedSm[updated.id] = (updated as any).selectedMemberIds;
          localStorage.setItem('kombel-event-selected-members', JSON.stringify(parsedSm));
        }
      } catch (e) {}
      return updatedList;
    });
    void logAuditEvent('Jadwal Kegiatan', 'Edit Kegiatan', `Memperbarui kegiatan "${updated.title}".`);
    mutateCloudCollection<ActivityEvent>(
      'events',
      ['kombel-events'],
      (latest) => latest.some(e => e.id === updated.id)
        ? latest.map(e => e.id === updated.id ? { ...e, ...updated } : e)
        : [updated, ...latest],
      events,
      'Jadwal Kegiatan'
    ).then(res => setEvents(res.items));
  };

  const handleDeleteEvent = async (id: string): Promise<boolean> => {
    const deletedEvt = events.find(e => e.id === id);
    const nextFallback = events.filter(e => e.id !== id);
    setEvents(prev => {
      const updatedList = prev.filter(e => e.id !== id);
      try {
        localStorage.setItem('kombel-events', JSON.stringify(updatedList));
      } catch (e) {}
      return updatedList;
    });
    const res = await mutateCloudCollection<ActivityEvent>(
      'events',
      ['kombel-events'],
      (latest) => latest.filter(e => e.id !== id),
      nextFallback,
      'Jadwal Kegiatan'
    );
    setEvents(res.items);
    if (deletedEvt) {
      void logAuditEvent('Jadwal Kegiatan', 'Hapus Kegiatan', `Menghapus kegiatan "${deletedEvt.title}".`);
    }
    return res.success;
  };
  
  const handleOpenAttendanceFromDashboard = (event: ActivityEvent) => {
    setSelectedEventForAbsensi(event);
    setActiveTab('jadwal');
  };

  const handleAddAnnouncement = (newAnn: Omit<Announcement, 'id'>) => {
    const created: Announcement = {
      ...newAnn,
      id: `ann-${Date.now()}`
    };
    setAnnouncements(prev => {
      const updated = [created, ...prev];
      try {
        localStorage.setItem('kombel-announcements', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
    void logAuditEvent('Pengumuman', 'Tambah Pengumuman', `Menerbitkan pengumuman "${created.title}".`);
    mutateCloudCollection<Announcement>(
      'announcements',
      ['kombel-announcements'],
      (latest) => [created, ...latest.filter(a => a.id !== created.id)],
      announcements,
      'Pengumuman'
    ).then(res => setAnnouncements(res.items));
  };

  const handleEditAnnouncement = (updatedAnn: Announcement) => {
    setAnnouncements(prev => {
      const updated = prev.map(a => a.id === updatedAnn.id ? updatedAnn : a);
      try {
        localStorage.setItem('kombel-announcements', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
    void logAuditEvent('Pengumuman', 'Edit Pengumuman', `Memperbarui pengumuman "${updatedAnn.title}".`);
    mutateCloudCollection<Announcement>(
      'announcements',
      ['kombel-announcements'],
      (latest) => latest.some(a => a.id === updatedAnn.id)
        ? latest.map(a => a.id === updatedAnn.id ? updatedAnn : a)
        : [updatedAnn, ...latest],
      announcements,
      'Pengumuman'
    ).then(res => setAnnouncements(res.items));
  };

  const handleCopyAnnouncement = (item: Announcement) => {
    const copied: Announcement = {
      ...item,
      id: `ann-${Date.now()}`,
      title: `${item.title} (Salinan)`
    };
    setAnnouncements(prev => {
      const updated = [copied, ...prev];
      try {
        localStorage.setItem('kombel-announcements', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
    void logAuditEvent('Pengumuman', 'Salin Pengumuman', `Menyalin pengumuman "${item.title}".`);
    mutateCloudCollection<Announcement>(
      'announcements',
      ['kombel-announcements'],
      (latest) => [copied, ...latest.filter(a => a.id !== copied.id)],
      announcements,
      'Pengumuman'
    ).then(res => setAnnouncements(res.items));
  };

  const handleDeleteAnnouncement = async (id: string | number): Promise<boolean> => {
    const deletedAnn = announcements.find(a => a.id === id);
    const nextFallback = announcements.filter(a => a.id !== id);
    setAnnouncements(prev => {
      const updated = prev.filter(a => a.id !== id);
      try {
        localStorage.setItem('kombel-announcements', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
    const res = await mutateCloudCollection<Announcement>(
      'announcements',
      ['kombel-announcements'],
      (latest) => latest.filter(a => a.id !== id),
      nextFallback,
      'Pengumuman'
    );
    setAnnouncements(res.items);
    if (deletedAnn) {
      void logAuditEvent('Pengumuman', 'Hapus Pengumuman', `Menghapus pengumuman "${deletedAnn.title}".`);
    }
    return res.success;
  };

  return (
    <>
      {showWelcomePopup && (
        <div
          onClick={unlockWelcomeAudio}
          className={`fixed inset-0 z-[99999] flex items-center justify-center p-4 sm:p-6 overflow-hidden transition-all duration-500 ${
            welcomePhase === 'exiting' ? 'welcome-backdrop-exit pointer-events-none' : 'animate-in fade-in'
          } ${
            theme === 'dark' ? 'bg-stone-950 text-stone-100' : 'bg-[#2b1012] text-stone-900'
          }`}
        >
          {/* Tombol Kontrol Backsound di Pojok Kanan Atas */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (!isWelcomeAudioMuted && !isWelcomeAudioUnlocked) {
                unlockWelcomeAudio();
                return;
              }
              const nextMuted = !isWelcomeAudioMuted;
              setIsWelcomeAudioMuted(nextMuted);
              if (nextMuted && welcomeAudioCtxRef.current && welcomeMasterGainRef.current) {
                try {
                  const ctx = welcomeAudioCtxRef.current;
                  welcomeMasterGainRef.current.gain.setValueAtTime(0.0001, ctx.currentTime);
                } catch {}
              } else if (!nextMuted) {
                unlockWelcomeAudio();
              }
            }}
            title={
              isWelcomeAudioMuted
                ? 'Aktifkan Suara'
                : !isWelcomeAudioUnlocked
                ? 'Ketuk untuk Mengaktifkan Backsound Browser'
                : 'Senyapkan Suara'
            }
            className={`fixed top-4 right-4 z-40 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold backdrop-blur-md border transition-all duration-300 cursor-pointer ${
              welcomePhase === 'blackout' || welcomePhase === 'exiting' ? 'opacity-0 pointer-events-none' : 'opacity-90 hover:opacity-100'
            } ${
              !isWelcomeAudioMuted && !isWelcomeAudioUnlocked
                ? theme === 'dark'
                  ? 'bg-amber-500/20 border-amber-400/70 text-amber-300 hover:bg-amber-500/30 animate-pulse'
                  : 'bg-amber-50/95 border-amber-500/80 text-red-900 hover:bg-white shadow-sm animate-pulse'
                : theme === 'dark'
                ? 'bg-stone-900/70 border-stone-700/70 text-amber-300 hover:bg-stone-800/80'
                : 'bg-white/75 border-stone-300/80 text-red-900 hover:bg-white/95'
            }`}
          >
            {isWelcomeAudioMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            <span>
              {isWelcomeAudioMuted
                ? 'Suara Mati'
                : !isWelcomeAudioUnlocked
                ? 'Ketuk Layar untuk Suara'
                : 'Audio Aktif'}
            </span>
          </button>
          {/* Lapisan Gambar Batik Kusuma Bangsa Efek Blur & Ken Burns */}
          <img
            src={batikKusumaBangsaBg}
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover blur-[10px] select-none pointer-events-none welcome-batik-kenburns"
          />
          {/* Lapisan Penyeimbang Kontras & Vignette */}
          <div
            aria-hidden="true"
            className={`absolute inset-0 pointer-events-none ${
              theme === 'dark'
                ? 'bg-gradient-to-br from-stone-950/75 via-[#2a0b0d]/65 to-stone-950/85'
                : 'bg-gradient-to-br from-[#f7f5f2]/35 via-stone-900/20 to-[#450a0a]/40'
            }`}
          />
          {/* Cinematic Vignette Focus pada Latar Batik Saat Fase Pembesaran Logo */}
          <div
            aria-hidden="true"
            className={`absolute inset-0 pointer-events-none transition-opacity duration-1000 ${
              welcomePhase === 'showcase' || welcomePhase === 'blackout' || welcomePhase === 'exiting'
                ? 'opacity-100'
                : 'opacity-0'
            }`}
            style={{
              background:
                'radial-gradient(circle at center, rgba(0, 0, 0, 0) 28%, rgba(18, 6, 8, 0.55) 75%, rgba(8, 3, 4, 0.85) 100%)'
            }}
          />
          {/* Partikel Cahaya Emas Melayang (Floating Golden Dust) */}
          <div aria-hidden="true" className="absolute inset-0 overflow-hidden pointer-events-none z-[5]">
            <span className="welcome-dust-particle left-[12%] bottom-[8%] w-1.5 h-1.5 [animation-duration:9s] [animation-delay:0s]" />
            <span className="welcome-dust-particle left-[24%] bottom-[15%] w-1 h-1 [animation-duration:11s] [animation-delay:1.4s]" />
            <span className="welcome-dust-particle left-[38%] bottom-[5%] w-2 h-2 [animation-duration:10s] [animation-delay:0.6s]" />
            <span className="welcome-dust-particle left-[55%] bottom-[12%] w-1.5 h-1.5 [animation-duration:12s] [animation-delay:2.1s]" />
            <span className="welcome-dust-particle left-[68%] bottom-[6%] w-1 h-1 [animation-duration:8.5s] [animation-delay:0.9s]" />
            <span className="welcome-dust-particle left-[80%] bottom-[18%] w-2 h-2 [animation-duration:11.5s] [animation-delay:1.8s]" />
            <span className="welcome-dust-particle left-[90%] bottom-[10%] w-1.5 h-1.5 [animation-duration:9.5s] [animation-delay:0.3s]" />
          </div>

          <div className="relative z-10 w-full max-w-lg flex items-center justify-center">
            {/* Kotak Kartu Loading (Perlahan Menghilang Saat Masuk Fase Showcase 5 Detik) */}
            <div className={`w-full p-6 sm:p-10 rounded-2xl border shadow-2xl text-center overflow-hidden ${
              welcomePhase === 'showcase' || welcomePhase === 'blackout' || welcomePhase === 'exiting'
                ? 'welcome-card-dissolve pointer-events-none'
                : 'welcome-stagger-1'
            } ${
              theme === 'dark'
                ? 'bg-stone-900/95 border-stone-800 shadow-black/60 pgri-batik-pattern-dark'
                : 'bg-[#fcfbf9] border-stone-200/90 shadow-stone-900/25 pgri-batik-pattern'
            }`}>
              <div className="absolute top-0 inset-x-0 h-[3px] pgri-top-accent" />
              <div className={`absolute bottom-0 inset-x-0 h-[2px] pgri-top-accent transition-opacity duration-300 ${
                welcomePhase === 'ready' || welcomePhase === 'showcase' || welcomePhase === 'blackout' || welcomePhase === 'exiting' ? 'opacity-90' : 'opacity-0'
              }`} />

              {/* Placeholder Penjaga Tinggi Posisi Logo di dalam Kartu */}
              <div className="h-20 sm:h-24 mb-6" aria-hidden="true" />

              <div className="space-y-1.5 welcome-stagger-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-800 dark:text-amber-400">
                  Digitalisasi Organisasi
                </p>
                <div className="pt-1 font-display text-2xl sm:text-3xl font-extrabold tracking-tight leading-tight">
                  <h1>Selamat Datang</h1>
                  <h2>di PGRI Ranting Gelang</h2>
                </div>
                <h2 className="text-sm sm:text-base font-bold text-red-800 dark:text-amber-400 pt-1">
                  Kecamatan Sumberbaru - Kabupaten Jember
                </h2>
                <p className={`text-xs sm:text-sm font-medium ${theme === 'dark' ? 'text-stone-400' : 'text-stone-600'}`}>
                  Organisasi Profesi Yang Mewadahi Para Guru, Pendidik, dan Tenaga Kependidikan di Guslah Gelang
                </p>
              </div>

              <div className={`mt-8 pt-4 border-t welcome-stagger-4 ${theme === 'dark' ? 'border-stone-800' : 'border-stone-200/80'}`}>
                <div className="flex items-center justify-between text-xs font-medium mb-2.5 gap-2">
                  <span className={`inline-flex items-center gap-2 transition-colors duration-200 text-left ${
                    welcomePhase === 'ready' || welcomePhase === 'showcase' || welcomePhase === 'blackout' || welcomePhase === 'exiting'
                      ? (theme === 'dark' ? 'text-emerald-400 font-semibold' : 'text-emerald-700 font-semibold')
                      : (theme === 'dark' ? 'text-stone-400' : 'text-stone-600')
                  }`}>
                    {welcomePhase === 'ready' || welcomePhase === 'showcase' || welcomePhase === 'blackout' || welcomePhase === 'exiting' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    ) : (
                      <span className="inline-flex items-center gap-1 shrink-0" aria-hidden="true">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-700 dark:bg-amber-400 welcome-dot-1" />
                        <span className="w-1.5 h-1.5 rounded-full bg-red-700 dark:bg-amber-400 welcome-dot-2" />
                        <span className="w-1.5 h-1.5 rounded-full bg-red-700 dark:bg-amber-400 welcome-dot-3" />
                      </span>
                    )}
                    <span>
                      {welcomePhase === 'ready' || welcomePhase === 'showcase' || welcomePhase === 'blackout' || welcomePhase === 'exiting'
                        ? 'Ruang Kerja Siap'
                        : welcomeProgress <= 25
                        ? 'Memuat identitas PGRI Ranting Gelang...'
                        : welcomeProgress <= 55
                        ? 'Menyelaraskan jadwal kegiatan & presensi...'
                        : welcomeProgress <= 85
                        ? 'Menyiapkan data kas, program kerja & e-Office...'
                        : 'Finalisasi ruang kerja digital...'}
                    </span>
                  </span>
                  <div className="flex items-center gap-1.5 font-bold tracking-wider font-mono shrink-0">
                    <span className={theme === 'dark' ? 'text-stone-400' : 'text-stone-500'}>
                      {welcomePhase === 'ready' || welcomePhase === 'showcase' || welcomePhase === 'blackout' || welcomePhase === 'exiting' ? 'Selesai' : 'Memuat'}
                    </span>
                    <span className="text-red-800 dark:text-amber-400 font-bold min-w-[36px] text-right">{welcomeProgress}%</span>
                  </div>
                </div>

                <div className={`w-full h-1.5 rounded-full overflow-hidden ${
                  theme === 'dark' ? 'bg-stone-800' : 'bg-stone-200'
                }`}>
                  <div 
                    className={`relative overflow-hidden h-full bg-gradient-to-r from-red-800 via-red-600 to-amber-500 rounded-full transition-all duration-100 ease-out ${
                      welcomePhase === 'ready' || welcomePhase === 'showcase' || welcomePhase === 'blackout' || welcomePhase === 'exiting' ? 'brightness-110 shadow-[0_0_10px_rgba(217,119,6,0.45)]' : ''
                    }`}
                    style={{ width: `${welcomeProgress}%` }}
                  >
                    <div
                      aria-hidden="true"
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/45 to-transparent welcome-progress-shimmer"
                    />
                  </div>
                </div>

                {welcomePhase === 'ready' && !isWelcomeAudioMuted && !isWelcomeAudioUnlocked && (
                  <div className="mt-5 flex flex-col items-center gap-2 animate-in fade-in duration-300">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        unlockWelcomeAudio();
                        setWelcomePhase('showcase');
                      }}
                      className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-red-800 via-red-700 to-amber-600 hover:from-red-700 hover:to-amber-500 text-white text-xs sm:text-sm font-bold shadow-lg shadow-red-900/25 transition-all active:scale-[0.98] cursor-pointer"
                    >
                      <Volume2 className="w-4 h-4 shrink-0" />
                      <span>Buka Portal &amp; Aktifkan Suara</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsWelcomeAudioMuted(true);
                        setWelcomePhase('showcase');
                      }}
                      className={`text-[11px] font-semibold underline-offset-2 hover:underline cursor-pointer ${
                        theme === 'dark' ? 'text-stone-400 hover:text-stone-200' : 'text-stone-500 hover:text-stone-800'
                      }`}
                    >
                      Lanjutkan tanpa suara
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Layer Logo Independen: Bergerak ke Tengah & Membesar Hampir Memenuhi Layar dengan Cahaya Realistis */}
            <div className={`absolute inset-x-0 z-20 flex justify-center pointer-events-none ${
              welcomePhase === 'showcase' || welcomePhase === 'blackout' || welcomePhase === 'exiting'
                ? 'top-1/2 -translate-y-1/2 welcome-logo-center-showcase'
                : 'top-6 sm:top-10 welcome-stagger-2'
            }`}>
              <div className="relative flex items-center justify-center">
                {/* Lapisan Cahaya Jauh (Ambient Falloff: Semakin Keluar Semakin Memudar Hilang) */}
                {welcomePhase === 'showcase' || welcomePhase === 'blackout' || welcomePhase === 'exiting' ? (
                  <>
                    <div
                      aria-hidden="true"
                      className="absolute -inset-16 rounded-full pointer-events-none welcome-logo-rim-pulse"
                      style={{
                        background:
                          'radial-gradient(circle, rgba(255, 248, 220, 0.72) 0%, rgba(251, 191, 36, 0.38) 24%, rgba(220, 38, 38, 0.16) 48%, rgba(185, 28, 28, 0.05) 70%, rgba(185, 28, 28, 0) 100%)'
                      }}
                    />
                    {/* Lapisan Cahaya Inti Dekat Logo (Terang di Tepi Logo, Menyebar Halus) */}
                    <div
                      aria-hidden="true"
                      className="absolute -inset-5 rounded-full blur-md pointer-events-none welcome-logo-edge-ring"
                      style={{
                        background:
                          'radial-gradient(circle, rgba(255, 255, 240, 0.9) 0%, rgba(253, 224, 71, 0.45) 38%, rgba(245, 158, 11, 0.12) 68%, rgba(245, 158, 11, 0) 100%)'
                      }}
                    />
                  </>
                ) : (
                  <div
                    aria-hidden="true"
                    className="absolute -inset-2 rounded-3xl bg-gradient-to-tr from-red-700/30 via-amber-500/25 to-red-800/30 blur-xl welcome-logo-glow pointer-events-none"
                  />
                )}
                <div className={`relative flex items-center justify-center w-20 h-20 sm:w-24 sm:h-24 transition-transform duration-700 ${
                  welcomePhase === 'showcase' || welcomePhase === 'blackout' || welcomePhase === 'exiting'
                    ? 'p-0 rounded-full bg-transparent border-0 border-transparent outline-none ring-0 shadow-none'
                    : `p-2 rounded-2xl bg-gradient-to-tr from-red-900/15 via-red-800/10 to-amber-500/15 border border-red-800/25 shadow-md ${
                        welcomePhase === 'ready' ? 'scale-[1.04]' : ''
                      }`
                }`}>
                  <div className={`relative w-full h-full flex items-center justify-center ${
                    welcomePhase === 'showcase' || welcomePhase === 'blackout' || welcomePhase === 'exiting'
                      ? 'rounded-full overflow-visible'
                      : 'rounded-xl overflow-hidden'
                  }`}>
                    {kombelLogo ? (
                      <img
                        src={kombelLogo}
                        alt="Logo PGRI"
                        className={`w-full h-full object-contain transition-all duration-700 ${
                          welcomePhase === 'showcase' || welcomePhase === 'blackout' || welcomePhase === 'exiting'
                            ? 'drop-shadow-[0_0_4px_rgba(255,252,235,0.95)] drop-shadow-[0_0_14px_rgba(251,191,36,0.55)]'
                            : ''
                        }`}
                      />
                    ) : (
                      <div className="flex items-center justify-center w-full h-full rounded-xl bg-gradient-to-tr from-red-900 via-red-800 to-amber-600 text-white">
                        <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                      </div>
                    )}
                    {/* Kilauan Cahaya Diagonal Menyapu Permukaan Logo (Terpotong Bulat Mengikuti Logo) */}
                    {(welcomePhase === 'showcase' || welcomePhase === 'blackout' || welcomePhase === 'exiting') && (
                      <div
                        aria-hidden="true"
                        className="absolute inset-0 rounded-full overflow-hidden pointer-events-none"
                      >
                        <div
                          className="w-full h-full welcome-logo-sheen"
                          style={{
                            background:
                              'linear-gradient(120deg, transparent 25%, rgba(255, 255, 255, 0.55) 50%, transparent 75%)'
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Semboyan Organisasi dengan Efek Cinematic Tracking di Bawah Layar */}
          {(welcomePhase === 'showcase' || welcomePhase === 'blackout' || welcomePhase === 'exiting') && (
            <div className="fixed inset-x-0 bottom-8 sm:bottom-12 z-20 flex justify-center px-6 pointer-events-none">
              <p className="text-[10px] sm:text-xs font-bold uppercase text-amber-100/90 text-center drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)] welcome-motto-tracking">
                HIDUP GURU &bull; HIDUP PGRI &bull; SOLIDARITAS YES
              </p>
            </div>
          )}

          {/* Lapisan Penutup Gelap Perlahan di Akhir Pembesaran Logo Sebelum Membuka Beranda */}
          <div
            aria-hidden="true"
            className={`fixed inset-0 z-30 bg-black pointer-events-none transition-opacity duration-[900ms] ease-in-out ${
              welcomePhase === 'blackout' || welcomePhase === 'exiting' ? 'opacity-100' : 'opacity-0'
            }`}
          />
        </div>
      )}

      <div className={`min-h-screen font-sans antialiased flex flex-col lg:flex-row selection:bg-red-800 selection:text-white transition-colors duration-300 ${
        welcomePhase === 'loading' || welcomePhase === 'ready' || welcomePhase === 'showcase' || welcomePhase === 'blackout'
          ? 'app-shell-pre-reveal'
          : welcomePhase === 'exiting'
            ? 'app-shell-revealing'
            : ''
      } ${theme === 'dark' ? 'bg-stone-950 text-stone-100' : 'bg-[#f7f5f2] text-stone-800'
        }`}>

      <style>{`
        *, *::before, *::after, html, body {
          scrollbar-width: thin !important;
          scrollbar-color: ${theme === 'dark' ? '#44403c transparent' : '#d6d3d1 transparent'} !important;
        }
        ::-webkit-scrollbar {
          width: 6px !important;
          height: 6px !important;
        }
        ::-webkit-scrollbar-track {
          background: transparent !important;
        }
        ::-webkit-scrollbar-thumb {
          background-color: ${theme === 'dark' ? 'rgba(68, 64, 60, 0.85)' : 'rgba(214, 211, 209, 0.9)'} !important;
          border-radius: 9999px !important;
        }
        ::-webkit-scrollbar-thumb:hover {
          background-color: ${theme === 'dark' ? 'rgba(87, 83, 78, 1)' : 'rgba(168, 162, 158, 1)'} !important;
        }
        ::-webkit-scrollbar-corner {
          background: transparent !important;
        }
        ::-webkit-scrollbar-button {
          display: none !important;
          width: 0 !important;
          height: 0 !important;
        }

        @keyframes welcomeFadeUp {
          from {
            opacity: 0;
            transform: translateY(16px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes welcomeBackdropOut {
          0% {
            opacity: 1;
            backdrop-filter: blur(20px);
          }
          100% {
            opacity: 0;
            backdrop-filter: blur(0px);
          }
        }
        @keyframes welcomeCardExit {
          0% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0px);
          }
          100% {
            opacity: 0;
            transform: translateY(-20px) scale(0.96);
            filter: blur(5px);
          }
        }
        @keyframes welcomeCardDissolve {
          0% {
            opacity: 1;
            transform: scale(1);
            filter: blur(0px);
          }
          100% {
            opacity: 0;
            transform: scale(0.94);
            filter: blur(8px);
          }
        }
        @keyframes welcomeLogoCenterShowcase {
          0% {
            transform: translateY(-110px) scale(1);
          }
          18% {
            transform: translateY(0) scale(1.6);
          }
          100% {
            transform: translateY(0) scale(4.4);
          }
        }
        @keyframes welcomeLogoRimPulse {
          0%, 100% {
            opacity: 0.75;
            transform: scale(0.95);
          }
          50% {
            opacity: 1;
            transform: scale(1.08);
          }
        }
        @keyframes welcomeLogoEdgeRing {
          0%, 100% {
            opacity: 0.78;
            transform: scale(0.97);
          }
          50% {
            opacity: 1;
            transform: scale(1.05);
          }
        }
        @keyframes welcomeLogoCenterExit {
          0% {
            opacity: 1;
            transform: translateY(0) scale(4.4);
            filter: blur(0px);
          }
          100% {
            opacity: 0;
            transform: translateY(0) scale(4.8);
            filter: blur(8px);
          }
        }
        @keyframes appShellReveal {
          0% {
            opacity: 0.9;
            transform: scale(0.986);
            filter: blur(6px);
          }
          100% {
            opacity: 1;
            transform: scale(1);
            filter: blur(0px);
          }
        }
        @keyframes shellSidebarReveal {
          0% {
            opacity: 0;
            transform: translateX(-14px);
          }
          100% {
            opacity: 1;
            transform: translateX(0);
          }
        }
        @keyframes shellHeaderReveal {
          0% {
            opacity: 0;
            transform: translateY(-10px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes welcomeBatikKenBurns {
          0% {
            transform: scale(1.16) translate3d(0, 0, 0);
          }
          100% {
            transform: scale(1.26) translate3d(-1%, -1%, 0);
          }
        }
        @keyframes welcomeLogoGlow {
          0%, 100% {
            opacity: 0.45;
            transform: scale(0.96);
          }
          50% {
            opacity: 0.9;
            transform: scale(1.06);
          }
        }
        @keyframes welcomeProgressShimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
        @keyframes welcomeDotPulse {
          0%, 80%, 100% {
            opacity: 0.3;
            transform: scale(0.8);
          }
          40% {
            opacity: 1;
            transform: scale(1.15);
          }
        }
        .welcome-batik-kenburns {
          animation: welcomeBatikKenBurns 11s ease-out forwards;
          will-change: transform;
        }
        .welcome-card-dissolve {
          animation: welcomeCardDissolve 0.85s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          will-change: transform, opacity, filter;
        }
        .welcome-logo-center-showcase {
          animation: welcomeLogoCenterShowcase 5s cubic-bezier(0.22, 1, 0.36, 1) forwards;
          will-change: transform;
        }
        .welcome-logo-rim-pulse {
          animation: welcomeLogoRimPulse 2.2s ease-in-out infinite;
          will-change: transform, opacity;
        }
        .welcome-logo-edge-ring {
          animation: welcomeLogoEdgeRing 2.6s ease-in-out infinite;
        }
        .welcome-logo-center-exit {
          animation: welcomeLogoCenterExit 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          will-change: transform, opacity, filter;
        }
        @keyframes welcomeDustFloat {
          0% {
            opacity: 0;
            transform: translateY(0) scale(0.7);
          }
          20% {
            opacity: 0.75;
          }
          80% {
            opacity: 0.45;
          }
          100% {
            opacity: 0;
            transform: translateY(-75vh) scale(1.15);
          }
        }
        @keyframes welcomeLogoSheen {
          0%, 15% {
            transform: translateX(-140%) skewX(-20deg);
            opacity: 0;
          }
          35% {
            opacity: 0.85;
          }
          55% {
            transform: translateX(140%) skewX(-20deg);
            opacity: 0;
          }
          100% {
            transform: translateX(140%) skewX(-20deg);
            opacity: 0;
          }
        }
        @keyframes welcomeMottoTracking {
          0% {
            opacity: 0;
            letter-spacing: 0.14em;
            transform: translateY(8px);
          }
          22% {
            opacity: 1;
            transform: translateY(0);
          }
          100% {
            opacity: 0.95;
            letter-spacing: 0.34em;
            transform: translateY(0);
          }
        }
        .welcome-dust-particle {
          position: absolute;
          border-radius: 9999px;
          background: radial-gradient(circle, rgba(254, 243, 199, 0.95) 0%, rgba(251, 191, 36, 0.45) 55%, rgba(251, 191, 36, 0) 100%);
          box-shadow: 0 0 8px rgba(251, 191, 36, 0.65);
          animation-name: welcomeDustFloat;
          animation-timing-function: ease-in-out;
          animation-iteration-count: infinite;
          will-change: transform, opacity;
        }
        .welcome-logo-sheen {
          animation: welcomeLogoSheen 3.2s ease-in-out infinite 0.5s;
          will-change: transform, opacity;
        }
        .welcome-motto-tracking {
          animation: welcomeMottoTracking 4.8s cubic-bezier(0.22, 1, 0.36, 1) forwards;
          will-change: letter-spacing, opacity, transform;
        }
        .welcome-logo-glow {
          animation: welcomeLogoGlow 3.2s ease-in-out infinite;
          will-change: transform, opacity;
        }
        .welcome-progress-shimmer {
          animation: welcomeProgressShimmer 1.6s linear infinite;
          will-change: transform;
        }
        .welcome-dot-1 {
          animation: welcomeDotPulse 1.4s ease-in-out infinite 0s;
        }
        .welcome-dot-2 {
          animation: welcomeDotPulse 1.4s ease-in-out infinite 0.2s;
        }
        .welcome-dot-3 {
          animation: welcomeDotPulse 1.4s ease-in-out infinite 0.4s;
        }
        .welcome-stagger-1 {
          animation: welcomeFadeUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .welcome-stagger-2 {
          animation: welcomeFadeUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both;
        }
        .welcome-stagger-3 {
          animation: welcomeFadeUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.2s both;
        }
        .welcome-stagger-4 {
          animation: welcomeFadeUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.3s both;
        }
        .welcome-backdrop-exit {
          animation: welcomeBackdropOut 0.56s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          will-change: opacity;
        }
        .welcome-card-exit {
          animation: welcomeCardExit 0.48s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          will-change: transform, opacity, filter;
        }
        .app-shell-pre-reveal {
          opacity: 0.9;
          transform: scale(0.986);
          filter: blur(6px);
          will-change: transform, opacity, filter;
        }
        .app-shell-revealing {
          animation: appShellReveal 0.55s cubic-bezier(0.16, 1, 0.3, 1) both;
          will-change: transform, opacity, filter;
        }
        @media (min-width: 1024px) {
          .app-shell-revealing aside.sidebar-container {
            animation: shellSidebarReveal 0.48s cubic-bezier(0.16, 1, 0.3, 1) both;
          }
        }
        .app-shell-revealing header {
          animation: shellHeaderReveal 0.45s cubic-bezier(0.16, 1, 0.3, 1) 60ms both;
        }
        @keyframes menuTopSweep {
          0% {
            transform: scaleX(0);
            opacity: 1;
          }
          70% {
            transform: scaleX(1);
            opacity: 1;
          }
          100% {
            transform: scaleX(1);
            opacity: 0;
          }
        }
        @keyframes menuCurtainIn {
          from {
            opacity: 0;
            transform: translateY(10px) scale(0.97);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes menuCurtainOut {
          from {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0px);
          }
          to {
            opacity: 0;
            transform: translateY(-14px) scale(0.96);
            filter: blur(4px);
          }
        }
        @keyframes menuWipeSweep {
          0% {
            transform: translateX(-100%);
            opacity: 0.7;
          }
          50% {
            opacity: 0.95;
          }
          100% {
            transform: translateX(100%);
            opacity: 0;
          }
        }
        @keyframes menuContentEnter {
          from {
            opacity: 0;
            transform: translateY(14px) scale(0.988);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .menu-top-sweep {
          transform-origin: left center;
          animation: menuTopSweep 0.78s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        .menu-curtain-enter {
          animation: menuCurtainIn 0.28s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .menu-curtain-exit {
          animation: menuCurtainOut 0.38s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .menu-wipe-bar {
          animation: menuWipeSweep 0.52s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }
        .menu-content-waiting {
          opacity: 0;
          transform: translateY(14px) scale(0.988);
          pointer-events: none;
        }
        .menu-content-revealing {
          animation: menuContentEnter 0.44s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        @media (prefers-reduced-motion: reduce) {
          .welcome-backdrop-exit,
          .welcome-card-exit,
          .welcome-card-dissolve,
          .welcome-logo-center-showcase,
          .welcome-logo-rim-pulse,
          .welcome-logo-edge-ring,
          .welcome-logo-center-exit,
          .welcome-dust-particle,
          .welcome-logo-sheen,
          .welcome-motto-tracking,
          .welcome-batik-kenburns,
          .welcome-logo-glow,
          .welcome-progress-shimmer,
          .welcome-dot-1,
          .welcome-dot-2,
          .welcome-dot-3,
          .app-shell-revealing,
          .app-shell-revealing aside.sidebar-container,
          .app-shell-revealing header,
          .menu-top-sweep,
          .menu-curtain-enter,
          .menu-curtain-exit,
          .menu-wipe-bar,
          .menu-content-revealing {
            animation-duration: 0.01ms !important;
            animation-delay: 0ms !important;
          }
          .app-shell-pre-reveal,
          .menu-content-waiting {
            transform: none !important;
            filter: none !important;
          }
        }
      `}</style>

      <Sidebar
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          setSelectedEventForAbsensi(null);
        }}
        isOpenMobile={isOpenMobileSidebar}
        onCloseMobile={() => setIsOpenMobileSidebar(false)}
        theme={theme}
        activeRole={activeRole}
        onChangeRole={setActiveRole}
        pengurusRole={pengurusRole}
        onChangePengurusRole={setPengurusRole}
        authEmail={authEmail}
        currentUser={currentUser}
        pengaturanSubTab={pengaturanSubTab}
        onPengaturanSubTabChange={setPengaturanSubTab}
      />

      <div className={`flex-1 flex-col min-w-0 min-h-screen transition-colors duration-300 ${theme === 'dark' ? 'bg-stone-950' : 'bg-[#f7f5f2]'
        }`}>

        <Header
          currentDate={currentDate}
          onSync={handleSync}
          isSyncing={isSyncing}
          currentUser={currentUser}
          onToggleMobileSidebar={() => setIsOpenMobileSidebar(!isOpenMobileSidebar)}
          activeRole={activeRole}
          onChangeRole={setActiveRole}
          theme={theme}
          onToggleTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')}
        />

        <main className={`relative flex-1 p-4 sm:p-6 lg:p-8 w-full space-y-6 transition-colors duration-300 ${theme === 'dark' ? 'bg-stone-950' : 'bg-[#f7f5f2]'
          }`}>
          <MenuTransitionCurtain
            key={menuTransitionKey}
            activeTab={activeTab}
            pengaturanSubTab={pengaturanSubTab}
            phase={menuEntryPhase}
            theme={theme}
          />

          <div
            className={`space-y-6 ${
              menuEntryPhase === 'intro'
                ? 'menu-content-waiting'
                : menuEntryPhase === 'revealing'
                  ? 'menu-content-revealing'
                  : ''
            }`}
          >
          <React.Suspense
            fallback={
              <div className={`min-h-[320px] flex flex-col items-center justify-center gap-3 rounded-2xl border ${
                theme === 'dark'
                  ? 'bg-stone-900/60 border-stone-800 text-stone-300'
                  : 'bg-white/70 border-stone-200/80 text-stone-600'
              }`}>
                <div className="w-8 h-8 rounded-full border-[3px] border-red-800/25 border-t-red-800 dark:border-amber-400/25 dark:border-t-amber-400 animate-spin" />
                <p className="text-xs font-semibold tracking-wide">Memuat tampilan menu...</p>
              </div>
            }
          >
          {activeTab === 'beranda' && (
            <BerandaView
              onNavigate={navigateWithLockCheck}
              events={events}
              onOpenAttendance={handleOpenAttendanceFromDashboard}
              theme={theme}
              teachers={teachers}
              cashPayments={cashPayments}
              attendanceList={attendanceList}
              isEntryReady={(welcomePhase === 'exiting' || welcomePhase === 'done') && menuEntryPhase !== 'intro'}
            />
          )}

          {activeTab === 'profil' && <ProfilKBView activeRole={roleForTab('profil')} />}

          {activeTab === 'anggota' && (
            <AnggotaView
              teachers={teachers}
              onTeachersChange={setTeachers}
              activeRole={roleForTab('anggota')}
              events={events}
              attendanceList={attendanceList}
            />
          )}

          {activeTab === 'jadwal' && (
            <JadwalView
              events={events}
              onEventsChange={setEvents}
              attendanceList={attendanceList}
              onAttendanceListChange={setAttendanceList}
              teachers={teachers}
              onAddAttendance={handleAddAttendance}
              onAddBulkAttendance={handleAddBulkAttendance}
              onUpdateAttendance={handleUpdateAttendance}
              onDeleteAttendance={handleDeleteAttendance}
              onAddEvent={handleAddEvent}
              onUpdateEvent={handleUpdateEvent}
              onDeleteEvent={handleDeleteEvent}
              currentUser={currentUser}
              selectedEventForAbsensi={selectedEventForAbsensi}
              activeRole={roleForTab('jadwal')}
            />
          )}

          {activeTab === 'keuangan' && (
            <KeuanganView
              transactions={financialTransactions}
              onTransactionsChange={setFinancialTransactions}
              cashPayments={cashPayments}
              onCashPaymentsChange={setCashPayments}
              teachers={teachers}
              events={events}
              activeRole={roleForTab('keuangan')}
            />
          )}

          {activeTab === 'proker' && (
            <ProkerView
              activeRole={roleForTab('proker')}
              pengurusRole={pengurusRole}
              theme={theme}
            />
          )}

          {activeTab === 'sosial' && (
            <SosialAspirasiView
              activeRole={roleForTab('sosial')}
              pengurusRole={pengurusRole}
              theme={theme}
            />
          )}

          {activeTab === 'undangan' && (
            <BuatUndangan
              activeRole={roleForTab('undangan')}
              teachers={teachers}
              events={events}
              attendanceList={attendanceList}
              theme={theme}
            />
          )}

          {activeTab === 'pengaturan' && roleForTab('pengaturan') === 'admin' && (
            <PengaturanView
              activeRole={roleForTab('pengaturan')}
              pengurusRole={pengurusRole}
              activeSubTab={pengaturanSubTab}
            />
          )}

          {activeTab === 'dokumen' && (
            <PengumumanView
              announcements={announcements}
              isAdmin={roleForTab('dokumen') === 'admin'}
              onAdd={handleAddAnnouncement}
              onEdit={handleEditAnnouncement}
              onCopy={handleCopyAnnouncement}
              onDelete={handleDeleteAnnouncement}
            />
          )}

          {activeTab === 'kontak' && (
            <KontakView
              teachers={teachers}
              activeRole={roleForTab('kontak')}
            />
          )}
          </React.Suspense>
          </div>
        </main>

        <footer className={`w-full py-4 px-6 text-center text-xs border-t mt-auto transition-colors duration-300 ${theme === 'dark' ? 'bg-stone-900/70 border-stone-800 text-stone-400' : 'bg-[#faf8f5]/80 border-stone-200/80 text-stone-500'
          }`}>
          © {new Date().getFullYear()} PGRI Ranting Gelang Kecamatan Sumberbaru. Kabupaten Jember, Jawa Timur. All Rights Reserved.
        </footer>
      </div>
    </div>

    {/* Toast Status Sinkronisasi Cloud */}
    {syncToast && (
      <div className={`fixed bottom-5 right-5 z-[10000] max-w-sm px-4 py-3 rounded-2xl shadow-2xl border flex items-center gap-3 animate-in slide-in-from-bottom duration-200 ${
        syncToast.type === 'success'
          ? (theme === 'dark' ? 'bg-stone-900/95 border-emerald-500/40 text-emerald-200' : 'bg-white/95 border-emerald-200 text-emerald-800')
          : syncToast.type === 'warning'
          ? (theme === 'dark' ? 'bg-stone-900/95 border-amber-500/40 text-amber-200' : 'bg-white/95 border-amber-200 text-amber-800')
          : (theme === 'dark' ? 'bg-stone-900/95 border-red-500/40 text-red-200' : 'bg-white/95 border-red-200 text-red-800')
      } backdrop-blur-md`}>
        {syncToast.type === 'success' ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
        ) : syncToast.type === 'warning' ? (
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
        ) : (
          <XCircle className="w-5 h-5 text-rose-500 shrink-0" />
        )}
        <span className="text-xs font-semibold leading-snug">{syncToast.message}</span>
      </div>
    )}

    {/* Indikator Offline & Antrean Sinkronisasi PWA */}
    <OfflineIndicator />

    {/* Modal Dialog Pemilihan Menu Sinkronisasi Cloud (Hemat Kuota) */}
    {isSyncModalOpen && (
      <React.Suspense fallback={null}>
        <SyncModal
          isOpen={isSyncModalOpen}
          onClose={() => setIsSyncModalOpen(false)}
          activeTab={activeTab}
          theme={theme}
          onExecuteSync={handleExecuteModularSync}
          isSyncing={isSyncing}
        />
      </React.Suspense>
    )}
    </>
  );
}