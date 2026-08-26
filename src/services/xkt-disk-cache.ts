/**
 * XKT Disk Cache — OPFS with automatic IDB fallback
 *
 * Single entry-point for all XKT disk caching. Tries OPFS first
 * (3–10× faster than IDB for large binary files) and falls back to
 * IndexedDB on browsers/contexts where OPFS is unavailable (e.g.
 * Firefox private browsing, very old Safari).
 *
 * Migration: on the first OPFS miss for a model that exists in IDB,
 * the data is silently migrated to OPFS so subsequent loads skip IDB.
 *
 * Usage: import { xktDiskCache } from '@/services/xkt-disk-cache'
 *        and use it everywhere in place of xktIdbCache.
 */

import { xktOpfsCache } from './xkt-opfs-cache';
import { xktIdbCache } from './xkt-idb-cache';
import { logger } from '@/lib/logger';

let _opfsOk: boolean | null = null;

async function opfsAvailable(): Promise<boolean> {
  if (_opfsOk !== null) return _opfsOk;
  try {
    if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') {
      _opfsOk = false;
      return false;
    }
    // Light probe: just open the root — no file creation needed
    await navigator.storage.getDirectory();
    _opfsOk = true;
  } catch {
    _opfsOk = false;
    logger.warn('[DiskCache] OPFS unavailable — using IndexedDB fallback');
  }
  return _opfsOk;
}

export const xktDiskCache = {
  /**
   * Read a model from disk cache.
   * Checks OPFS first; if missed, checks IDB and migrates the data to OPFS.
   */
  async get(buildingFmGuid: string, modelId: string): Promise<ArrayBuffer | null> {
    if (await opfsAvailable()) {
      const opfsData = await xktOpfsCache.get(buildingFmGuid, modelId);
      if (opfsData) return opfsData;

      // OPFS miss — check IDB for data cached in a previous session
      const idbData = await xktIdbCache.get(buildingFmGuid, modelId);
      if (idbData) {
        // Silently migrate to OPFS so next load skips IDB
        xktOpfsCache.put(buildingFmGuid, modelId, idbData, null).catch(() => {});
        logger.log(`[DiskCache] Migrated ${modelId} IDB→OPFS`);
        return idbData;
      }
      return null;
    }
    return xktIdbCache.get(buildingFmGuid, modelId);
  },

  /** Store a model to the preferred disk cache. */
  async put(
    buildingFmGuid: string,
    modelId: string,
    data: ArrayBuffer,
    modelUpdatedAt: string | null = null,
  ): Promise<void> {
    if (await opfsAvailable()) {
      await xktOpfsCache.put(buildingFmGuid, modelId, data, modelUpdatedAt);
    } else {
      await xktIdbCache.put(buildingFmGuid, modelId, data, modelUpdatedAt);
    }
  },

  /** True if the cached version is older than the DB record. */
  async isStale(
    buildingFmGuid: string,
    modelId: string,
    dbUpdatedAt: string | null,
  ): Promise<boolean> {
    if (await opfsAvailable()) {
      return xktOpfsCache.isStale(buildingFmGuid, modelId, dbUpdatedAt);
    }
    return xktIdbCache.isStale(buildingFmGuid, modelId, dbUpdatedAt);
  },

  /** Clear all cached data for a building (both OPFS and IDB). */
  async clearBuilding(buildingFmGuid: string): Promise<void> {
    await Promise.all([
      xktOpfsCache.clearBuilding(buildingFmGuid),
      xktIdbCache.clearBuilding(buildingFmGuid),
    ]);
  },

  /** Clear all cached data across all buildings (both OPFS and IDB). */
  async clearAll(): Promise<void> {
    await Promise.all([
      xktOpfsCache.clearAll(),
      xktIdbCache.clearAll(),
    ]);
  },

  /** Total bytes stored across OPFS and IDB. */
  async getStorageBytes(): Promise<number> {
    const [a, b] = await Promise.all([
      xktOpfsCache.getStorageBytes(),
      xktIdbCache.getStorageBytes(),
    ]);
    return a + b;
  },
};
