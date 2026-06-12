import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Database } from '@/integrations/supabase/types';

type BuildingSettingsRow = Database['public']['Tables']['building_settings']['Row'];

// ── Types ──────────────────────────────────────────────────────────

export interface GeminusBaseNode {
  objectId?: number;
  objectName?: string;
  name?: string;
  classId?: number;
  className?: string;
  guid?: string;
  systemGuid?: string;
  children?: GeminusBaseNode[];
  properties?: Record<string, any>;
  [key: string]: any;
}

export interface GeminusBaseSearchResult {
  objectId?: number;
  objectName?: string;
  className?: string;
  guid?: string;
  [key: string]: any;
}

export interface GeminusBaseDrawing {
  drawingId?: number;
  objectId?: number;
  name?: string;
  objectName?: string;
  [key: string]: any;
}

export interface GeminusBaseDocument {
  documentId?: number;
  objectId?: number;
  name?: string;
  objectName?: string;
  fileName?: string;
  [key: string]: any;
}

// ── Class ID mapping ───────────────────────────────────────────────

export const CLASS_LABELS: Record<number, string> = {
  102: 'Fastighet',
  103: 'Fastighet',
  104: 'Byggnad',
  105: 'Plan',
  106: 'Dokument',   // confirmed from native app tab label
  107: 'Utrymme',
  109: 'Objekt',
  110: 'Objekt',
  124: 'Objekt',
  138: 'Dörr',       // confirmed
  139: 'Fönster',    // confirmed
  174: 'El',         // inferred from large count
  177: 'Brandskydd', // confirmed from native app tab label
  210: 'Utrymme',   // confirmed from native app tab "Utrymme ■"
  214: 'Sensor',
};

// Classes with drawing spot representation — show "■" suffix in tabs
export const SPOT_CLASS_IDS = new Set([107, 138, 139, 174, 177, 210, 214]);

// Dynamic class label cache — populated from /api/config/classes/json
export const dynamicClassLabels: Record<number, string> = { ...CLASS_LABELS };

// Classes that represent the navigational hierarchy (show in tree)
export const NAV_CLASS_IDS = new Set([102, 103, 104, 105]);

// Classes that are leaf content (show in grid only, not in tree)
export const LEAF_CLASS_IDS = new Set([106, 107, 109, 110, 124, 138, 139]);

// ── Hook ───────────────────────────────────────────────────────────

async function fmCall(action: string, params: Record<string, any> = {}) {
  const { data, error } = await supabase.functions.invoke('geminus-base-query', {
    body: { action, ...params },
  });
  if (error) throw new Error(error.message || `Geminus Base call failed: ${action}`);
  if (!data?.success) throw new Error(data?.error || `Geminus Base ${action} failed`);
  return data;
}

export function useGeminusBaseApi() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const withLoading = useCallback(async <T>(fn: () => Promise<T>): Promise<T | null> => {
    setLoading(true);
    try {
      return await fn();
    } catch (err: any) {
      toast({ title: 'Geminus Base Error', description: err.message, variant: 'destructive' });
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // If buildingFmGuid is omitted, loads root perspective tree
  const getHierarchy = useCallback((buildingFmGuid?: string) =>
    withLoading(async () => {
      const params: Record<string, any> = {};
      if (buildingFmGuid) params.buildingFmGuid = buildingFmGuid;
      const res = await fmCall('get-hierarchy', params);
      return res.data as GeminusBaseNode | GeminusBaseNode[];
    }), [withLoading]);

  // Tree uses perspective 8, Grid uses perspective 9 (confirmed from Geminus Base URL params)
  const getSubtree = useCallback((guid: string, perspectiveId = '8') =>
    withLoading(async () => {
      const res = await fmCall('get-perspective-tree', { guid, perspectiveId });
      return res.data as GeminusBaseNode;
    }), [withLoading]);

  // ── Correct integer-ID tree endpoint (confirmed from network capture) ─────
  // GET /api/perspective/json/{tpid}/{classId}/{objectId}
  const getTreeChildren = useCallback((classId: number, objectId: number) =>
    withLoading(async () => {
      const res = await fmCall('proxy', { path: `/api/perspective/json/8/${classId}/${objectId}` });
      if (!res?.success || !res?.data) return null;
      return res.data as GeminusBaseNode; // has .children[] and .hasChildren
    }), [withLoading]);

  // ── Object statistics → tab counts ────────────────────────────────────────
  // POST /api/statistics/links/json/9  body: [{classId, objectId}]
  // Returns {list: [{objectClass, links}]}
  const getObjectStats = useCallback((classId: number, objectId: number) =>
    withLoading(async () => {
      const res = await fmCall('proxy', {
        path: '/api/statistics/links/json/9',
        method: 'POST',
        body: [{ classId, objectId }],
      });
      if (!res?.success || !res?.data?.list) return [] as Array<{ objectClass: number; links: number }>;
      return res.data.list as Array<{ objectClass: number; links: number }>;
    }), [withLoading]);

  // ── Grid objects for a specific child class ───────────────────────────────
  // Confirmed: POST /api/perspective/metadata/json/9?childClassId=X&offset=0&limit=N
  // Body: [{classId, objectId}]  Response: {children: [...]}
  const getGridObjects = useCallback((
    parentClassId: number, parentObjectId: number,
    childClassId: number, offset = 0, limit = 1000,
  ) =>
    withLoading(async () => {
      const res = await fmCall('proxy', {
        path: `/api/perspective/metadata/json/9?childClassId=${childClassId}&offset=${offset}&limit=${limit}`,
        method: 'POST',
        body: [{ classId: parentClassId, objectId: parentObjectId }],
      });
      if (!res?.success || !res?.data) return [] as GeminusBaseNode[];
      // Response uses 'children' key (confirmed from diagnostics)
      const list = res.data.children ?? res.data.list ?? (Array.isArray(res.data) ? res.data : []);
      return list as GeminusBaseNode[];
    }), [withLoading]);

  // ── Find drawing for an object (infoscope) ────────────────────────────────
  // GET /api/infoscope/contentforobject/{classId}/{objectId}?perspectiveSetId=47
  const getDrawingForObject = useCallback((classId: number, objectId: number, perspectiveSetId = 47) =>
    withLoading(async () => {
      const res = await fmCall('proxy', {
        path: `/api/infoscope/contentforobject/${classId}/${objectId}?perspectiveSetId=${perspectiveSetId}`,
      });
      if (!res?.success || !res?.data?.list?.length) return null;
      const item = res.data.list[0];
      return { drawingId: item.contentId as number, classId: item.classId, objectId: item.objectId };
    }), [withLoading]);

  // ── Load grid data using grid perspective (GPID=9) ────────────────────────
  const getGridData = useCallback((guid: string) =>
    withLoading(async () => {
      const res = await fmCall('get-perspective-tree', { guid, perspectiveId: '9' });
      return res.data as GeminusBaseNode;
    }), [withLoading]);

  const getObject = useCallback((guid: string) =>
    withLoading(async () => {
      const res = await fmCall('get-object-by-guid', { guid });
      return res.data as GeminusBaseNode;
    }), [withLoading]);

  const searchObjects = useCallback((query: string) =>
    withLoading(async () => {
      const res = await fmCall('search-objects', { query });
      return (res.data || []) as GeminusBaseSearchResult[];
    }), [withLoading]);

  const getDrawings = useCallback((buildingId: string) =>
    withLoading(async () => {
      const res = await fmCall('get-drawings', { buildingId });
      return (res.data || []) as GeminusBaseDrawing[];
    }), [withLoading]);

  const getDocuments = useCallback((buildingId: string) =>
    withLoading(async () => {
      const res = await fmCall('get-documents', { buildingId });
      return (res.data || []) as GeminusBaseDocument[];
    }), [withLoading]);

  const getDrawingPdf = useCallback((drawingId: string) =>
    withLoading(async () => {
      const res = await fmCall('get-drawing-pdf', { drawingId });
      return res as { url: string; headers: Record<string, string> };
    }), [withLoading]);

  const getFloors = useCallback((buildingFmGuid: string) =>
    withLoading(async () => {
      const res = await fmCall('get-floors', { buildingFmGuid });
      return (res.data || []) as GeminusBaseNode[];
    }), [withLoading]);

  const createObject = useCallback((parentGuid: string, name: string, classId?: number, properties?: Record<string, any>) =>
    withLoading(async () => {
      const res = await fmCall('create-object', { parentGuid, name, classId, properties });
      toast({ title: 'Objekt skapat', description: name });
      return res.data;
    }), [withLoading, toast]);

  const updateObject = useCallback((guid: string, name?: string, properties?: Record<string, any>) =>
    withLoading(async () => {
      const res = await fmCall('update-object', { guid, name, properties });
      toast({ title: 'Object updated' });
      return res.data;
    }), [withLoading, toast]);

  const deleteObject = useCallback((guid: string) =>
    withLoading(async () => {
      const res = await fmCall('delete-object', { guid });
      toast({ title: 'Objekt raderat' });
      return res.data;
    }), [withLoading, toast]);

  const getRootTree = useCallback(() =>
    withLoading(async () => {
      // ── Phase -1: load Geminus Base tree starting from root ─────────────────
      // Known: "0000 - Kfast" = classId 103, objectId 41854
      // BLM Demo is the parent — try to find it via parent-level class IDs
      try {
        // Try to find BLM Demo (parent of Kfast, classId 103, objectId 41854)
        const parentCandidates = [
          // Parent lookup endpoints
          '/api/perspective/parent/json/8/103/41854',
          '/api/object/parent/json/103/41854',
          '/api/object/path/json/8/103/41854',
          // Try full object info for Kfast — might include parentId
          '/api/object/byguid/json/9dc70023-dc72-49c7-9012-0bcc0ac22f63',
          // Try class 102 (one level above Fastighet) near objectId 41854
          '/api/perspective/json/8/102/41853',
          '/api/perspective/json/8/102/41852',
          '/api/perspective/json/8/102/41856',
          '/api/perspective/json/8/102/1',
          '/api/perspective/json/8/101/1',
          // Search
          '/api/search/quick?query=Demo',
          '/api/search/quick?query=BLM',
          '/api/search/quick?query=BLM+Demo',
        ];

        for (const path of parentCandidates) {
          try {
            const r = await fmCall('proxy', { path });
            if (!r?.success || !r?.data) continue;
            // Check if this looks like a root node (has children including Kfast)
            const node = r.data;
            const children: any[] = Array.isArray(node) ? node
              : node.children ?? node.list ?? (node.hasChildren ? [] : null) ?? [];
            const searchChildren: any[] = node.children ?? [];

            // If it returned a node with Kfast as child, or has children, use as root
            const hasKfast = children.some((c: any) =>
              c.objectId === 41854 || c.objectName?.includes('Kfast'));
            const hasSearchResult = searchChildren.length > 0 &&
              (searchChildren[0]?.objectName?.toLowerCase().includes('demo') ||
               searchChildren[0]?.objectName?.toLowerCase().includes('blm'));

            if (hasKfast || hasSearchResult) {
              const rootNode: GeminusBaseNode = hasSearchResult ? {
                objectName: searchChildren[0].objectName,
                classId: searchChildren[0].classId,
                objectId: searchChildren[0].objectId,
                systemGuid: searchChildren[0].systemGuid,
                children: undefined,
              } : {
                objectName: node.objectName || 'BLM Demo',
                classId: node.classId,
                objectId: node.objectId,
                systemGuid: node.systemGuid,
                children,
              };
              console.log('[GeminusBaseV2] getRootTree found parent root via', path, rootNode.objectName);
              return [rootNode];
            }
          } catch {}
        }

        // BLM Demo is not accessible via API — it's an org-level UI label in Geminus Base.
        // Create it as a synthetic wrapper containing Kfast. Always return this,
        // regardless of whether the Kfast children pre-load succeeds.
        let kfastChildren: GeminusBaseNode[] | undefined;
        try {
          const kfastR = await fmCall('proxy', { path: '/api/perspective/json/8/103/41854' });
          kfastChildren = kfastR?.data?.children ?? undefined;
        } catch { /* kfastChildren stays undefined — lazy-loaded on expand */ }

        const kfastNode: GeminusBaseNode = {
          objectName: '0000 - Kfast',
          classId: 103,
          objectId: 41854,
          systemGuid: '9dc70023-dc72-49c7-9012-0bcc0ac22f63',
          children: kfastChildren,
        };
        const blmDemoRoot: GeminusBaseNode = {
          objectName: 'BLM Demo',
          classId: 102,
          objectId: 0, // synthetic — no real API object
          children: [kfastNode],
        };
        console.log('[GeminusBaseV2] getRootTree: synthetic BLM Demo root, kfastChildren:', kfastChildren?.length ?? 'lazy');
        return [blmDemoRoot];
      } catch {}

      // ── Phase 0: search-based discovery (works in this Geminus Base instance) ─
      // /api/perspective/root is 404; use search API instead.
      // First find root/building objects, then load their subtrees.
      try {
        // Try broad searches to find top-level objects
        const searchTerms = ['Byggnad', 'Building', 'Fastighet', 'Property', 'BLM'];
        const foundGuids = new Map<string, GeminusBaseNode>(); // guid → node

        for (const term of searchTerms) {
          try {
            const r = await fmCall('proxy', { path: `/api/search/quick?query=${encodeURIComponent(term)}` });
            if (!r.success || !r.data) continue;
            const children: any[] = r.data.children ?? [];
            for (const c of children) {
              const guid = c.systemGuid || c.objectGuid || c.guid;
              if (guid && !foundGuids.has(guid)) {
                foundGuids.set(guid, {
                  objectId: c.objectId,
                  objectName: c.objectName || c.name || term,
                  classId: c.classId,
                  className: c.classLabel || c.className,
                  guid,
                  systemGuid: guid,
                  children: undefined,
                } as GeminusBaseNode);
              }
            }
          } catch {}
        }

        if (foundGuids.size > 0) {
          // For each found GUID, load its subtree — the one with most children is the root
          const nodes = Array.from(foundGuids.values());
          const withSubtrees = await Promise.all(nodes.map(async n => {
            try {
              const sub = await fmCall('proxy', {
                path: `/api/perspective/byguid/subtree/json/8/${n.guid}`,
              });
              if (sub.success && sub.data) {
                const subData = sub.data;
                const children: any[] = Array.isArray(subData)
                  ? subData
                  : subData.children ?? subData.Children ?? [];
                if (children.length > 0) {
                  return { ...n, children } as GeminusBaseNode;
                }
              }
            } catch {}
            return n;
          }));

          // Return the node with children if found, otherwise all nodes
          const withKids = withSubtrees.filter(n => n.children && n.children.length > 0);
          const result = withKids.length > 0 ? withKids : withSubtrees;
          console.log('[GeminusBaseV2] getRootTree via search:', result.length, 'root nodes');
          return result;
        }
      } catch (e) {
        console.warn('[GeminusBaseV2] search-based discovery failed:', e);
      }

      // ── Phase 1: read building_settings for Geminus Base GUIDs ──────────────
      // This is fast, uses the anon key, no edge function deploy needed.
      try {
        const { data: settings, error } = await supabase
          .from('building_settings')
          .select('fm_guid, geminus_base_building_guid')
          .not('geminus_base_building_guid', 'is', null);

        if (!error && settings && settings.length > 0) {
          // Load the Geminus Base subtree for each building in parallel
          const results = await Promise.all(
            settings.map(async (s) => {
              const guid = s.geminus_base_building_guid!;
              try {
                const res = await fmCall('get-object-by-guid', { guid });
                if (res?.data) {
                  const obj = res.data;
                  return {
                    objectName: obj.objectName || obj.name || guid,
                    guid,
                    systemGuid: guid,
                    _geminusGuid: s.fm_guid,
                    classId: obj.classId ?? 103,
                    className: obj.className,
                    children: undefined,
                  } as GeminusBaseNode;
                }
              } catch {}
              return null;
            })
          );
          const nodes = results.filter((n): n is GeminusBaseNode => n !== null);
          if (nodes.length > 0) {
            console.log('[GeminusBaseV2] getRootTree: found', nodes.length, 'buildings via building_settings');
            return nodes;
          }
        }
      } catch (e) {
        console.warn('[GeminusBaseV2] building_settings query failed:', e);
      }

      const toNodes = (data: any): GeminusBaseNode[] => {
        if (!data) return [];
        const arr = Array.isArray(data) ? data
          : data.children ?? data.Children ?? data.objects ?? data.results ?? data.items
          ?? (data.objectName ?? data.objectId ? [data] : []);
        return Array.isArray(arr) ? arr : [];
      };

      // ── Phase 1: perspective root variants ───────────────────────────────
      for (const pid of ['8','1','2','3','4','5','6','7','9','10']) {
        try {
          const r = await fmCall('proxy', { path: `/api/perspective/root/json/${pid}` });
          const nodes = toNodes(r.data);
          if (r.success && nodes.length > 0) {
            console.log('[GeminusBaseV2] root via perspective', pid, nodes.length, 'nodes');
            return nodes;
          }
        } catch {}
      }

      // ── Phase 2: class-based object lists ────────────────────────────────
      for (const path of [
        '/api/object/class/json/102',
        '/api/object/class/json/103',
        '/api/objects?classId=102&format=json',
        '/api/objects?classId=103&format=json',
        '/api/object/list/json?classId=102',
        '/api/object/list/json?classId=103',
      ]) {
        try {
          const r = await fmCall('proxy', { path });
          const nodes = toNodes(r.data);
          if (r.success && nodes.length > 0) {
            console.log('[GeminusBaseV2] root via', path, nodes.length, 'nodes');
            return nodes;
          }
        } catch {}
      }

      // ── Phase 3: systeminfo → extract root GUID → load subtree ───────────
      try {
        const info = await fmCall('proxy', { path: '/api/systeminfo/json' });
        if (info.success && info.data) {
          console.log('[GeminusBaseV2] systeminfo:', JSON.stringify(info.data).substring(0, 300));
          // Look for any GUID-like fields that could be a root perspective node
          const str = JSON.stringify(info.data);
          const guids = str.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
          for (const guid of [...new Set(guids)].slice(0, 5)) {
            try {
              const sub = await fmCall('proxy', { path: `/api/perspective/byguid/subtree/json/8/${guid}` });
              const nodes = toNodes(sub.data);
              if (sub.success && nodes.length > 0) {
                console.log('[GeminusBaseV2] root via systeminfo GUID', guid, nodes.length, 'nodes');
                return nodes;
              }
            } catch {}
          }
        }
      } catch {}

      // ── Phase 4: search with empty query ─────────────────────────────────
      try {
        const r = await fmCall('proxy', { path: '/api/search/quick?query=&classId=102' });
        const nodes = toNodes(r.data);
        if (r.success && nodes.length > 0) {
          console.log('[GeminusBaseV2] root via search classId=102', nodes.length, 'nodes');
          return nodes;
        }
      } catch {}

      // ── Phase 5: discover available perspectives ──────────────────────────
      try {
        const r = await fmCall('proxy', { path: '/api/perspectives/json' });
        console.log('[GeminusBaseV2] perspectives:', JSON.stringify(r.data).substring(0, 300));
      } catch {}

      console.warn('[GeminusBaseV2] getRootTree: all endpoints failed — deploy edge function for diagnostics');
      return null;
    }), [withLoading]);

  const testConnection = useCallback(() =>
    withLoading(async () => {
      const res = await fmCall('test-connection');
      toast({ title: 'Anslutning OK', description: res.message });
      return res;
    }), [withLoading, toast]);

  const getViewerUrl = useCallback((params: { buildingId?: string; floorName?: string; geminusBaseBuildingGuid?: string; buildingName?: string }) =>
    withLoading(async () => {
      const res = await fmCall('get-embed-config', params);
      return res as { viewer2dUrl: string; token: string; versionId: string; drawingObjectId?: string };
    }), [withLoading]);

  return {
    loading,
    getHierarchy,
    getSubtree,
    getObject,
    searchObjects,
    getDrawings,
    getDocuments,
    getDrawingPdf,
    getFloors,
    createObject,
    updateObject,
    deleteObject,
    testConnection,
    getViewerUrl,
    getRootTree,
    getGridData,
    getTreeChildren,
    getObjectStats,
    getGridObjects,
    getDrawingForObject,
  };
}
