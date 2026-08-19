/**
 * XKT IndexedDB Cache
 *
 * Persists XKT model ArrayBuffers to the browser's disk-backed IndexedDB.
 * Survives page refresh and browser restarts — unlike the in-memory cache.
 *
 * Pipeline position (fastest → slowest):
 *   Memory (JS Map) → IndexedDB (this, disk) → Supabase Storage (network) → Asset+ API
 *
 * Key design:
 * - One IDB database "geminus-xkt-cache" with two object stores:
 *     "models"  — key: `${buildingFmGuid}/${modelId}`, value: ArrayBuffer
 *     "meta"    — key: same, value: { buildingFmGuid, modelId, size, storedAt, modelUpdatedAt }
 * - Cache invalidation: compare `modelUpdatedAt` from xkt_models row.
 *   If DB row is newer → evict IDB entry and re-fetch.
 * - Max storage: we rely on browser quota (typically 50%+ of disk).
 *   Explicit eviction only if StorageManager reports < MIN_FREE_BYTES left.
 */

import { logger } from '@/lib/logger';

const DB_NAME = 'geminus-xkt-cache';
const DB_VERSION = 1;
const MODELS_STORE = 'models';
const META_STORE = 'meta';

// Evict IDB entries for a building if free quota drops below this
const MIN_FREE_BYTES = 100 * 1024 * 1024; // 100 MB

interface ModelMeta {
  key: string;
  buildingFmGuid: string;
  modelId: string;
  size: number;
  storedAt: number;
  /** ISO string from xkt_models.updated_at — used for stale detection */
  modelUpdatedAt: string | null;
}

class XktIdbCache {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private available: boolean | null = null; // null = untested

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(MODELS_STORE)) {
          db.createObjectStore(MODELS_STORE);
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          const meta = db.createObjectStore(META_STORE, { keyPath: 'key' });
          meta.createIndex('by_building', 'buildingFmGuid', { unique: false });
        }
      };
      req.onsuccess = () => { this.available = true; resolve(req.result); };
      req.onerror = () => { this.available = false; reject(req.error); };
      req.onblocked = () => reject(new Error('IDB blocked'));
    });
    return this.dbPromise;
  }

  private async tx<T>(
    stores: string | string[],
    mode: IDBTransactionMode,
    fn: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    const db = await this.openDb();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      tx.onerror = () => reject(tx.error);
      fn(tx).then(resolve).catch(reject);
    });
  }

  private req<T>(r: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  /** Get a cached model. Returns null if not found or IDB unavailable. */
  async get(buildingFmGuid: string, modelId: string): Promise<ArrayBuffer | null> {
    if (this.available === false) return null;
    try {
      const key = `${buildingFmGuid}/${modelId}`;
      return await this.tx(MODELS_STORE, 'readonly', async (tx) => {
        const result = await this.req<ArrayBuffer | undefined>(tx.objectStore(MODELS_STORE).get(key));
        return result ?? null;
      });
    } catch (e) {
      this.available = false;
      logger.warn('[IDB Cache] get failed:', e);
      return null;
    }
  }

  /**
   * Store a model. Fire-and-forget safe — call without await.
   * @param modelUpdatedAt ISO string from xkt_models.updated_at for stale detection.
   */
  async put(
    buildingFmGuid: string,
    modelId: string,
    data: ArrayBuffer,
    modelUpdatedAt: string | null = null,
  ): Promise<void> {
    if (this.available === false) return;
    try {
      await this.ensureQuota(buildingFmGuid, data.byteLength);
      const key = `${buildingFmGuid}/${modelId}`;
      const meta: ModelMeta = {
        key, buildingFmGuid, modelId,
        size: data.byteLength,
        storedAt: Date.now(),
        modelUpdatedAt,
      };
      await this.tx([MODELS_STORE, META_STORE], 'readwrite', async (tx) => {
        await Promise.all([
          this.req(tx.objectStore(MODELS_STORE).put(data, key)),
          this.req(tx.objectStore(META_STORE).put(meta)),
        ]);
      });
      logger.log(`[IDB Cache] 💾 Stored ${modelId} (${(data.byteLength / 1024 / 1024).toFixed(1)} MB)`);
    } catch (e) {
      logger.warn('[IDB Cache] put failed:', e);
    }
  }

  /**
   * Check if a cached entry is stale (DB row is newer than what we have on disk).
   * Returns true if the IDB entry should be evicted and re-fetched.
   */
  async isStale(buildingFmGuid: string, modelId: string, dbUpdatedAt: string | null): Promise<boolean> {
    if (this.available === false || !dbUpdatedAt) return false;
    try {
      const key = `${buildingFmGuid}/${modelId}`;
      const meta = await this.tx<ModelMeta | undefined>(META_STORE, 'readonly', async (tx) =>
        this.req(tx.objectStore(META_STORE).get(key))
      );
      if (!meta?.modelUpdatedAt) return false;
      return new Date(dbUpdatedAt).getTime() > new Date(meta.modelUpdatedAt).getTime();
    } catch { return false; }
  }

  /** Get all meta entries for a building (for preload check). */
  async getBuildingMeta(buildingFmGuid: string): Promise<ModelMeta[]> {
    if (this.available === false) return [];
    try {
      return await this.tx(META_STORE, 'readonly', async (tx) => {
        const idx = tx.objectStore(META_STORE).index('by_building');
        return this.req<ModelMeta[]>(idx.getAll(buildingFmGuid));
      });
    } catch { return []; }
  }

  /** Remove all cached data for a building (e.g. after forced re-sync). */
  async clearBuilding(buildingFmGuid: string): Promise<void> {
    if (this.available === false) return;
    try {
      const metas = await this.getBuildingMeta(buildingFmGuid);
      if (metas.length === 0) return;
      await this.tx([MODELS_STORE, META_STORE], 'readwrite', async (tx) => {
        await Promise.all(metas.flatMap(m => [
          this.req(tx.objectStore(MODELS_STORE).delete(m.key)),
          this.req(tx.objectStore(META_STORE).delete(m.key)),
        ]));
      });
      logger.log(`[IDB Cache] Cleared ${metas.length} entries for building ${buildingFmGuid.substring(0, 8)}…`);
    } catch (e) {
      logger.warn('[IDB Cache] clearBuilding failed:', e);
    }
  }

  /** Remove all cached data. */
  async clearAll(): Promise<void> {
    if (this.available === false) return;
    try {
      await this.tx([MODELS_STORE, META_STORE], 'readwrite', async (tx) => {
        await Promise.all([
          this.req(tx.objectStore(MODELS_STORE).clear()),
          this.req(tx.objectStore(META_STORE).clear()),
        ]);
      });
      logger.log('[IDB Cache] Cleared all entries');
    } catch {}
  }

  /** Approximate total bytes stored in IDB cache. */
  async getStorageBytes(): Promise<number> {
    if (this.available === false) return 0;
    try {
      const metas = await this.tx<ModelMeta[]>(META_STORE, 'readonly', async (tx) =>
        this.req(tx.objectStore(META_STORE).getAll())
      );
      return metas.reduce((sum, m) => sum + m.size, 0);
    } catch { return 0; }
  }

  /**
   * If StorageManager says we're running low, evict the oldest entries for
   * this building to make room for the new data.
   */
  private async ensureQuota(buildingFmGuid: string, neededBytes: number): Promise<void> {
    if (!navigator.storage?.estimate) return;
    try {
      const { quota = 0, usage = 0 } = await navigator.storage.estimate();
      const free = quota - usage;
      if (free > MIN_FREE_BYTES + neededBytes) return; // plenty of room

      // Evict oldest entries for this building
      const metas = (await this.getBuildingMeta(buildingFmGuid))
        .sort((a, b) => a.storedAt - b.storedAt);

      let freed = 0;
      const toDelete = metas.filter(m => { if (freed < neededBytes) { freed += m.size; return true; } return false; });
      if (toDelete.length === 0) return;

      await this.tx([MODELS_STORE, META_STORE], 'readwrite', async (tx) => {
        await Promise.all(toDelete.flatMap(m => [
          this.req(tx.objectStore(MODELS_STORE).delete(m.key)),
          this.req(tx.objectStore(META_STORE).delete(m.key)),
        ]));
      });
      logger.warn(`[IDB Cache] Quota low — evicted ${toDelete.length} old entries (freed ~${(freed / 1024 / 1024).toFixed(1)} MB)`);
    } catch {}
  }
}

export const xktIdbCache = new XktIdbCache();
