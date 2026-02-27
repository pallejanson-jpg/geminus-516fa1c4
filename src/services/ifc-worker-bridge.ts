/**
 * IFC-to-XKT conversion bridge.
 * 
 * Uses main-thread dynamic imports to avoid Vite worker bundling issues
 * with @xeokit/xeokit-convert (which depends on Node.js APIs like node:util, fs).
 */

import type { IfcHierarchyResult } from './acc-xkt-converter';

export async function convertIfcInWorker(
  ifcData: ArrayBuffer,
  wasmPath: string,
  logger: (msg: string) => void,
  timeoutMs: number
): Promise<IfcHierarchyResult> {
  return runOnMainThread(ifcData, wasmPath, logger, timeoutMs);
}

async function runOnMainThread(
  ifcData: ArrayBuffer,
  wasmPath: string,
  logger: (msg: string) => void,
  timeoutMs: number
): Promise<IfcHierarchyResult> {
  logger('Loading xeokit-convert...');
  const mod = await import('@xeokit/xeokit-convert');
  logger('Loading web-ifc...');
  const WebIFC = await import('web-ifc');

  const xktModel = new (mod as any).XKTModel();
  const fileSizeMB = ifcData.byteLength / 1024 / 1024;
  logger(`Parsing IFC (${fileSizeMB.toFixed(1)} MB)...`);

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
  logger('Finalizing model...');
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
  logger(`XKT ready (${(xktArrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB)`);
  return { xktData: xktArrayBuffer, levels, spaces };
}
