import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import GlobalErrorBoundary from "./components/common/GlobalErrorBoundary.tsx";
import "./index.css";

// Auto-recovery for stale chunk / module import failures (max 2 retries)
const RELOAD_KEY = '__chunk_reload_count';
const handleChunkError = (msg: string) => {
  if (
    msg.includes('Importing a module script failed') ||
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Loading chunk')
  ) {
    const count = parseInt(sessionStorage.getItem(RELOAD_KEY) || '0', 10);
    if (count < 2) {
      sessionStorage.setItem(RELOAD_KEY, String(count + 1));
      // Unregister SW to clear cached chunks, then reload with cache-bust
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((regs) => {
          Promise.all(regs.map((r) => r.unregister())).then(() => {
            const url = new URL(window.location.href);
            url.searchParams.set('_cb', String(Date.now()));
            window.location.replace(url.toString());
          });
        });
      } else {
        const url = new URL(window.location.href);
        url.searchParams.set('_cb', String(Date.now()));
        window.location.replace(url.toString());
      }
    }
  }
};

window.addEventListener('error', (e) => {
  if (e.message) handleChunkError(e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message || String(e.reason || '');
  handleChunkError(msg);
});

// Clear reload counter on successful load
sessionStorage.removeItem(RELOAD_KEY);

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration failed — app still works without it
    });
  });
}

// v3
createRoot(document.getElementById("root")!).render(
  <GlobalErrorBoundary>
    <App />
  </GlobalErrorBoundary>
);
