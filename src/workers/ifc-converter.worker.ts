/**
 * Web Worker for IFC-to-XKT conversion.
 * Runs web-ifc WASM parsing off the main thread to prevent browser "unresponsive" warnings.
 */

// Polyfill global for Node.js-expecting libraries
(self as any).global = self;

interface WorkerInput {
  ifcData: ArrayBuffer;
  wasmPath: string;
}

interface WorkerProgress {
  type: 'log';
  message: string;
}

interface WorkerResult {
  type: 'result';
  xktData: ArrayBuffer;
  levels: Array<{ id: string; name: string; type: string }>;
  spaces: Array<{ id: string; name: string; type: string; parentId: string }>;
}

interface WorkerError {
  type: 'error';
  message: string;
}

self.onmessage = async (e: MessageEvent<WorkerInput>) => {
  const { ifcData, wasmPath } = e.data;
  const log = (msg: string) => {
    (self as any).postMessage({ type: 'log', message: msg } as WorkerProgress);
  };

  try {
    log('Worker: Loading xeokit-convert...');
    const mod = await import('@xeokit/xeokit-convert');
    log('Worker: Loading web-ifc...');
    const WebIFC = await import('web-ifc');

    if (typeof mod.parseIFCIntoXKTModel !== 'function') {
      throw new Error('parseIFCIntoXKTModel not available in xeokit-convert');
    }

    const xktModel = new mod.XKTModel();
    const fileSizeMB = ifcData.byteLength / 1024 / 1024;
    log(`Worker: Parsing IFC (${fileSizeMB.toFixed(1)} MB)...`);

    await mod.parseIFCIntoXKTModel({
      WebIFC,
      data: new Uint8Array(ifcData) as any,
      xktModel,
      autoNormals: true,
      wasmPath,
      log,
    });

    log('Worker: IFC parsing completed, finalizing model...');
    xktModel.finalize();

    // Extract hierarchy
    const levels: WorkerResult['levels'] = [];
    const spaces: WorkerResult['spaces'] = [];

    if (xktModel.metaObjects) {
      const metaObjValues = Array.isArray(xktModel.metaObjects)
        ? xktModel.metaObjects
        : Object.values(xktModel.metaObjects);
      for (const metaObj of metaObjValues as any[]) {
        const metaType = metaObj.metaType || metaObj.type || '';
        if (metaType === 'IfcBuildingStorey') {
          levels.push({
            id: metaObj.metaObjectId || metaObj.id || '',
            name: metaObj.metaObjectName || metaObj.name || metaType,
            type: metaType,
          });
        } else if (metaType === 'IfcSpace') {
          spaces.push({
            id: metaObj.metaObjectId || metaObj.id || '',
            name: metaObj.metaObjectName || metaObj.name || metaType,
            type: metaType,
            parentId: metaObj.parentMetaObjectId || metaObj.parentId || '',
          });
        }
      }
    }

    if (levels.length || spaces.length) {
      log(`Worker: Extracted ${levels.length} levels, ${spaces.length} spaces`);
    }

    log('Worker: Writing XKT to ArrayBuffer...');
    const stats: Record<string, any> = { texturesSize: 0 };
    const xktArrayBuffer = mod.writeXKTModelToArrayBuffer(xktModel, null, stats, { zip: false });

    log(`Worker: XKT ready (${(xktArrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB)`);

    (self as any).postMessage(
      { type: 'result', xktData: xktArrayBuffer, levels, spaces } as WorkerResult,
      [xktArrayBuffer] // Transfer ownership for zero-copy
    );
  } catch (err: any) {
    (self as any).postMessage({ type: 'error', message: err?.message || String(err) } as WorkerError);
  }
};
