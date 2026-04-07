import { supabase } from '@/integrations/supabase/client';

interface CacheCheckResult {
  cached: boolean;
  url?: string;
}

interface CacheStoreResult {
  success: boolean;
  url?: string;
  error?: string;
}

// Track models currently being saved to prevent duplicates
const savingModels = new Set<string>();

// Track failed cache checks to avoid repeated calls for the same model
const failedChecks = new Map<string, number>();
const MAX_CHECK_RETRIES = 2;

// Maximum concurrent saves to prevent overwhelming the backend
const MAX_CONCURRENT_SAVES = 2;
let currentSaveCount = 0;

/**
 * XKT Model Cache Service
 * 
 * Provides caching functionality for XKT 3D models to improve load times.
 * Uses Lovable Cloud Storage to store cached models.
 * 
 * Implements "Cache-on-Load" strategy: models are captured from the viewer
 * during the first successful load and saved to backend in the background.
 */
export class XktCacheService {
  private static instance: XktCacheService;
  private pendingStores: Set<string> = new Set();
  
  private constructor() {}
  
  static getInstance(): XktCacheService {
    if (!XktCacheService.instance) {
      XktCacheService.instance = new XktCacheService();
    }
    return XktCacheService.instance;
  }

  /**
   * Check if a model is cached - first checks database with multiple matching strategies
   */
  async checkCache(modelId: string, buildingFmGuid?: string): Promise<CacheCheckResult & { stale?: boolean; sourceUpdatedAt?: string; format?: string }> {
    // Check retry limit to prevent tight retry loops
    const retryKey = `${buildingFmGuid || 'global'}/${modelId}`;
    const attempts = failedChecks.get(retryKey) || 0;
    if (attempts >= MAX_CHECK_RETRIES) {
      return { cached: false };
    }

    try {
      // First check the xkt_models database table with multiple matching strategies
      if (buildingFmGuid) {
        // Clean up modelId for matching
        const cleanModelId = modelId.replace(/\.xkt$/i, '');
        const modelIdWithExt = cleanModelId + '.xkt';
        
        // Try matching on model_id or file_name
        const { data: dbModels } = await supabase
          .from('xkt_models')
          .select('file_url, storage_path, file_name, model_id, file_size, synced_at, source_updated_at, format')
          .eq('building_fm_guid', buildingFmGuid);

        if (dbModels && dbModels.length > 0) {
          // Find matching model using multiple strategies
          const match = dbModels.find(m => {
            const fileName = m.file_name?.toLowerCase() || '';
            const dbModelId = m.model_id?.toLowerCase() || '';
            const searchId = cleanModelId.toLowerCase();
            const searchIdWithExt = modelIdWithExt.toLowerCase();
            
            return (
              fileName === searchIdWithExt ||
              fileName === searchId ||
              fileName.includes(searchId) ||
              dbModelId === searchId ||
              dbModelId.includes(searchId) ||
              searchId.includes(dbModelId)
            );
          });

          // Staleness check: if cached model is older than 7 days, mark as stale
          const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
          const isStale = match?.synced_at 
            ? (Date.now() - new Date(match.synced_at).getTime() > MAX_CACHE_AGE_MS)
            : false;

          const MIN_VALID_XKT_BYTES = 50_000;
          if (match && typeof (match as any).file_size === 'number' && (match as any).file_size > 0 && (match as any).file_size < MIN_VALID_XKT_BYTES) {
            console.warn(`XKT cache: Skipping corrupt DB entry for ${modelId} (${(match as any).file_size} bytes)`);
            return { cached: false };
          }

          if (match && match.storage_path) {
            // Always generate a fresh signed URL from storage_path
            // (file_url may contain an expired signed URL)
            const { data: urlData } = await supabase.storage
              .from('xkt-models')
              .createSignedUrl(match.storage_path, 3600);
            
            if (urlData?.signedUrl) {
              const modelFormat = (match as any).format || 'xkt';
              if (isStale) {
                console.log('XKT cache hit but STALE (>7 days):', modelId);
                return { cached: true, url: urlData.signedUrl, stale: true, sourceUpdatedAt: match.source_updated_at || undefined, format: modelFormat };
              }
              console.log('XKT cache hit (signed URL):', modelId, 'format:', modelFormat);
              return { cached: true, url: urlData.signedUrl, sourceUpdatedAt: match.source_updated_at || undefined, format: modelFormat };
            }
          }
        }
      }

      // Fallback to edge function
      const { data, error } = await supabase.functions.invoke('xkt-cache', {
        body: {
          action: 'check',
          modelId,
          buildingFmGuid,
        },
      });

      if (error) {
        console.warn('XKT cache check failed:', error);
        return { cached: false };
      }

      return {
        cached: data?.cached || false,
        url: data?.url,
      };
    } catch (e) {
      console.warn('XKT cache check error:', e);
      failedChecks.set(retryKey, attempts + 1);
      return { cached: false };
    }
  }

  /**
   * Get a cached model URL - first checks database with flexible matching
   */
  async getCachedModel(modelId: string, buildingFmGuid?: string): Promise<string | null> {
    try {
      // Use the improved checkCache which has flexible matching
      const result = await this.checkCache(modelId, buildingFmGuid);
      if (result.cached && result.url) {
        return result.url;
      }

      // Fallback to edge function
      const { data, error } = await supabase.functions.invoke('xkt-cache', {
        body: {
          action: 'get',
          modelId,
          buildingFmGuid,
        },
      });

      if (error || !data?.success) {
        return null;
      }

      return data?.url || null;
    } catch (e) {
      console.warn('XKT cache get error:', e);
      return null;
    }
  }

  /**
   * Store a model in the cache
   * Accepts ArrayBuffer or base64 encoded string
   */
  async storeModel(
    modelId: string, 
    xktData: ArrayBuffer | string, 
    buildingFmGuid?: string
  ): Promise<CacheStoreResult> {
    // Prevent duplicate stores for the same model
    const cacheKey = `${buildingFmGuid || 'global'}/${modelId}`;
    if (this.pendingStores.has(cacheKey)) {
      console.log('XKT cache: Store already in progress for', cacheKey);
      return { success: false, error: 'Store already in progress' };
    }

    this.pendingStores.add(cacheKey);

    try {
      // Convert ArrayBuffer to base64 if needed
      let base64Data: string;
      if (typeof xktData === 'string') {
        base64Data = xktData;
      } else {
        base64Data = this.arrayBufferToBase64(xktData);
      }

      const { data, error } = await supabase.functions.invoke('xkt-cache', {
        body: {
          action: 'store',
          modelId,
          buildingFmGuid,
          xktData: base64Data,
        },
      });

      if (error) {
        console.warn('XKT cache store failed:', error);
        return { success: false, error: error.message };
      }

      console.log('XKT model cached successfully:', modelId);
      return {
        success: data?.success || false,
        url: data?.url,
      };
    } catch (e) {
      console.warn('XKT cache store error:', e);
      return { 
        success: false, 
        error: e instanceof Error ? e.message : 'Unknown error' 
      };
    } finally {
      this.pendingStores.delete(cacheKey);
    }
  }

  /**
   * Save a model captured from the viewer to backend storage.
   * Optimized for background saving - non-blocking and with rate limiting.
   * 
   * This is the core of the "Cache-on-Load" strategy.
   */
  async saveModelFromViewer(
    modelId: string,
    xktData: ArrayBuffer,
    buildingFmGuid: string,
    modelName?: string,
    sourceLastModified?: string
  ): Promise<boolean> {
    const cacheKey = `${buildingFmGuid}/${modelId}`;
    
    // Skip if already saving this model
    if (savingModels.has(cacheKey)) {
      console.log('XKT save: Already saving', modelId);
      return false;
    }
    
    // Rate limit concurrent saves
    if (currentSaveCount >= MAX_CONCURRENT_SAVES) {
      console.log('XKT save: Rate limited, skipping', modelId);
      return false;
    }
    
    // Note: We no longer skip if already in database — upsert handles updates
    // This allows stale entries to be refreshed with new data
    
    savingModels.add(cacheKey);
    currentSaveCount++;
    
    try {
      const bareModelId = modelId.endsWith('.xkt') ? modelId.slice(0, -4) : modelId;
      const fileName = `${bareModelId}.xkt`;
      const storagePath = `${buildingFmGuid}/${fileName}`;
      
      console.log(`XKT save: Uploading ${bareModelId} (${(xktData.byteLength / 1024 / 1024).toFixed(2)} MB)`);
      
      // Upload directly to storage — avoids the 8 MB edge function body limit
      const blob = new Blob([xktData], { type: 'application/octet-stream' });
      const { error: uploadError } = await supabase.storage
        .from('xkt-models')
        .upload(storagePath, blob, { upsert: true, contentType: 'application/octet-stream', cacheControl: '0' });

      if (uploadError) {
        console.warn('XKT save: Direct storage upload failed', uploadError);
        return false;
      }
      
      // Save metadata to database (don't store signed URL - it expires)
      const { error: dbError } = await supabase
        .from('xkt_models')
        .upsert({
          building_fm_guid: buildingFmGuid,
          model_id: modelId,
          model_name: modelName || modelId,
          file_name: fileName,
          file_size: xktData.byteLength,
          storage_path: storagePath,
          file_url: null,
          synced_at: new Date().toISOString(),
          source_updated_at: sourceLastModified || new Date().toISOString(),
        }, {
          onConflict: 'building_fm_guid,model_id',
        });
      
      if (dbError) {
        console.warn('XKT save: DB insert failed', dbError);
        // Still return true since storage upload succeeded
      }
      
      console.log(`XKT save: Cached ${modelId} successfully`);
      return true;
    } catch (e) {
      console.error('XKT save: Error', e);
      return false;
    } finally {
      savingModels.delete(cacheKey);
      currentSaveCount--;
    }
  }

  /**
   * Convert ArrayBuffer to base64 string
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Extract model ID from XKT URL (public for use by cache interceptor)
   */
  extractModelIdFromUrl(url: string): string | null {
    try {
      // Check for modelid parameter in GetXktData URLs
      const modelIdMatch = url.match(/modelid=([^&]+)/i);
      if (modelIdMatch) {
        return modelIdMatch[1];
      }
      
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      const xktFile = pathParts.find(part => part.endsWith('.xkt'));
      if (xktFile) {
        return xktFile.replace('.xkt', '');
      }
      // Try last path segment
      const lastPart = pathParts[pathParts.length - 1];
      if (lastPart) {
        return lastPart.replace('.xkt', '');
      }
    } catch {
      // If URL parsing fails, try simple extraction
      const match = url.match(/([^/]+)\.xkt/);
      if (match) {
        return match[1];
      }
    }
    return null;
  }

  /**
   * Intercept XKT model requests and return cached version if available
   * Returns the cached URL or null if not cached
   */
  async interceptModelRequest(
    originalUrl: string, 
    buildingFmGuid?: string
  ): Promise<string | null> {
    // Extract model ID from URL (typically the last path segment before .xkt)
    const modelId = this.extractModelIdFromUrl(originalUrl);
    if (!modelId) {
      return null;
    }

    const result = await this.checkCache(modelId, buildingFmGuid);
    if (result.cached && result.url) {
      console.log('XKT cache hit for:', modelId);
      return result.url;
    }

    console.log('XKT cache miss for:', modelId);
    return null;
  }

  /**
   * Ensure XKT models are cached for a building.
   * Triggers sync if no cached models exist.
   * Used for proactive on-demand loading when opening a building in 3D viewer.
   */
  /**
   * Invalidate (delete) all cached XKT models for a building.
   * Forces a fresh load from Asset+ on next viewer open.
   */
  async invalidateBuildingCache(buildingFmGuid: string): Promise<boolean> {
    try {
      // Delete from database
      const { error: dbError } = await supabase
        .from('xkt_models')
        .delete()
        .eq('building_fm_guid', buildingFmGuid);
      
      if (dbError) {
        console.warn('XKT cache invalidation DB error:', dbError);
        return false;
      }

      // Delete from storage
      const { data: files } = await supabase.storage
        .from('xkt-models')
        .list(buildingFmGuid);
      
      if (files && files.length > 0) {
        const paths = files.map(f => `${buildingFmGuid}/${f.name}`);
        await supabase.storage.from('xkt-models').remove(paths);
      }

      console.log(`XKT cache: Invalidated all models for ${buildingFmGuid}`);
      return true;
    } catch (e) {
      console.warn('XKT cache invalidation error:', e);
      return false;
    }
  }

  async ensureBuildingModels(
    buildingFmGuid: string
  ): Promise<{ cached: boolean; count: number; syncing: boolean }> {
    try {
      // 1. Check xkt_models table
      const { count, error } = await supabase
        .from('xkt_models')
        .select('*', { count: 'exact', head: true })
        .eq('building_fm_guid', buildingFmGuid);

      if (error) {
        console.warn('XKT cache: Error checking models:', error);
        return { cached: false, count: 0, syncing: false };
      }

      if (count && count > 0) {
        console.log(`XKT cache: ${count} models found for ${buildingFmGuid}`);
        return { cached: true, count, syncing: false };
      }

      // 2. Don't trigger server-side sync - it won't work due to API restrictions
      // Instead, models will be cached via Cache-on-Load when the viewer loads them
      console.log(`XKT cache: No models for ${buildingFmGuid} - will cache on first load`);
      
      return { cached: false, count: 0, syncing: false };
    } catch (e) {
      console.warn('XKT ensureBuildingModels error:', e);
      return { cached: false, count: 0, syncing: false };
    }
  }
}

// Export singleton instance
export const xktCacheService = XktCacheService.getInstance();
