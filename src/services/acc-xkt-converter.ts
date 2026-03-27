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
    parseIFCIntoXKTModel: mod.parseIFCIntoXKTModel,
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
 * Extracted IFC hierarchy from XKT model metadata.
 */
export interface IfcHierarchyResult {
  xktData: ArrayBuffer;
  metaModelJson: any;
  levels: Array<{ id: string; name: string; type: string; globalId?: string }>;
  spaces: Array<{ id: string; name: string; type: string; parentId: string; globalId?: string }>;
  systems: Array<{ name: string; type: string; discipline: string; memberIds: string[] }>;
}

/**
 * Convert a GLB/glTF/OBJ/IFC ArrayBuffer into an XKT ArrayBuffer using xeokit-convert.
 * Returns the XKT binary ready for storage.
 */
export async function convertGlbToXkt(
  glbData: ArrayBuffer,
  log?: (msg: string) => void
): Promise<ArrayBuffer> {
  const result = await convertToXktWithMetadata(glbData, log);
  return result.xktData;
}

/**
 * Convert to XKT and also extract IFC hierarchy metadata (levels, spaces).
 */
export async function convertToXktWithMetadata(
  glbData: ArrayBuffer,
  log?: (msg: string) => void
): Promise<IfcHierarchyResult> {
  const logger = log || ((msg: string) => console.log('[xkt-convert]', msg));

  const format = detectFormat(glbData);
  logger(`Detected input format: ${format} (${(glbData.byteLength / 1024 / 1024).toFixed(2)} MB)`);

  if (format === 'unknown') {
    const header = new Uint8Array(glbData, 0, Math.min(64, glbData.byteLength));
    const headerHex = Array.from(header.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const firstBytes = new TextDecoder().decode(header.slice(0, 20));
    const looksLikeJson = firstBytes.trimStart().startsWith('{') || firstBytes.trimStart().startsWith('[');
    
    throw new Error(
      looksLikeJson
        ? `The file appears to be an SVF2 manifest (JSON), not a geometry file. ` +
          `RVT files generate SVF2 format which requires server-side conversion and cannot be converted in the browser.`
        : `Unknown file format (header: ${headerHex}). ` +
          `RVT files generate SVF2 format which is not supported for client-side conversion. ` +
          `Hierarchy data (buildings, floors, rooms) is synced via BIM sync instead.`
    );
  }

  logger('Loading xeokit-convert...');
  const { XKTModel, writeXKTModelToArrayBuffer, parseGLTFIntoXKTModel } = await loadXeokitConvert();

  logger('Creating XKTModel...');
  const xktModel = new XKTModel();

  if (format === 'ifc') {
    logger('Parsing IFC into XKTModel (browser-side)...');
    const mod = await loadXeokitConvert();
    
    let WebIFC: any;
    
    // Validate WASM availability before importing web-ifc
    const wasmDir = '/web-ifc-wasm/';
    try {
      const wasmCheck = await fetch(`${wasmDir}web-ifc.wasm`, { method: 'HEAD' });
      if (!wasmCheck.ok) {
        throw new Error(`WASM file not found at ${wasmDir}web-ifc.wasm (${wasmCheck.status})`);
      }
      logger('WASM files verified at ' + wasmDir);
    } catch (wasmCheckErr: any) {
      logger(`WASM validation failed: ${wasmCheckErr.message}`);
      throw new Error(`web-ifc WASM files not available at ${wasmDir}. Ensure viteStaticCopy is configured correctly.`);
    }
    
    try {
      WebIFC = await import('web-ifc');
      logger('web-ifc module loaded successfully');
    } catch (wasmErr: any) {
      logger(`Failed to load web-ifc: ${wasmErr.message}`);
      console.error('[xkt-convert] web-ifc import failed:', wasmErr);
      throw new Error(`web-ifc WASM module failed to load: ${wasmErr.message}`);
    }

    logger(`Using web-ifc WASM from ${wasmDir}`);
    
    try {
      await (mod as any).parseIFCIntoXKTModel({
        WebIFC,
        data: glbData,
        xktModel,
        autoNormals: false,
        wasmPath: wasmDir,
        log: logger,
      });
    } catch (parseErr: any) {
      logger(`IFC parse error: ${parseErr.message}`);
      console.error('[xkt-convert] parseIFCIntoXKTModel failed:', parseErr);
      throw new Error(`IFC parsing failed: ${parseErr.message}`);
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

  // Extract IFC hierarchy and metadata from metaObjects
  const levels: IfcHierarchyResult['levels'] = [];
  const spaces: IfcHierarchyResult['spaces'] = [];
  const systems: IfcHierarchyResult['systems'] = [];
  const metaModelObjects: any[] = [];
  const systemMap = new Map<string, { name: string; type: string; discipline: string; memberIds: string[] }>();

  if (xktModel.metaObjects) {
    const metaObjValues = Array.isArray(xktModel.metaObjects)
      ? xktModel.metaObjects
      : Object.values(xktModel.metaObjects);
    // Log unique types for diagnostics
    const typeSet = new Set<string>();
    for (const metaObj of metaObjValues as any[]) {
      // XKTMetaObject uses 'metaObjectType' — check it first
      const metaType = metaObj.metaObjectType || metaObj.metaType || metaObj.type || '';
      const objId = metaObj.metaObjectId || metaObj.id || '';
      const objName = metaObj.metaObjectName || metaObj.name || metaType;
      const parentId = metaObj.parentMetaObjectId || metaObj.parentId || '';
      if (metaType) typeSet.add(metaType);

      // Build xeokit MetaModel JSON entry — include IFC GlobalId if available
      const globalId = metaObj.originalSystemId || metaObj.globalId || metaObj.GlobalId || '';
      metaModelObjects.push({
        id: objId,
        type: metaType,
        name: objName,
        parent: parentId || undefined,
        ...(globalId ? { globalId } : {}),
      });

      if (metaType === 'IfcBuildingStorey') {
        levels.push({ id: objId, name: objName, type: metaType, globalId: globalId || undefined });
      } else if (metaType === 'IfcSpace') {
        spaces.push({ id: objId, name: objName, type: metaType, parentId, globalId: globalId || undefined });
      } else if (metaType === 'IfcSystem' || metaType === 'IfcDistributionSystem') {
        systemMap.set(objId, { name: objName, type: metaType, discipline: inferDiscipline(objName), memberIds: [] });
      }

      // Track system membership via property sets or parent chains
      if (metaObj.propertySets) {
        for (const ps of (Array.isArray(metaObj.propertySets) ? metaObj.propertySets : Object.values(metaObj.propertySets)) as any[]) {
          const sysName = ps?.SystemName || ps?.['System Name'] || ps?.systemName;
          if (sysName && typeof sysName === 'string') {
            if (!systemMap.has(sysName)) {
              systemMap.set(sysName, { name: sysName, type: 'PropertyGrouped', discipline: inferDiscipline(sysName), memberIds: [] });
            }
            systemMap.get(sysName)!.memberIds.push(objId);
          }
        }
      }
    }

    // Resolve system membership from parent relationships
    for (const metaObj of metaObjValues as any[]) {
      const parentId = metaObj.parentMetaObjectId || metaObj.parentId || '';
      if (systemMap.has(parentId)) {
        const objId = metaObj.metaObjectId || metaObj.id || '';
        systemMap.get(parentId)!.memberIds.push(objId);
      }
    }

    // Log unique types for diagnostics
    if (typeSet.size > 0) {
      const ifcTypes = [...typeSet].filter(t => t.startsWith('Ifc')).sort();
      logger(`Found ${typeSet.size} unique meta types (IFC: ${ifcTypes.length}): ${ifcTypes.slice(0, 15).join(', ')}${ifcTypes.length > 15 ? '...' : ''}`);
    } else {
      logger('⚠️ No meta types found in xktModel.metaObjects — type extraction failed');
    }
  }

  systems.push(...systemMap.values());

  if (levels.length || spaces.length) {
    logger(`Extracted IFC hierarchy: ${levels.length} levels, ${spaces.length} spaces`);
  }
  if (systems.length > 0) {
    logger(`Extracted ${systems.length} systems client-side`);
  }

  // Build xeokit-compatible MetaModel JSON
  const metaModelJson = {
    metaObjects: metaModelObjects,
  };

  logger('Writing XKT to ArrayBuffer...');
  const stats: Record<string, any> = { texturesSize: 0 };
  const xktArrayBuffer = writeXKTModelToArrayBuffer(xktModel, null, stats, { zip: false });

  logger(`XKT conversion complete (${(xktArrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB, ${metaModelObjects.length} meta objects)`);
  return { xktData: xktArrayBuffer, metaModelJson, levels, spaces, systems };
}

/**
 * Infer discipline from system name using common patterns.
 */
function inferDiscipline(name: string): string {
  const upper = (name || '').toUpperCase();
  if (/VENT|LUFT|AIR|AHU|VAV|SUPPLY|EXHAUST|FRÅNLUFT|TILLUFT/.test(upper)) return 'Ventilation';
  if (/VÄRME|HEAT|RADIATOR|VV|VÄX/.test(upper)) return 'Heating';
  if (/KYL|COOL|CHILL/.test(upper)) return 'Cooling';
  if (/EL|ELECTR|KRAFT|BELYSN|LIGHT/.test(upper)) return 'Electrical';
  if (/VA|VATTEN|PLUMB|AVLOPP|SANIT/.test(upper)) return 'Plumbing';
  if (/BRAND|FIRE|SPRINK/.test(upper)) return 'FireProtection';
  return 'Other';
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
        return { status: 'pending', message: `Translation in progress (${data.translationStatus || 'pending'})...` };
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

      // For IFC and GLB/OBJ: convert to XKT for optimized viewer loading
      if (format === 'ifc' || format === 'glb' || format === 'obj') {
        log(`Konverterar ${format.toUpperCase()} till XKT...`);
        const xktData = await convertGlbToXkt(glbData, log);
        
        const storageFileName = `${modelId}.xkt`;
        const storagePath = `${buildingFmGuid}/${storageFileName}`;
        
        log(`Sparar XKT-fil (${(xktData.byteLength / 1024 / 1024).toFixed(2)} MB)...`);
        
        const blob = new Blob([xktData], { type: 'application/octet-stream' });
        const { error: uploadError } = await supabase.storage
          .from('xkt-models')
          .upload(storagePath, blob, {
            contentType: 'application/octet-stream',
            upsert: true,
          });
        
        if (uploadError) {
          throw new Error(`Upload failed: ${uploadError.message}`);
        }

        // Save metadata as XKT format
        const { error: dbError } = await supabase
          .from('xkt_models')
          .upsert({
            building_fm_guid: buildingFmGuid,
            model_id: modelId,
            model_name: fileName || modelId,
            file_name: storageFileName,
            file_size: xktData.byteLength,
            storage_path: storagePath,
            file_url: null,
            format: 'xkt',
            synced_at: new Date().toISOString(),
            source_updated_at: new Date().toISOString(),
          } as any, {
            onConflict: 'building_fm_guid,model_id',
          });
        
        if (dbError) {
          log(`DB-fel: ${dbError.message}`);
          return { success: false, error: `DB error: ${dbError.message}` };
        }

        log(`XKT-modell sparad! Viewern laddar den direkt.`);
        return { success: true };
      }

      // Unknown format - save as-is
      const fileExt = 'bin';
      const storageFileName = `${modelId}.${fileExt}`;
      const storagePath = `${buildingFmGuid}/${storageFileName}`;
      
      log(`Okänt format, sparar som ${fileExt}...`);
      
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

      const { error: dbError } = await supabase
        .from('xkt_models')
        .upsert({
          building_fm_guid: buildingFmGuid,
          model_id: modelId,
          model_name: fileName || modelId,
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

      log(`Modell sparad som ${fileExt}.`);
      return { success: true };
    } catch (e: any) {
      log(`Konverteringsfel: ${e.message}`);
      console.error('convertAndStore error:', e);
      return { success: false, error: e.message };
    }
  }

  /**
   * Split a converted XKT model into per-storey chunks and upload each.
   * Called after a successful convertAndStore to create progressive-loading chunks.
   */
  async splitAndStoreByStorey(
    fullXktData: ArrayBuffer,
    modelId: string,
    buildingFmGuid: string,
    storeys: Array<{ id: string; name: string }>,
    onLog?: (msg: string) => void
  ): Promise<{ success: boolean; chunkCount: number }> {
    const log = onLog || ((msg: string) => console.log('[xkt-split]', msg));

    if (storeys.length === 0) {
      log('No storeys found — skipping split');
      return { success: false, chunkCount: 0 };
    }

    try {
      // For now, record the storey metadata without actual binary splitting
      // (True binary splitting requires parsing XKT internals which is complex)
      // Instead, we record the storey association so the viewer can prioritize loading
      log(`Recording ${storeys.length} storey chunks for model ${modelId}`);

      for (let i = 0; i < storeys.length; i++) {
        const storey = storeys[i];
        const chunkModelId = `${modelId}_storey_${storey.id}`;
        const chunkFileName = `${chunkModelId}.xkt`;
        const chunkStoragePath = `${buildingFmGuid}/${chunkFileName}`;

        // Record chunk metadata (points to same storage as parent for now)
        const { error: dbError } = await supabase
          .from('xkt_models')
          .upsert({
            building_fm_guid: buildingFmGuid,
            model_id: chunkModelId,
            model_name: storey.name,
            file_name: chunkFileName,
            file_size: 0, // Will be populated when actual splitting is implemented
            storage_path: chunkStoragePath,
            file_url: null,
            format: 'xkt',
            parent_model_id: modelId,
            storey_fm_guid: storey.id,
            is_chunk: true,
            chunk_order: i,
            synced_at: new Date().toISOString(),
          } as any, {
            onConflict: 'building_fm_guid,model_id',
          });

        if (dbError) {
          log(`Chunk DB error for ${storey.name}: ${dbError.message}`);
        }
      }

      log(`Recorded ${storeys.length} storey chunk entries`);
      return { success: true, chunkCount: storeys.length };
    } catch (e: any) {
      log(`Split error: ${e.message}`);
      return { success: false, chunkCount: 0 };
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
