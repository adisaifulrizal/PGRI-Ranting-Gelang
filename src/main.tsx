import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Pulihkan otomatis bila chunk JS gagal dimuat akibat cache versi lama setelah deploy/update
window.addEventListener('vite:preloadError', () => {
  try {
    const key = 'pgri_chunk_reload_ts';
    const last = Number(sessionStorage.getItem(key) || '0');
    if (Date.now() - last > 30000) {
      sessionStorage.setItem(key, String(Date.now()));
      setTimeout(() => window.location.reload(), 1500);
    }
  } catch {}
});

// Bersihkan Service Worker dev lama yang mungkin masih tertinggal di browser saat mode development
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => {
      regs.forEach((reg) => {
        if (reg.active?.scriptURL?.includes('dev-sw.js')) {
          void reg.unregister();
        }
      });
    })
    .catch(() => {});
}

window.addEventListener('error', (e) => {
  const rootEl = document.getElementById('root');
  if (rootEl && rootEl.childElementCount === 0) {
    const errDiv = document.createElement('div');
    errDiv.id = 'error-log';
    errDiv.style.cssText = 'color:#991b1b;background:#fef2f2;padding:16px;font-family:sans-serif;font-size:14px;border:1px solid #fecaca;border-radius:12px;margin:24px;';
    errDiv.textContent = 'Terjadi gangguan saat memuat aplikasi: ' + e.message;
    document.body.appendChild(errDiv);
  }
});
window.addEventListener('unhandledrejection', (e) => {
  const rootEl = document.getElementById('root');
  if (rootEl && rootEl.childElementCount === 0) {
    const errDiv = document.createElement('div');
    errDiv.id = 'error-log';
    errDiv.style.cssText = 'color:#991b1b;background:#fef2f2;padding:16px;font-family:sans-serif;font-size:14px;border:1px solid #fecaca;border-radius:12px;margin:24px;';
    errDiv.textContent = 'Gagal memuat modul aplikasi: ' + String(e.reason);
    document.body.appendChild(errDiv);
  }
});

import App from './App.tsx';
import './index.css';

// Security checks to prevent F12 and Context Menu
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  if (
    e.key === 'F12' ||
    (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c')) ||
    (e.ctrlKey && (e.key === 'U' || e.key === 'u'))
  ) {
    e.preventDefault();
  }
});

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  declare state: ErrorBoundaryState;
  declare props: Readonly<{ children: React.ReactNode }>;

  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error?.message || 'Terjadi kesalahan tampilan aplikasi.' };
  }

  handleResetAndReload = () => {
    const doReload = () => window.location.reload();
    const timer = setTimeout(doReload, 800);
    const cleanup: Promise<unknown>[] = [];
    try {
      if ('serviceWorker' in navigator) {
        cleanup.push(
          navigator.serviceWorker.getRegistrations().then((regs) =>
            Promise.all(regs.map((r) => r.unregister().catch(() => false))),
          ).catch(() => []),
        );
      }
      if ('caches' in window) {
        cleanup.push(
          caches.keys().then((keys) =>
            Promise.all(keys.map((k) => caches.delete(k).catch(() => false))),
          ).catch(() => []),
        );
      }
    } catch {}
    Promise.all(cleanup).finally(() => {
      clearTimeout(timer);
      setTimeout(doReload, 250);
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-[#f7f5f2] text-stone-800 font-sans">
          <div className="max-w-md w-full bg-white rounded-2xl border border-stone-200 shadow-xl p-6 text-center space-y-4">
            <h1 className="text-lg font-extrabold text-red-900">Tampilan Mengalami Gangguan</h1>
            <p className="text-sm text-stone-600">
              Terjadi kendala saat membuka halaman ({this.state.message}). Silakan muat ulang aplikasi untuk menyegarkan cache browser.
            </p>
            <button
              type="button"
              onClick={this.handleResetAndReload}
              className="w-full px-4 py-2.5 rounded-xl bg-red-800 hover:bg-red-700 text-white text-sm font-bold transition-colors cursor-pointer"
            >
              Muat Ulang Aplikasi
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root')!;
createRoot(rootElement).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
rootElement.setAttribute('data-mounted', '1');
