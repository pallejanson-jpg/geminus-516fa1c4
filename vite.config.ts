import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

/**
 * Rollup plugin to shim Node.js modules used by @xeokit/xeokit-convert's
 * convert2xkt.js CLI wrapper. We never call that function from the browser,
 * but the barrel index.js re-exports it, so Rollup tries to resolve its deps.
 */
function shimNodeModules(): Plugin {
  const SHIM_ID = '\0node-shim';
  const NODE_MODULES = new Set(['node:util', 'fs', 'path', 'child_process']);

  return {
    name: 'shim-node-modules-for-xeokit',
    enforce: 'pre' as const,
    resolveId(id) {
      if (NODE_MODULES.has(id)) {
        return { id: `${SHIM_ID}:${id}`, external: false };
      }
      return null;
    },
    load(id) {
      if (id.startsWith(SHIM_ID)) {
        // Provide browser-compatible shims
        if (id.includes('node:util')) {
          return `export const TextEncoder = globalThis.TextEncoder; export const TextDecoder = globalThis.TextDecoder; export default {};`;
        }
        // fs, path, child_process — empty stubs (only used in CLI convert2xkt)
        return `export default {}; export const spawn = () => {};`;
      }
      return null;
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    shimNodeModules(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    // Pre-bundle cesium via esbuild (handles large CJS better than Rollup)
    include: ['cesium', 'resium'],
    force: true,
  },
  // Ensure WASM files from web-ifc are served correctly
  assetsInclude: ['**/*.wasm'],
  build: {
    rollupOptions: {
      output: {
        // Isolate cesium + resium in their own vendor chunk to prevent
        // React chunk-splitting issues caused by the large CJS module.
        manualChunks(id) {
          if (id.includes('/node_modules/cesium/') || id.includes('/node_modules/resium/')) {
            return 'cesium-vendor';
          }
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/') || id.includes('/node_modules/scheduler/')) {
            return 'react-vendor';
          }
        },
      },
    },
  },
}));
