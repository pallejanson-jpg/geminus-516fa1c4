import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { viteStaticCopy } from "vite-plugin-static-copy";

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
    viteStaticCopy({
      targets: [
        { src: 'node_modules/cesium/Build/Cesium/Workers', dest: 'cesiumStatic' },
        { src: 'node_modules/cesium/Build/Cesium/ThirdParty', dest: 'cesiumStatic' },
        { src: 'node_modules/cesium/Build/Cesium/Assets', dest: 'cesiumStatic' },
        { src: 'node_modules/cesium/Build/Cesium/Widgets', dest: 'cesiumStatic' },
        // Copy web-ifc WASM files matching npm version for browser-side IFC conversion
        { src: 'node_modules/web-ifc/*.wasm', dest: 'web-ifc-wasm' },
      ],
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Provide browser-compatible shim for node:util used by @xeokit/xeokit-convert
      "node:util": path.resolve(__dirname, "./src/lib/node-util-shim.ts"),
    },
  },
  optimizeDeps: {
    // Force Vite to pre-bundle web-ifc so WASM loading works correctly
    exclude: ['web-ifc'],
  },
  // Ensure WASM files from web-ifc are served correctly
  assetsInclude: ['**/*.wasm'],
  // Polyfill Node.js globals referenced by web-ifc / xeokit-convert
  define: {
    global: 'globalThis',
    CESIUM_BASE_URL: JSON.stringify('/cesiumStatic'),
  },
}));
