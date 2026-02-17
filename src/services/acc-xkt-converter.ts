/**
 * ACC XKT Converter Service
 * 
 * Handles client-side conversion of Model Derivative output (glTF/GLB) to XKT format
 * for display in the xeokit-based 3D viewer.
 * 
 * Pipeline:
 * 1. Trigger translation via edge function (RVT -> SVF2)
 * 2. Poll for completion
 * 3. Download derivative via edge function -> storage
 * 4. Convert to XKT client-side using @xeokit/xeokit-convert
 * 5. Store XKT in xkt-models bucket via xktCacheService
 */

import { supabase } from '@/integrations/supabase/client';
import { xktCacheService } from './xkt-cache-service';

export interface TranslationStatus {
  status: 'idle' | 'pending' | 'inprogress' | 'success' | 'failed' | 'downloading' | 'converting' | 'complete' | 'server-converting';
  progress?: string;
  progressPercent?: number;  // 0-100
  step?: string;             // short step description
  message?: string;
  error?: string;
  derivativeCount?: number;
  downloadUrl?: string;
}

/**
 * Dynamically import @xeokit/xeokit-convert.
 * Node.js modules (node:util, fs, path) are shimmed in vite.config.ts.
 */
async function loadXeokitConvert() {
  const mod = await import('@xeokit/xeokit-convert');
  return {
    XKTModel: mod.XKTModel,
    writeXKTModelToArrayBuffer: mod.writeXKTModelToArrayBuffer,
    parseGLTFIntoXKTModel: mod.parseGLTFIntoXKTModel,
  };
}

/**
 * Detect the format of binary data by inspecting magic bytes.
 */
function detectFormat(data: ArrayBuffer): 'glb' | 'obj' | 'ifc' | 'unknown' {
  const view = new DataView(data);
  // GLB magic: 0x46546C67 ("glTF" in little-endian)
  if (data.byteLength >= 4 && view.getUint32(0, true) === 0x46546C67) {
    return 'glb';
  }
  // Check text-based formats
  const first = new Uint8Array(data, 0, Math.min(512, data.byteLength));
  const text = new TextDecoder().decode(first).trim();
  // IFC: STEP file starting with "ISO-10303-21" 
  if (text.startsWith('ISO-10303-21') || text.includes('FILE_DESCRIPTION')) {
    return 'ifc';
  }
  // OBJ: text file starting with '#' or 'v ' or 'mtllib'
  if (text.startsWith('#') || text.startsWith('v ') || text.startsWith('mtllib')) {
    return 'obj';
  }
  return 'unknown';
}

/**
 * Convert a GLB/glTF/OBJ ArrayBuffer into an XKT ArrayBuffer using xeokit-convert.
 * Returns the XKT binary ready for storage.
 */
export async function convertGlbToXkt(
  glbData: ArrayBuffer,
  log?: (msg: string) => void
): Promise<ArrayBuffer> {
  const logger = log || ((msg: string) => console.log('[xkt-convert]', msg));

  const format = detectFormat(glbData);
  logger(`Detected input format: ${format} (${(glbData.byteLength / 1024 / 1024).toFixed(2)} MB)`);

  if (format === 'unknown') {
    const header = new Uint8Array(glbData, 0, Math.min(64, glbData.byteLength));
    const headerHex = Array.from(header.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    // Try to detect if it's a JSON manifest (SVF2 bubble metadata)
    const firstBytes = new TextDecoder().decode(header.slice(0, 20));
    const looksLikeJson = firstBytes.trimStart().startsWith('{') || firstBytes.trimStart().startsWith('[');
    
    throw new Error(
      looksLikeJson
        ? `Filen verkar vara en SVF2-manifest (JSON), inte en geometrifil. ` +
          `RVT-filer genererar SVF2-format som kräver serverbaserad konvertering och kan inte konverteras i webbläsaren.`
        : `Okänt filformat (header: ${headerHex}). ` +
          `RVT-filer genererar SVF2-format som inte stöds för klientkonvertering. ` +
          `Hierarkidata (byggnader, våningar, rum) synkas via BIM-synk istället.`
    );
  }

  logger('Loading xeokit-convert...');
  const { XKTModel, writeXKTModelToArrayBuffer, parseGLTFIntoXKTModel } = await loadXeokitConvert();

  logger('Creating XKTModel...');
  const xktModel = new XKTModel();

  if (format === 'ifc') {
    logger('Parsing IFC into XKTModel via web-ifc WASM...');
    const mod = await import('@xeokit/xeokit-convert');
    if (typeof (mod as any).parseIFCIntoXKTModel === 'function') {
      await (mod as any).parseIFCIntoXKTModel({
        data: new Uint8Array(glbData),
        xktModel,
        wasmPath: '/lib/xeokit/',
        log: logger,
      });
    } else {
      throw new Error(
        'IFC-konvertering kräver parseIFCIntoXKTModel som inte finns i den installerade versionen av @xeokit/xeokit-convert. ' +
        'Kontrollera att web-ifc WASM-filer finns i /lib/xeokit/.'
      );
    }
  } else if (format === 'obj') {
    logger('Parsing OBJ into XKTModel...');
    const mod = await import('@xeokit/xeokit-convert');
    if (typeof (mod as any).parseOBJIntoXKTModel === 'function') {
      const objText = new TextDecoder().decode(glbData);
      await (mod as any).parseOBJIntoXKTModel({
        data: objText,
        xktModel,
        log: logger,
      });
    } else {
      logger('No dedicated OBJ parser found, trying glTF parser...');
      await parseGLTFIntoXKTModel({
        data: glbData,
        xktModel,
        log: logger,
      });
    }
  } else {
    logger('Parsing glTF/GLB into XKTModel...');
    await parseGLTFIntoXKTModel({
      data: glbData,
      xktModel,
      log: logger,
    });
  }

  logger('Finalizing XKTModel...');
  xktModel.finalize();

  logger('Writing XKT to ArrayBuffer...');
  const stats: Record<string, any> = { texturesSize: 0 };
  const xktArrayBuffer = writeXKTModelToArrayBuffer(xktModel, null, stats, { zip: false });

  logger(`XKT conversion complete (${(xktArrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB)`);
  return xktArrayBuffer;
}

export class AccXktConverter {
  private static instance: AccXktConverter;
  private pollingIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();

  private constructor() {}

  static getInstance(): AccXktConverter {
    if (!AccXktConverter.instance) {
      AccXktConverter.instance = new AccXktConverter();
    }
    return AccXktConverter.instance;
  }

  /**
   * Start the full translation pipeline for a BIM file
   */
  async startTranslation(
    versionUrn: string,
    options: {
      buildingFmGuid?: string;
      folderId?: string;
      fileName?: string;
      region?: string;
    } = {}
  ): Promise<TranslationStatus> {
    try {
      const { data, error } = await supabase.functions.invoke('acc-sync', {
        body: {
          action: 'translate-model',
          versionUrn,
          buildingFmGuid: options.buildingFmGuid,
          folderId: options.folderId,
          fileName: options.fileName,
          region: options.region,
        },
      });

      if (error) throw error;

      if (data?.alreadyDone) {
        return { status: 'success', message: data.message };
      }

      return {
        status: data?.status === 'success' ? 'success' : 'pending',
        message: data?.message || 'Översättning startad',
      };
    } catch (e: any) {
      return { status: 'failed', error: e.message };
    }
  }

  /**
   * Check translation status
   */
  async checkTranslation(versionUrn: string): Promise<TranslationStatus> {
    try {
      const { data, error } = await supabase.functions.invoke('acc-sync', {
        body: { action: 'check-translation', versionUrn },
      });

      if (error) throw error;

      return {
        status: data?.status || 'pending',
        progress: data?.progress,
        derivativeCount: data?.derivativeCount,
        message: data?.status === 'success'
          ? `Översättning klar (${data?.derivativeCount || 0} derivatives)`
          : data?.status === 'inprogress'
            ? `Översätter... ${data?.progress || ''}`
            : undefined,
      };
    } catch (e: any) {
      return { status: 'failed', error: e.message };
    }
  }

  /**
   * Download derivative to storage
   */
  async downloadDerivative(
    versionUrn: string,
    options: {
      buildingFmGuid?: string;
      fileName?: string;
      derivativeUrn?: string;
    } = {}
  ): Promise<TranslationStatus> {
    try {
      const { data, error } = await supabase.functions.invoke('acc-sync', {
        body: {
          action: 'download-derivative',
          versionUrn,
          buildingFmGuid: options.buildingFmGuid,
          fileName: options.fileName,
          derivativeUrn: options.derivativeUrn,
        },
      });

      if (error) throw error;

      if (data?.success) {
        return {
          status: 'complete',
          downloadUrl: data.downloadUrl,
          message: data.message,
        };
      }

      // Translation still in progress — return pending so caller can retry
      if (data?.pending) {
        return { status: 'pending', message: `Översättning pågår (${data.translationStatus || 'pending'})...` };
      }

      return { status: 'failed', error: data?.error || 'Download failed' };
    } catch (e: any) {
      return { status: 'failed', error: e.message };
    }
  }

  /**
   * Convert a downloaded derivative (GLB/glTF) to XKT and store it.
   * 
   * @param downloadUrl - Signed URL to the downloaded derivative in storage
   * @param buildingFmGuid - Building identifier for cache storage
   * @param modelId - Unique model identifier (e.g. versionUrn hash)
   * @param fileName - Human-readable filename
   * @param onLog - Optional log callback for progress
   */
  async convertAndStore(
    downloadUrl: string,
    buildingFmGuid: string,
    modelId: string,
    fileName?: string,
    onLog?: (msg: string) => void
  ): Promise<{ success: boolean; error?: string }> {
    const log = onLog || ((msg: string) => console.log('[acc-xkt]', msg));

    try {
      // 1. Fetch the derivative binary from the signed storage URL
      log('Laddar ner derivat från storage...');
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch derivative: ${response.status}`);
      }
      const glbData = await response.arrayBuffer();
      log(`Nedladdat: ${(glbData.byteLength / 1024 / 1024).toFixed(2)} MB`);

      // Detect format of downloaded data
      const format = detectFormat(glbData);
      log(`Detekterat format: ${format}`);

      // 2. Save GLB/OBJ directly to storage (skip XKT conversion)
      // The viewer will load these directly via GLTFLoaderPlugin/OBJLoaderPlugin
      const fileExt = format === 'obj' ? 'obj' : format === 'ifc' ? 'ifc' : 'glb';
      const safeName = fileName || modelId;
      const storageFileName = `${modelId}.${fileExt}`;
      const storagePath = `${buildingFmGuid}/${storageFileName}`;
      
      log(`Sparar ${fileExt.toUpperCase()}-fil direkt (skippar XKT-konvertering)...`);
      
      const blob = new Blob([glbData], { type: 'application/octet-stream' });
      const { error: uploadError } = await supabase.storage
        .from('xkt-models')
        .upload(storagePath, blob, {
          contentType: 'application/octet-stream',
          upsert: true,
        });
      
      if (uploadError) {
        throw new Error(`Upload failed: ${uploadError.message}`);
      }

      // 3. Save metadata with format info
      const { error: dbError } = await supabase
        .from('xkt_models')
        .upsert({
          building_fm_guid: buildingFmGuid,
          model_id: modelId,
          model_name: safeName,
          file_name: storageFileName,
          file_size: glbData.byteLength,
          storage_path: storagePath,
          file_url: null,
          format: fileExt,
          synced_at: new Date().toISOString(),
          source_updated_at: new Date().toISOString(),
        } as any, {
          onConflict: 'building_fm_guid,model_id',
        });
      
      if (dbError) {
        log(`DB-fel: ${dbError.message}`);
        return { success: false, error: `DB error: ${dbError.message}` };
      }

      log(`${fileExt.toUpperCase()}-modell sparad! Viewern laddar den direkt.`);
      return { success: true };
    } catch (e: any) {
      log(`Konverteringsfel: ${e.message}`);
      console.error('convertAndStore error:', e);
      return { success: false, error: e.message };
    }
  }

  /**
   * Start polling for translation completion.
   * Returns a cleanup function.
   */
  startPolling(
    versionUrn: string,
    onStatusChange: (status: TranslationStatus) => void,
    intervalMs: number = 5000
  ): () => void {
    this.stopPolling(versionUrn);

    const poll = async () => {
      const status = await this.checkTranslation(versionUrn);
      onStatusChange(status);

      if (status.status === 'success' || status.status === 'failed') {
        this.stopPolling(versionUrn);
      }
    };

    poll();

    const interval = setInterval(poll, intervalMs);
    this.pollingIntervals.set(versionUrn, interval);

    return () => this.stopPolling(versionUrn);
  }

  stopPolling(versionUrn: string) {
    const interval = this.pollingIntervals.get(versionUrn);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(versionUrn);
    }
  }

  /**
   * Try server-side SVF-to-GLB conversion via the acc-svf-to-gltf edge function.
   * Falls back when client-side conversion fails (e.g. SVF2/SVF formats).
   */
  async tryServerConversion(
    versionUrn: string,
    options: { buildingFmGuid?: string; fileName?: string },
    onStatusChange: (status: TranslationStatus) => void
  ): Promise<TranslationStatus> {
    try {
      onStatusChange({ status: 'server-converting', message: 'Konverterar geometri på servern (kan ta några minuter)...', progressPercent: 10, step: 'Väntar på server...' });

      const { data, error } = await supabase.functions.invoke('acc-svf-to-gltf', {
        body: {
          versionUrn,
          buildingFmGuid: options.buildingFmGuid,
          fileName: options.fileName,
        },
      });

      if (error && !data?.pending) throw error;

      // If translation is still pending, wait and retry (up to 36 times / 6 min)
      const SVR_MAX_RETRIES = 36;
      const SVR_INTERVAL = 10000;
      if (data?.pending) {
        for (let attempt = 1; attempt < SVR_MAX_RETRIES; attempt++) {
          const minutesLeft = Math.max(0, Math.ceil(((SVR_MAX_RETRIES - attempt) * SVR_INTERVAL) / 60000));
          onStatusChange({ status: 'server-converting', message: `Väntar på översättning från Autodesk... (ca ${minutesLeft} min kvar)`, progressPercent: Math.min(5 + Math.round((attempt / SVR_MAX_RETRIES) * 25), 30), step: 'Väntar på Autodesk...' });
          await new Promise(r => setTimeout(r, 10000));
          const retry = await supabase.functions.invoke('acc-svf-to-gltf', {
            body: { versionUrn, buildingFmGuid: options.buildingFmGuid, fileName: options.fileName },
          });
          if (retry.data?.success || !retry.data?.pending) {
            // Re-assign and continue to normal handling below
            Object.assign(data, retry.data);
            break;
          }
        }
        if (data?.pending) {
          const failStatus: TranslationStatus = { status: 'failed', error: 'Översättningen tog för lång tid. Försök igen om en stund.' };
          onStatusChange(failStatus);
          return failStatus;
        }
      }

      if (data?.success && data.downloadUrl && options.buildingFmGuid) {
        // Server gave us a GLB/OBJ - save directly (no XKT conversion)
        onStatusChange({ status: 'converting', message: 'Sparar 3D-modell...', progressPercent: 35, step: 'Sparar modell...' });
        const safeModelId = versionUrn.replace(/[^a-zA-Z0-9-_]/g, '_');
        const convertResult = await this.convertAndStore(
          data.downloadUrl,
          options.buildingFmGuid,
          safeModelId,
          options.fileName,
          (msg) => onStatusChange({ status: 'converting', message: msg, progressPercent: 40, step: 'Konverterar IFC-geometri...' })
        );

        if (convertResult.success) {
          const finalStatus: TranslationStatus = { status: 'complete', message: '3D-modell sparad!', progressPercent: 100, step: 'Klar!' };
          onStatusChange(finalStatus);
          return finalStatus;
        }
        const failStatus: TranslationStatus = { status: 'failed', error: convertResult.error || 'Modellsparning misslyckades' };
        onStatusChange(failStatus);
        return failStatus;
      }

      if (data?.formatLimitation) {
        const failStatus: TranslationStatus = {
          status: 'failed',
          error: data.error || 'Formatet stöds inte för 3D-konvertering.',
        };
        onStatusChange(failStatus);
        return failStatus;
      }

      const failStatus: TranslationStatus = { status: 'failed', error: data?.error || 'Serverkonvertering misslyckades' };
      onStatusChange(failStatus);
      return failStatus;
    } catch (e: any) {
      const failStatus: TranslationStatus = { status: 'failed', error: `Serverkonvertering: ${e.message}` };
      onStatusChange(failStatus);
      return failStatus;
    }
  }

  stopAllPolling() {
    for (const [, interval] of this.pollingIntervals) {
      clearInterval(interval);
    }
    this.pollingIntervals.clear();
  }

  /**
   * Wait for check-translation to return "success" before proceeding.
   * Global timeout: 25 minutes. Polls every 10 seconds.
   */
  private async waitForTranslation(
    versionUrn: string,
    onStatusChange: (status: TranslationStatus) => void
  ): Promise<TranslationStatus> {
    const MAX_WAIT_MS = 25 * 60 * 1000; // 25 minutes
    const POLL_INTERVAL = 10000; // 10 seconds
    const startTime = Date.now();

    while (true) {
      const elapsed = Date.now() - startTime;
      if (elapsed > MAX_WAIT_MS) {
        return {
          status: 'failed',
          error: 'Översättningen tar längre tid än väntat (>25 min). Jobbet fortsätter i Autodesk – försök igen om en stund.',
        };
      }

      const minutesLeft = Math.max(0, Math.ceil((MAX_WAIT_MS - elapsed) / 60000));
      const result = await this.checkTranslation(versionUrn);

      if (result.status === 'success') {
        onStatusChange({ status: 'success', message: `Översättning klar! Laddar ner geometri...` });
        return result;
      }

      if (result.status === 'failed') {
        return result;
      }

      // Still pending/inprogress
      const elapsedPct = Math.min(5 + Math.round(((Date.now() - startTime) / MAX_WAIT_MS) * 15), 20);
      onStatusChange({
        status: 'pending',
        message: `Väntar på översättning från Autodesk... ${result.progress || ''} (ca ${minutesLeft} min kvar)`,
        progressPercent: elapsedPct,
        step: 'Väntar på Autodesk...',
      });

      await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
  }

  /**
   * Full pipeline: translate -> wait for translation -> download -> convert -> store
   */
  async runFullPipeline(
    versionUrn: string,
    options: {
      buildingFmGuid?: string;
      folderId?: string;
      fileName?: string;
      region?: string;
    },
    onStatusChange: (status: TranslationStatus) => void
  ): Promise<TranslationStatus> {
    // Step 1: Start translation (or confirm already done)
    onStatusChange({ status: 'pending', message: 'Startar översättning...', progressPercent: 2, step: 'Startar översättning...' });
    const startResult = await this.startTranslation(versionUrn, options);
    
    if (startResult.status === 'failed') {
      onStatusChange(startResult);
      return startResult;
    }

    // Step 2: If not alreadyDone, poll check-translation until success (up to 25 min)
    if (startResult.status !== 'success') {
      onStatusChange({ status: 'pending', message: 'Väntar på översättning från Autodesk...', progressPercent: 5, step: 'Väntar på Autodesk...' });
      const translationResult = await this.waitForTranslation(versionUrn, onStatusChange);
      if (translationResult.status === 'failed') {
        onStatusChange(translationResult);
        return translationResult;
      }
    }

    // Step 3: Download derivative (translation is confirmed done, only a few retries needed)
    const DL_MAX_RETRIES = 6;
    const DL_INTERVAL = 5000;
    let dlResult: TranslationStatus = { status: 'pending' };

    for (let attempt = 0; attempt < DL_MAX_RETRIES; attempt++) {
      onStatusChange({ status: 'downloading', message: attempt > 0 ? `Laddar ner geometri (försök ${attempt + 1})...` : 'Laddar ner geometri...', progressPercent: 22 + attempt * 2, step: 'Laddar ner IFC-fil...' });
      dlResult = await this.downloadDerivative(versionUrn, options);
      if (dlResult.status !== 'pending') break;
      await new Promise(r => setTimeout(r, DL_INTERVAL));
    }

    if (dlResult.status === 'complete' && dlResult.downloadUrl) {
      // Direct download worked
      if (options.buildingFmGuid) {
        onStatusChange({ status: 'converting', message: 'Sparar 3D-modell...', progressPercent: 35, step: 'Sparar modell...' });
        const safeModelId = versionUrn.replace(/[^a-zA-Z0-9-_]/g, '_');
        const convertResult = await this.convertAndStore(
          dlResult.downloadUrl,
          options.buildingFmGuid,
          safeModelId,
          options.fileName,
          (msg) => {
            let pct = 40;
            if (msg.includes('Nedladdat')) pct = 38;
            else if (msg.includes('Detekterat')) pct = 42;
            else if (msg.includes('Sparar')) pct = 70;
            else if (msg.includes('sparad')) pct = 98;
            onStatusChange({ status: 'converting', message: msg, progressPercent: pct, step: pct < 70 ? 'Bearbetar modell...' : 'Sparar 3D-modell...' });
          }
        );

        if (convertResult.success) {
          const finalStatus: TranslationStatus = { status: 'complete', message: '3D-modell sparad!', progressPercent: 100, step: 'Klar!' };
          onStatusChange(finalStatus);
          return finalStatus;
        } else {
          // Client-side failed, try server-side
          onStatusChange({ status: 'server-converting', message: 'Klientlagring misslyckades, testar serverkonvertering...' });
          return this.tryServerConversion(versionUrn, options, onStatusChange);
        }
      }
      onStatusChange(dlResult);
      return dlResult;
    }

    // Download failed or stayed pending – try server-side conversion
    if (dlResult.status === 'pending') {
      // Translation was "success" but download still pending? Unusual, try server
      onStatusChange({ status: 'server-converting', message: 'Konverterar geometri på servern...' });
      return this.tryServerConversion(versionUrn, options, onStatusChange);
    }

    if (dlResult.status === 'failed') {
      // Likely SVF2/format issue – try server conversion
      onStatusChange({ status: 'server-converting', message: 'Konverterar geometri på servern...' });
      return this.tryServerConversion(versionUrn, options, onStatusChange);
    }

    onStatusChange(dlResult);
    return dlResult;
  }
}

export const accXktConverter = AccXktConverter.getInstance();
