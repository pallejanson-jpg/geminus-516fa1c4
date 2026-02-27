/**
 * IFC-to-XKT Web Worker launcher.
 * 
 * Instead of using Vite's `new Worker(new URL(...))` which forces the worker
 * into the main bundle's module graph (causing Node.js external errors),
 * we run the conversion in a plain Worker with inline code that dynamically
 * imports the libraries at runtime.
 */

import type { IfcHierarchyResult } from './acc-xkt-converter';

export function convertIfcInWorker(
  ifcData: ArrayBuffer,
  wasmPath: string,
  logger: (msg: string) => void,
  timeoutMs: number
): Promise<IfcHierarchyResult> {
  return new Promise((resolve, reject) => {
    // Inline worker code as a blob to avoid Vite bundling xeokit-convert into the worker
    const workerCode = `
      self.global = self;
      
      self.onmessage = async (e) => {
        const { ifcData, wasmPath } = e.data;
        const log = (msg) => self.postMessage({ type: 'log', message: msg });
        
        try {
          log('Worker: Loading xeokit-convert...');
          const mod = await import('@xeokit/xeokit-convert');
          log('Worker: Loading web-ifc...');
          const WebIFC = await import('web-ifc');
          
          const xktModel = new mod.XKTModel();
          const fileSizeMB = ifcData.byteLength / 1024 / 1024;
          log('Worker: Parsing IFC (' + fileSizeMB.toFixed(1) + ' MB)...');
          
          await mod.parseIFCIntoXKTModel({
            WebIFC,
            data: new Uint8Array(ifcData),
            xktModel,
            autoNormals: true,
            wasmPath,
            log,
          });
          
          log('Worker: Finalizing model...');
          xktModel.finalize();
          
          const levels = [];
          const spaces = [];
          if (xktModel.metaObjects) {
            const vals = Array.isArray(xktModel.metaObjects) ? xktModel.metaObjects : Object.values(xktModel.metaObjects);
            for (const m of vals) {
              const t = m.metaType || m.type || '';
              if (t === 'IfcBuildingStorey') {
                levels.push({ id: m.metaObjectId || m.id || '', name: m.metaObjectName || m.name || t, type: t });
              } else if (t === 'IfcSpace') {
                spaces.push({ id: m.metaObjectId || m.id || '', name: m.metaObjectName || m.name || t, type: t, parentId: m.parentMetaObjectId || m.parentId || '' });
              }
            }
          }
          if (levels.length || spaces.length) log('Worker: ' + levels.length + ' levels, ' + spaces.length + ' spaces');
          
          log('Worker: Writing XKT...');
          const xktBuf = mod.writeXKTModelToArrayBuffer(xktModel, null, { texturesSize: 0 }, { zip: false });
          log('Worker: Done (' + (xktBuf.byteLength / 1024 / 1024).toFixed(2) + ' MB)');
          
          self.postMessage({ type: 'result', xktData: xktBuf, levels, spaces }, [xktBuf]);
        } catch (err) {
          self.postMessage({ type: 'error', message: err?.message || String(err) });
        }
      };
    `;

    // Blob workers can't use ES module imports in all browsers,
    // so we fall back to running on main thread if Worker creation fails
    let worker: Worker | null = null;
    let usingWorker = false;

    try {
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      worker = new Worker(URL.createObjectURL(blob), { type: 'module' });
      usingWorker = true;
    } catch {
      logger('Web Worker not available, falling back to main thread');
    }

    if (!usingWorker || !worker) {
      // Fallback: run on main thread (original behavior)
      runOnMainThread(ifcData, wasmPath, logger, timeoutMs).then(resolve, reject);
      return;
    }

    const timeout = setTimeout(() => {
      worker!.terminate();
      reject(new Error(`IFC-parsning timeout efter ${(timeoutMs / 60_000).toFixed(0)} min`));
    }, timeoutMs);

    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'log') {
        logger(msg.message);
      } else if (msg.type === 'result') {
        clearTimeout(timeout);
        worker!.terminate();
        resolve({ xktData: msg.xktData, levels: msg.levels, spaces: msg.spaces });
      } else if (msg.type === 'error') {
        clearTimeout(timeout);
        worker!.terminate();
        // Fall back to main thread on worker errors
        logger('Worker failed, falling back to main thread: ' + msg.message);
        runOnMainThread(ifcData, wasmPath, logger, timeoutMs).then(resolve, reject);
      }
    };

    worker.onerror = (err) => {
      clearTimeout(timeout);
      worker!.terminate();
      logger('Worker error, falling back to main thread');
      runOnMainThread(ifcData, wasmPath, logger, timeoutMs).then(resolve, reject);
    };

    worker.postMessage({ ifcData, wasmPath }, [ifcData]);
  });
}

/**
 * Main-thread fallback for IFC conversion (original blocking approach).
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
