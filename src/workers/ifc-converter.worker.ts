/**
 * IFC-to-XKT Web Worker.
 * Vite bundles this as a separate module via `new Worker(new URL(...))`.
 */

// Polyfill Node.js globals that web-ifc / xeokit-convert expect
(self as any).global = self;

interface WorkerInput {
  ifcData: ArrayBuffer;
  wasmPath: string;
}

self.onmessage = async (e: MessageEvent<WorkerInput>) => {
  const { ifcData, wasmPath } = e.data;
  const log = (msg: string) => self.postMessage({ type: 'log', message: msg });

  try {
    log('Worker: Loading xeokit-convert...');
    const mod = await import('@xeokit/xeokit-convert');
    log('Worker: Loading web-ifc...');
    const WebIFC = await import('web-ifc');

    const xktModel = new (mod as any).XKTModel();
    const fileSizeMB = ifcData.byteLength / 1024 / 1024;
    log(`Worker: Parsing IFC (${fileSizeMB.toFixed(1)} MB)...`);

    await (mod as any).parseIFCIntoXKTModel({
      WebIFC,
      data: new Uint8Array(ifcData),
      xktModel,
      autoNormals: true,
      wasmPath,
      log,
    });

    log('Worker: Finalizing model...');
    xktModel.finalize();

    const levels: Array<{ id: string; name: string; type: string }> = [];
    const spaces: Array<{ id: string; name: string; type: string; parentId: string }> = [];

    if (xktModel.metaObjects) {
      const vals = Array.isArray(xktModel.metaObjects)
        ? xktModel.metaObjects
        : Object.values(xktModel.metaObjects);
      for (const m of vals as any[]) {
        const t = m.metaType || m.type || '';
        if (t === 'IfcBuildingStorey') {
          levels.push({ id: m.metaObjectId || m.id || '', name: m.metaObjectName || m.name || t, type: t });
        } else if (t === 'IfcSpace') {
          spaces.push({ id: m.metaObjectId || m.id || '', name: m.metaObjectName || m.name || t, type: t, parentId: m.parentMetaObjectId || m.parentId || '' });
        }
      }
    }

    if (levels.length || spaces.length) {
      log(`Worker: ${levels.length} levels, ${spaces.length} spaces`);
    }

    log('Worker: Writing XKT...');
    const stats: Record<string, any> = { texturesSize: 0 };
    const xktBuf = (mod as any).writeXKTModelToArrayBuffer(xktModel, null, stats, { zip: false });
    log(`Worker: Done (${(xktBuf.byteLength / 1024 / 1024).toFixed(2)} MB)`);

    (self as any).postMessage({ type: 'result', xktData: xktBuf, levels, spaces }, [xktBuf]);
  } catch (err: any) {
    self.postMessage({ type: 'error', message: err?.message || String(err) });
  }
};
