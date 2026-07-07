import { defineConfig, loadEnv, Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { viteStaticCopy } from "vite-plugin-static-copy";

/**
 * Dev-only plugin: provides a local /__dev/asset-plus-token endpoint.
 *
 * The Asset+ viewer needs a short-lived Keycloak token to load 3D models.
 * In production (Lovable), users are logged in and the edge function
 * `asset-plus-query` handles auth. Locally, there is no logged-in user,
 * so the edge function's verifyAuth() call fails.
 *
 * This plugin calls Keycloak directly (using .env credentials) and returns
 * the token, bypassing the edge function entirely for local dev.
 *
 * NOTE: Takes `env` from loadEnv() — Vite does NOT inject .env vars into
 *       process.env for config-file code, so we pass them explicitly.
 */
function assetPlusDevTokenPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'asset-plus-dev-token',
    apply: 'serve' as const,
    configureServer(server) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        if (req.url !== '/__dev/asset-plus-token') return next();

        // Parse POST body
        let rawBody = '';
        await new Promise<void>((resolve, reject) => {
          req.on('data', (chunk: Buffer) => { rawBody += chunk.toString(); });
          req.on('end', resolve);
          req.on('error', reject);
        });

        let action = 'getToken';
        try { action = JSON.parse(rawBody || '{}').action || 'getToken'; } catch { /* keep default */ }

        const keycloakUrl = env.ASSET_PLUS_KEYCLOAK_URL;
        const clientId    = env.ASSET_PLUS_CLIENT_ID;
        const username    = env.ASSET_PLUS_USERNAME;
        const password    = env.ASSET_PLUS_PASSWORD;
        const apiUrl      = env.ASSET_PLUS_API_URL;
        const apiKey      = env.ASSET_PLUS_API_KEY;

        const send = (status: number, body: unknown) => {
          const json = JSON.stringify(body);
          res.writeHead(status, {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(json),
          });
          res.end(json);
        };

        try {
          if (action === 'getToken') {
            if (!keycloakUrl || !clientId || !username || !password) {
              return send(500, { error: 'Missing ASSET_PLUS_* vars in .env (KEYCLOAK_URL, CLIENT_ID, USERNAME, PASSWORD)' });
            }
            const tokenRes = await fetch(keycloakUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ grant_type: 'password', client_id: clientId, username, password }).toString(),
            });
            if (!tokenRes.ok) {
              const text = await tokenRes.text();
              return send(500, { error: `Keycloak ${tokenRes.status}: ${text.slice(0, 200)}` });
            }
            const data = (await tokenRes.json()) as { access_token: string };
            console.log('[dev-token] Keycloak token fetched ✅');
            return send(200, { accessToken: data.access_token });
          }

          if (action === 'getConfig') {
            return send(200, {
              apiUrl: (apiUrl || '').replace(/\/+$/, ''),
              apiKey: apiKey || '',
            });
          }

          return send(404, { error: `Unknown action: ${action}` });
        } catch (e: any) {
          console.error('[dev-token] Error:', e.message);
          return send(500, { error: e.message });
        }
      });
    },
  };
}

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
export default defineConfig(({ mode }) => {
  // Load ALL .env variables (no prefix filter) so the dev-token plugin
  // can read ASSET_PLUS_* credentials at server request time.
  const env = loadEnv(mode, process.cwd(), '');

  return {
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && assetPlusDevTokenPlugin(env),
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
  };
});
