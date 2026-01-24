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
   * Check if a model is cached and get its URL if available
   */
  async checkCache(modelId: string, buildingFmGuid?: string): Promise<CacheCheckResult> {
    try {
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
   * Get a cached model URL
   */
  async getCachedModel(modelId: string, buildingFmGuid?: string): Promise<string | null> {
    try {
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
   * Extract model ID from XKT URL
   */
  private extractModelId(url: string): string | null {
    try {
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
