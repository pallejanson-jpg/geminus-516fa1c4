import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Auto-recovery for stale chunk / module import failures
const RELOAD_KEY = '__chunk_reload_attempted';
const handleChunkError = (msg: string) => {
  if (
    (msg.includes('Importing a module script failed') ||
     msg.includes('Failed to fetch dynamically imported module') ||
     msg.includes('Loading chunk')) &&
    !sessionStorage.getItem(RELOAD_KEY)
  ) {
    sessionStorage.setItem(RELOAD_KEY, '1');
    window.location.reload();
  }
};

window.addEventListener('error', (e) => {
  if (e.message) handleChunkError(e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message || String(e.reason || '');
  handleChunkError(msg);
});

// Clear reload flag on successful load
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
createRoot(document.getElementById("root")!).render(<App />);
