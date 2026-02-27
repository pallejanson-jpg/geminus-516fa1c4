/**
 * IFC-to-XKT Web Worker bridge.
 * 
 * Uses Vite's native worker bundling via `new Worker(new URL(...))`.
 * The worker runs in a separate thread so the UI stays responsive
 * even for very large IFC files (200+ MB).
 */

import type { IfcHierarchyResult } from './acc-xkt-converter';

export function convertIfcInWorker(
  ifcData: ArrayBuffer,
  wasmPath: string,
  logger: (msg: string) => void,
  timeoutMs: number
): Promise<IfcHierarchyResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker;

    try {
      worker = new Worker(
        new URL('../workers/ifc-converter.worker.ts', import.meta.url),
        { type: 'module' }
      );
    } catch (err) {
      logger('Worker creation failed, falling back to main thread');
      runOnMainThread(ifcData, wasmPath, logger, timeoutMs).then(resolve, reject);
      return;
    }

    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error(`IFC parsing timeout after ${(timeoutMs / 60_000).toFixed(0)} min`));
    }, timeoutMs);

    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'log') {
        logger(msg.message);
      } else if (msg.type === 'result') {
        clearTimeout(timeout);
        worker.terminate();
        resolve({ xktData: msg.xktData, levels: msg.levels, spaces: msg.spaces });
      } else if (msg.type === 'error') {
        clearTimeout(timeout);
        worker.terminate();
        logger('Worker failed, falling back to main thread: ' + msg.message);
        // Re-read the file since the buffer may have been transferred
        runOnMainThread(ifcData, wasmPath, logger, timeoutMs).then(resolve, reject);
      }
    };

    worker.onerror = (err) => {
      clearTimeout(timeout);
      worker.terminate();
      logger('Worker error, falling back to main thread');
      runOnMainThread(ifcData, wasmPath, logger, timeoutMs).then(resolve, reject);
    };

    // Don't transfer — keep a copy in case we need main-thread fallback
    worker.postMessage({ ifcData, wasmPath });
  });
}

/**
 * Main-thread fallback for IFC conversion.
 */
async function runOnMainThread(
  ifcData: ArrayBuffer,
  wasmPath: string,
  logger: (msg: string) => void,
  timeoutMs: number
): Promise<IfcHierarchyResult> {
  logger('Main thread: Loading xeokit-convert...');
  const mod = await import('@xeokit/xeokit-convert');
  logger('Main thread: Loading web-ifc...');
  const WebIFC = await import('web-ifc');

  const xktModel = new (mod as any).XKTModel();
  const fileSizeMB = ifcData.byteLength / 1024 / 1024;
  logger(`Main thread: Parsing IFC (${fileSizeMB.toFixed(1)} MB)...`);

  const parsePromise = (mod as any).parseIFCIntoXKTModel({
    WebIFC,
    data: new Uint8Array(ifcData),
    xktModel,
    autoNormals: true,
    wasmPath,
    log: logger,
  });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`IFC timeout after ${(timeoutMs / 60_000).toFixed(0)} min`)), timeoutMs)
  );

  await Promise.race([parsePromise, timeoutPromise]);
  logger('Main thread: Finalizing...');
  xktModel.finalize();

  const levels: IfcHierarchyResult['levels'] = [];
  const spaces: IfcHierarchyResult['spaces'] = [];
  if (xktModel.metaObjects) {
    const vals = Array.isArray(xktModel.metaObjects) ? xktModel.metaObjects : Object.values(xktModel.metaObjects);
    for (const m of vals as any[]) {
      const t = m.metaType || m.type || '';
      if (t === 'IfcBuildingStorey') levels.push({ id: m.metaObjectId || m.id || '', name: m.metaObjectName || m.name || t, type: t });
      else if (t === 'IfcSpace') spaces.push({ id: m.metaObjectId || m.id || '', name: m.metaObjectName || m.name || t, type: t, parentId: m.parentMetaObjectId || m.parentId || '' });
    }
  }

  const stats: Record<string, any> = { texturesSize: 0 };
  const xktArrayBuffer = (mod as any).writeXKTModelToArrayBuffer(xktModel, null, stats, { zip: false });
  logger(`Main thread: XKT ready (${(xktArrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB)`);
  return { xktData: xktArrayBuffer, levels, spaces };
}
