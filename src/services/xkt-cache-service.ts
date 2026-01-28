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

/**
 * XKT Model Cache Service
 * 
 * Provides caching functionality for XKT 3D models to improve load times.
 * Uses Lovable Cloud Storage to store cached models.
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
  async checkCache(modelId: string, buildingFmGuid?: string): Promise<CacheCheckResult> {
    try {
      // First check the xkt_models database table with multiple matching strategies
      if (buildingFmGuid) {
        // Clean up modelId for matching
        const cleanModelId = modelId.replace(/\.xkt$/i, '');
        const modelIdWithExt = cleanModelId + '.xkt';
        
        // Try matching on model_id or file_name
        const { data: dbModels } = await supabase
          .from('xkt_models')
          .select('file_url, storage_path, file_name, model_id')
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

          if (match) {
            if (match.file_url) {
              console.log('XKT found in database:', modelId);
              return { cached: true, url: match.file_url };
            }

            // If we have storage_path but no file_url, generate a new signed URL
            if (match.storage_path) {
              const { data: urlData } = await supabase.storage
                .from('xkt-models')
                .createSignedUrl(match.storage_path, 3600);
              
              if (urlData?.signedUrl) {
                console.log('XKT signed URL generated:', modelId);
                return { cached: true, url: urlData.signedUrl };
              }
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
   * Intercept XKT model requests and return cached version if available
   * Returns the cached URL or null if not cached
   */
  async interceptModelRequest(
    originalUrl: string, 
    buildingFmGuid?: string
  ): Promise<string | null> {
    // Extract model ID from URL (typically the last path segment before .xkt)
    const modelId = this.extractModelId(originalUrl);
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
   * @deprecated Use extractModelIdFromUrl instead
   */
  private extractModelId(url: string): string | null {
    return this.extractModelIdFromUrl(url);
  }

  /**
   * Fetch XKT model with caching
   * First checks cache, then fetches from original URL and caches the result
   */
  async fetchWithCache(
    originalUrl: string,
    buildingFmGuid?: string,
    fetchOptions?: RequestInit
  ): Promise<ArrayBuffer> {
    const modelId = this.extractModelId(originalUrl);
    
    if (modelId) {
      // Check if we have a cached version
      const cachedUrl = await this.interceptModelRequest(originalUrl, buildingFmGuid);
      if (cachedUrl) {
        try {
          const response = await fetch(cachedUrl);
          if (response.ok) {
            console.log('XKT loaded from cache:', modelId);
            return await response.arrayBuffer();
          }
        } catch (e) {
          console.warn('Failed to load from cache, falling back to original:', e);
        }
      }
    }

    // Fetch from original URL
    console.log('XKT fetching from source:', originalUrl);
    const response = await fetch(originalUrl, fetchOptions);
    if (!response.ok) {
      throw new Error(`Failed to fetch XKT: ${response.status}`);
    }

    const data = await response.arrayBuffer();

    // Cache the model in the background (don't await)
    if (modelId) {
      this.storeModel(modelId, data, buildingFmGuid).catch(e => {
        console.warn('Background cache store failed:', e);
      });
    }

    return data;
  }
}

// Export singleton instance
export const xktCacheService = XktCacheService.getInstance();
