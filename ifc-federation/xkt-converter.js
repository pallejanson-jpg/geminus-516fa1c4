/**
 * xkt-converter.js
 *
 * Server-side IFC -> XKT conversion, using @xeokit/xeokit-convert + web-ifc
 * (both already dependencies of the main Geminus app, reused here rather
 * than reinstalled). This replaces live in-browser IFC parsing
 * (FederationViewer.tsx's earlier WebIFCLoaderPlugin approach) as the
 * viewer's data source -- confirmed by direct testing that live parsing of
 * even a small (2.2 MB) real file could hang for 150+ seconds without ever
 * completing, while converting the same file to XKT server-side took a
 * deterministic ~18s and produced a compact, fast-to-load binary.
 *
 * Root-cause note for future maintenance: getting @xeokit/xeokit-convert
 * to import at all under plain Node ESM required patching a real bug in
 * its @loaders.gl/polyfills dependency (node_modules/@loaders.gl/polyfills/
 * dist/*.js) -- several relative imports there omit the .js extension
 * (e.g. `from './buffer/btoa.node'` instead of `'./buffer/btoa.node.js'`),
 * which Node's strict ESM resolver rejects even though the files exist.
 * This works when the same package is loaded through a bundler (Vite,
 * which the main app's browser build uses) or Deno (which the
 * supabase/functions/ifc-to-xkt edge function uses) because both are more
 * lenient about extensions than raw Node ESM -- so the bug was never
 * surfaced until running this exact code path in plain Node. If
 * `npm install` ever overwrites node_modules, this patch needs reapplying
 * (grep the four files this touched for `from '.*\.node'` without a `.js`
 * suffix) until the upstream package fixes it.
 */

import { convert2xkt } from '@xeokit/xeokit-convert';
import * as WebIFC from 'web-ifc';

/**
 * Convert one IFC file's text content to an XKT binary.
 * @param {string} ifcText
 * @param {(msg: string) => void} [onLog] Forwarded from convert2xkt's own log callback, for progress reporting.
 * @returns {Promise<Buffer>}
 */
async function convertIfcToXkt(ifcText, onLog) {
  let xktArrayBuffer;
  await convert2xkt({
    WebIFC,
    sourceData: Buffer.from(ifcText, 'utf8'),
    sourceFormat: 'ifc',
    outputXKT: (arrayBuffer) => { xktArrayBuffer = arrayBuffer; },
    log: onLog ?? (() => {}),
  });
  if (!xktArrayBuffer) throw new Error('Conversion produced no XKT output.');
  return Buffer.from(xktArrayBuffer);
}

export { convertIfcToXkt };
