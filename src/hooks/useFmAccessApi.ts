import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

// ── Types ──────────────────────────────────────────────────────────

export interface FmAccessNode {
  objectId?: number;
  objectName?: string;
  name?: string;
  classId?: number;
  className?: string;
  guid?: string;
  systemGuid?: string;
  children?: FmAccessNode[];
  properties?: Record<string, any>;
  [key: string]: any;
}

export interface FmAccessSearchResult {
  objectId?: number;
  objectName?: string;
  className?: string;
  guid?: string;
  [key: string]: any;
}

export interface FmAccessDrawing {
  drawingId?: number;
  objectId?: number;
  name?: string;
  objectName?: string;
  [key: string]: any;
}

export interface FmAccessDocument {
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
  103: 'Byggnad',
  105: 'Plan',
  106: 'Ritning',
  107: 'Rum',
};

// ── Hook ───────────────────────────────────────────────────────────

async function fmCall(action: string, params: Record<string, any> = {}) {
  const { data, error } = await supabase.functions.invoke('fm-access-query', {
    body: { action, ...params },
  });
  if (error) throw new Error(error.message || `FM Access call failed: ${action}`);
  if (!data?.success) throw new Error(data?.error || `FM Access ${action} failed`);
  return data;
}

export function useFmAccessApi() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const withLoading = useCallback(async <T>(fn: () => Promise<T>): Promise<T | null> => {
    setLoading(true);
    try {
      return await fn();
    } catch (err: any) {
      toast({ title: 'FM Access Error', description: err.message, variant: 'destructive' });
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
      return res.data as FmAccessNode | FmAccessNode[];
    }), [withLoading]);

  const getSubtree = useCallback((guid: string, perspectiveId = '8') =>
    withLoading(async () => {
      const res = await fmCall('get-perspective-tree', { guid, perspectiveId });
      return res.data as FmAccessNode;
    }), [withLoading]);

  const getObject = useCallback((guid: string) =>
    withLoading(async () => {
      const res = await fmCall('get-object-by-guid', { guid });
      return res.data as FmAccessNode;
    }), [withLoading]);

  const searchObjects = useCallback((query: string) =>
    withLoading(async () => {
      const res = await fmCall('search-objects', { query });
      return (res.data || []) as FmAccessSearchResult[];
    }), [withLoading]);

  const getDrawings = useCallback((buildingId: string) =>
    withLoading(async () => {
      const res = await fmCall('get-drawings', { buildingId });
      return (res.data || []) as FmAccessDrawing[];
    }), [withLoading]);

  const getDocuments = useCallback((buildingId: string) =>
    withLoading(async () => {
      const res = await fmCall('get-documents', { buildingId });
      return (res.data || []) as FmAccessDocument[];
    }), [withLoading]);

  const getDrawingPdf = useCallback((drawingId: string) =>
    withLoading(async () => {
      const res = await fmCall('get-drawing-pdf', { drawingId });
      return res as { url: string; headers: Record<string, string> };
    }), [withLoading]);

  const getFloors = useCallback((buildingFmGuid: string) =>
    withLoading(async () => {
      const res = await fmCall('get-floors', { buildingFmGuid });
      return (res.data || []) as FmAccessNode[];
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

  const testConnection = useCallback(() =>
    withLoading(async () => {
      const res = await fmCall('test-connection');
      toast({ title: 'Anslutning OK', description: res.message });
      return res;
    }), [withLoading, toast]);

  const getViewerUrl = useCallback((params: { buildingId?: string; floorName?: string; fmAccessBuildingGuid?: string; buildingName?: string }) =>
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
  };
}
