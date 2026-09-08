import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// NOTE: cross-origin isolation headers (COOP+COEP) were tried here to
// unlock SharedArrayBuffer for web-ifc's multi-threaded WASM build, on the
// theory that single-threaded parsing was the real cause of "3D view is
// very slow". Reverted (2026-09-07): the bundled xeokit SDK's web-ifc glue
// code is incompatible with the installed web-ifc npm package's own
// worker.js in multi-threaded mode -- confirmed via a real browser test:
// `Uncaught TypeError: Failed to execute 'createObjectURL' on 'URL':
// Overload resolution failed` thrown repeatedly inside web-ifc-mt.worker.js,
// which made loading hang far longer (20+s and rising) than the
// single-threaded path ever did. Revisit only alongside upgrading both the
// SDK bundle and the web-ifc package together to matching versions that
// support multi-threading -- don't re-enable in isolation.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: {
      '/api': 'http://localhost:4500',
    },
  },
});
