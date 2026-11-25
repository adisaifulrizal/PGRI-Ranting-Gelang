import React, { useEffect, useState } from 'react';
import { WifiOff, CloudUpload, AlertTriangle, RefreshCw, Trash2 } from 'lucide-react';
import { useOnlineStatus } from '../hooks/usePWAInstall';
import {
  clearOfflineQueue,
  flushOfflineQueue,
  getOfflineQueueSummary,
  resetOfflineQueueRetries,
} from '../lib/sync';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  const [summary, setSummary] = useState(() => getOfflineQueueSummary());
  const [isFlushing, setIsFlushing] = useState(false);

  useEffect(() => {
    const syncQueueSummary = () => {
      setSummary(getOfflineQueueSummary());
    };
    window.addEventListener('pgri-offline-queue-updated', syncQueueSummary);
    return () => window.removeEventListener('pgri-offline-queue-updated', syncQueueSummary);
  }, []);

  useEffect(() => {
    if (isOnline && summary.retryable > 0 && !isFlushing) {
      setIsFlushing(true);
      flushOfflineQueue(false)
        .finally(() => {
          setSummary(getOfflineQueueSummary());
          setIsFlushing(false);
        });
    }
  }, [isOnline, summary.retryable, isFlushing]);

  const handleManualRetry = () => {
    if (!isOnline || isFlushing) return;
    resetOfflineQueueRetries();
    setIsFlushing(true);
    flushOfflineQueue(true).finally(() => {
      setSummary(getOfflineQueueSummary());
      setIsFlushing(false);
    });
  };

  const handleClearQueue = () => {
    clearOfflineQueue();
    setSummary(getOfflineQueueSummary());
  };

  if (isOnline && summary.total === 0) return null;

  const isFailedOnly = isOnline && summary.retryable === 0 && summary.failed > 0 && !isFlushing;

  return (
    <div
      className={`fixed bottom-4 left-4 z-[9990] flex flex-wrap items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold text-white shadow-xl border backdrop-blur-md max-w-[calc(100vw-2rem)] ${
        !isOnline
          ? 'bg-amber-700/95 border-amber-400/50'
          : isFailedOnly
          ? 'bg-stone-900/95 border-amber-400/60'
          : 'bg-red-900/95 border-amber-400/50'
      }`}
    >
      {!isOnline ? (
        <>
          <WifiOff className="w-4 h-4 shrink-0 animate-pulse" />
          <span>
            Mode Offline — Data tersimpan lokal
            {summary.total > 0 ? ` (${summary.total} antrean sinkron)` : ''}
          </span>
        </>
      ) : isFailedOnly ? (
        <>
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
          <span>
            {summary.failed} antrean offline gagal tersinkron
            {summary.lastError ? ` (${summary.lastError})` : ''}
          </span>
          <div className="flex items-center gap-1.5 ml-1">
            <button
              type="button"
              onClick={handleManualRetry}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-stone-950 text-[11px] font-bold transition-colors cursor-pointer"
              title="Coba kirim ulang antrean"
            >
              <RefreshCw className="w-3 h-3" />
              Coba Lagi
            </button>
            <button
              type="button"
              onClick={handleClearQueue}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/15 hover:bg-red-700 text-white text-[11px] font-bold transition-colors cursor-pointer"
              title="Hapus antrean yang gagal"
            >
              <Trash2 className="w-3 h-3" />
              Hapus
            </button>
          </div>
        </>
      ) : (
        <>
          <CloudUpload className="w-4 h-4 shrink-0 animate-bounce" />
          <span>Menyinkronkan {summary.total} data antrean offline...</span>
        </>
      )}
    </div>
  );
};
