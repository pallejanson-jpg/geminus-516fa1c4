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
  status: 'idle' | 'pending' | 'inprogress' | 'success' | 'failed' | 'downloading' | 'converting' | 'complete';
  progress?: string;
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
function detectFormat(data: ArrayBuffer): 'glb' | 'obj' | 'unknown' {
  const view = new DataView(data);
  // GLB magic: 0x46546C67 ("glTF" in little-endian)
  if (data.byteLength >= 4 && view.getUint32(0, true) === 0x46546C67) {
    return 'glb';
  }
  // OBJ: text file starting with '#' or 'v ' or 'mtllib'
  const first = new Uint8Array(data, 0, Math.min(256, data.byteLength));
  const text = new TextDecoder().decode(first).trim();
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

  if (format === 'obj') {
    logger('Parsing OBJ into XKTModel...');
    // xeokit-convert's parseGLTFIntoXKTModel can handle OBJ too when passed as text
    // But for proper OBJ support, we try the dedicated parser if available
    const mod = await import('@xeokit/xeokit-convert');
    if (typeof (mod as any).parseOBJIntoXKTModel === 'function') {
      const objText = new TextDecoder().decode(glbData);
      await (mod as any).parseOBJIntoXKTModel({
        data: objText,
        xktModel,
        log: logger,
      });
    } else {
      // Fallback: try parseGLTFIntoXKTModel with the raw data
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

      // 2. Convert GLB -> XKT in browser
      log('Konverterar till XKT...');
      const xktData = await convertGlbToXkt(glbData, log);

      // 3. Store XKT via xktCacheService
      log('Sparar XKT-modell...');
      const saved = await xktCacheService.saveModelFromViewer(
        modelId,
        xktData,
        buildingFmGuid,
        fileName || modelId
      );

      if (saved) {
        log('XKT-modell sparad!');
        return { success: true };
      } else {
        return { success: false, error: 'Failed to save XKT to cache' };
      }
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

  stopAllPolling() {
    for (const [, interval] of this.pollingIntervals) {
      clearInterval(interval);
    }
    this.pollingIntervals.clear();
  }

  /**
   * Full pipeline: translate -> poll -> download -> convert -> store
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
    // Step 1: Start translation
    onStatusChange({ status: 'pending', message: 'Startar översättning...' });
    const startResult = await this.startTranslation(versionUrn, options);
    
    if (startResult.status === 'failed') {
      onStatusChange(startResult);
      return startResult;
    }

    const doDownloadAndConvert = async (): Promise<TranslationStatus> => {
      // Download derivative
      onStatusChange({ status: 'downloading', message: 'Laddar ner geometri...' });
      const dlResult = await this.downloadDerivative(versionUrn, options);

      if (dlResult.status !== 'complete' || !dlResult.downloadUrl) {
        onStatusChange(dlResult);
        return dlResult;
      }

      // Convert to XKT in browser
      if (options.buildingFmGuid) {
        onStatusChange({ status: 'converting', message: 'Konverterar till XKT...' });
        const safeModelId = versionUrn.replace(/[^a-zA-Z0-9-_]/g, '_');
        const convertResult = await this.convertAndStore(
          dlResult.downloadUrl,
          options.buildingFmGuid,
          safeModelId,
          options.fileName,
          (msg) => onStatusChange({ status: 'converting', message: msg })
        );

        if (convertResult.success) {
          const finalStatus: TranslationStatus = {
            status: 'complete',
            message: '3D-modell konverterad och sparad!',
          };
          onStatusChange(finalStatus);
          return finalStatus;
        } else {
          const failStatus: TranslationStatus = {
            status: 'failed',
            error: convertResult.error || 'XKT-konvertering misslyckades',
          };
          onStatusChange(failStatus);
          return failStatus;
        }
      }

      onStatusChange(dlResult);
      return dlResult;
    };

    if (startResult.status === 'success') {
      return doDownloadAndConvert();
    }

    // Step 2: Poll for completion, then download + convert
    return new Promise((resolve) => {
      this.startPolling(versionUrn, async (status) => {
        onStatusChange(status);

        if (status.status === 'success') {
          const result = await doDownloadAndConvert();
          resolve(result);
        } else if (status.status === 'failed') {
          resolve(status);
        }
      }, 8000);
    });
  }
}

export const accXktConverter = AccXktConverter.getInstance();
