/**
 * XKT OPFS Cache — Origin Private File System
 *
 * Stores XKT model ArrayBuffers directly on the user's local disk via
 * the browser's Origin Private File System (OPFS) API. This is 3–10x
 * faster than IndexedDB for large binary files because:
 *   - No serialization/deserialization overhead
 *   - Direct OS file I/O (bypasses IDB B-tree indexing)
 *   - Stored outside the browser HTTP cache (survives "Clear browsing data")
 *
 * File layout inside OPFS:
 *   xkt/
 *     {buildingFmGuid}/
 *       {modelId}.xkt      — raw XKT ArrayBuffer
 *       {modelId}.meta     — JSON: { modelUpdatedAt, storedAt, size }
 *
 * Browser support: Chrome 102+, Edge 102+, Firefox 111+, Safari 15.2+
 */

import { logger } from '@/lib/logger';

interface ModelMeta {
  modelUpdatedAt: string | null;
  storedAt: number;
  size: number;
}

class XktOpfsCache {
  private rootPromise: Promise<FileSystemDirectoryHandle | null> | null = null;

  /** Open (and cache) the xkt/ subdirectory in OPFS root. */
  private getRoot(): Promise<FileSystemDirectoryHandle | null> {
    if (!this.rootPromise) {
      this.rootPromise = (async () => {
        if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') {
          return null;
        }
        try {
          const opfsRoot = await navigator.storage.getDirectory();
          return await opfsRoot.getDirectoryHandle('xkt', { create: true });
        } catch (e) {
          logger.warn('[OPFS] Root open failed:', e);
          return null;
        }
      })();
    }
    return this.rootPromise;
  }

  private async getBuildingDir(
    buildingFmGuid: string,
    create = false,
  ): Promise<FileSystemDirectoryHandle | null> {
    const root = await this.getRoot();
    if (!root) return null;
    try {
      return await root.getDirectoryHandle(buildingFmGuid, { create });
    } catch {
      return null;
    }
  }

  /** Read a cached model. Returns null if not found or OPFS unavailable. */
  async get(buildingFmGuid: string, modelId: string): Promise<ArrayBuffer | null> {
    try {
      const dir = await this.getBuildingDir(buildingFmGuid);
      if (!dir) return null;
      const fh = await dir.getFileHandle(`${modelId}.xkt`);
      const file = await fh.getFile();
      return await file.arrayBuffer();
    } catch {
      return null;
    }
  }

  /** Store a model and its metadata. Fire-and-forget safe — call without await. */
  async put(
    buildingFmGuid: string,
    modelId: string,
    data: ArrayBuffer,
    modelUpdatedAt: string | null = null,
  ): Promise<void> {
    try {
      const dir = await this.getBuildingDir(buildingFmGuid, true);
      if (!dir) return;

      const meta: ModelMeta = { modelUpdatedAt, storedAt: Date.now(), size: data.byteLength };

      await Promise.all([
        (async () => {
          const fh = await dir.getFileHandle(`${modelId}.xkt`, { create: true });
          const w = await fh.createWritable();
          await w.write(data);
          await w.close();
        })(),
        (async () => {
          const mh = await dir.getFileHandle(`${modelId}.meta`, { create: true });
          const w = await mh.createWritable();
          await w.write(JSON.stringify(meta));
          await w.close();
        })(),
      ]);

      logger.log(
        `%c[OPFS] 💾 ${modelId} (${(data.byteLength / 1024 / 1024).toFixed(1)} MB)`,
        'color:#a855f7;font-weight:bold',
      );
    } catch (e) {
      logger.warn('[OPFS] put failed:', e);
    }
  }

  /** True if the DB record is newer than what's stored on disk. */
  async isStale(
    buildingFmGuid: string,
    modelId: string,
    dbUpdatedAt: string | null,
  ): Promise<boolean> {
    if (!dbUpdatedAt) return false;
    try {
      const dir = await this.getBuildingDir(buildingFmGuid);
      if (!dir) return false;
      const mh = await dir.getFileHandle(`${modelId}.meta`);
      const file = await mh.getFile();
      const meta: ModelMeta = JSON.parse(await file.text());
      if (!meta.modelUpdatedAt) return false;
      return new Date(dbUpdatedAt).getTime() > new Date(meta.modelUpdatedAt).getTime();
    } catch {
      return false;
    }
  }

  /** Remove all cached files for a building. */
  async clearBuilding(buildingFmGuid: string): Promise<void> {
    try {
      const root = await this.getRoot();
      if (!root) return;
      await root.removeEntry(buildingFmGuid, { recursive: true });
      logger.log(`[OPFS] Cleared building ${buildingFmGuid.substring(0, 8)}…`);
    } catch {}
  }

  /** Remove the entire xkt/ OPFS directory (all buildings). */
  async clearAll(): Promise<void> {
    try {
      const opfsRoot = await navigator.storage.getDirectory();
      await opfsRoot.removeEntry('xkt', { recursive: true });
      this.rootPromise = null;
      logger.log('[OPFS] Cleared all');
    } catch {}
  }

  /** Sum of all .xkt file sizes on disk. */
  async getStorageBytes(): Promise<number> {
    try {
      const root = await this.getRoot();
      if (!root) return 0;
      let total = 0;
      for await (const [, dh] of (root as any).entries()) {
        if ((dh as FileSystemHandle).kind !== 'directory') continue;
        for await (const [name, fh] of (dh as any).entries()) {
          if ((name as string).endsWith('.xkt')) {
            const file = await (fh as FileSystemFileHandle).getFile();
            total += file.size;
          }
        }
      }
      return total;
    } catch {
      return 0;
    }
  }
}

export const xktOpfsCache = new XktOpfsCache();
