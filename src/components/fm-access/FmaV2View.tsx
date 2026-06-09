/**
 * FmaV2View — FM Access 2.0
 * Uses the proven FmAccessTree component with data loaded from FM Access API.
 */
import React, { useState, useEffect, useCallback, useRef, useContext, useMemo } from 'react';
import { AppContext } from '@/context/AppContext';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, ChevronUp, ChevronDown, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFmAccessApi, FmAccessNode, CLASS_LABELS, NAV_CLASS_IDS, LEAF_CLASS_IDS, dynamicClassLabels, SPOT_CLASS_IDS } from '@/hooks/useFmAccessApi';
import { useIsMobile } from '@/hooks/use-mobile';
import FmAccessTree from './FmAccessTree';
import FmaV2ViewerPanel, { FmaV2ViewerHandle } from './FmaV2ViewerPanel';
import FmaV2ObjectGrid from './FmaV2ObjectGrid';

// ── Viewer toolbar ────────────────────────────────────────────────────────────

type ViewMode = '2d' | '3d' | 'split';

interface ViewerToolbarProps {
  viewMode: ViewMode;
  onViewMode: (m: ViewMode) => void;
  enabled: boolean;
}

const ViewerToolbar: React.FC<ViewerToolbarProps> = ({ viewMode, onViewMode, enabled }) => (
  <div className="flex items-center gap-1 px-3 py-1 border-b border-border bg-card shrink-0">
    {(['2d', 'split', '3d'] as ViewMode[]).map(m => {
      const labels: Record<ViewMode, string> = { '2d': '2D', 'split': '2D + 3D', '3d': '3D' };
      return (
        <button
          key={m}
          disabled={!enabled}
          onClick={() => onViewMode(m)}
          className={cn(
            'px-3 py-0.5 text-xs rounded font-medium transition-colors',
            viewMode === m
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          {labels[m]}
        </button>
      );
    })}
  </div>
);

// ── Class tab ─────────────────────────────────────────────────────────────────
interface ClassTab {
  key: string;
  classId: number;
  label: string;
  count: number;
  objects: FmAccessNode[];
}

// ── Main component ─────────────────────────────────────────────────────────────
const FmaV2View: React.FC = () => {
  const isMobile = useIsMobile();
  const { navigatorTreeData } = useContext(AppContext);
  const {
    getHierarchy, getObjectStats, getGridObjects,
  } = useFmAccessApi();

  // Filter tree to navigation-level nodes only (no Ritning, Rum etc.)
  const filterNavTree = useCallback((node: FmAccessNode): FmAccessNode => ({
    ...node,
    children: node.children
      ?.filter(c => !c.classId || !LEAF_CLASS_IDS.has(c.classId))
      .map(c => filterNavTree(c)),
  }), []);

  // ── Tree state ────────────────────────────────────────────────────────────────
  const [rootNode, setRootNode] = useState<FmAccessNode | null>(null);
  const [treeLoading, setTreeLoading] = useState(true);

  // ── Grid / tab state ──────────────────────────────────────────────────────────
  const [selectedNode, setSelectedNode] = useState<FmAccessNode | null>(null);
  const [classTabs, setClassTabs] = useState<ClassTab[]>([]);
  const [activeTabKey, setActiveTabKey] = useState('');
  const [gridObjects, setGridObjects] = useState<FmAccessNode[]>([]);
  const [gridLoading, setGridLoading] = useState(false);
  const [selectedGridGuid, setSelectedGridGuid] = useState<string | null>(null);
  const [gridCollapsed, setGridCollapsed] = useState(false);

  // ── Viewer ────────────────────────────────────────────────────────────────────
  // viewerBuildingGuid: Geminus fmGuid (for get-embed-config auth)
  // viewerFmaGuid: FM Access building systemGuid (to resolve correct drawing)
  const [viewerBuildingGuid, setViewerBuildingGuid] = useState('');
  const [viewerFmaGuid, setViewerFmaGuid] = useState('');
  const [viewer3dObject, setViewer3dObject] = useState<string>('');

  // Persist last-used view mode in localStorage
  const [viewMode, setViewModeRaw] = useState<'2d' | '3d' | 'split'>(
    () => (localStorage.getItem('fma_viewMode') as any) || '2d'
  );
  const setViewMode = (m: '2d' | '3d' | 'split') => {
    localStorage.setItem('fma_viewMode', m);
    setViewModeRaw(m);
  };
  const viewerRef = useRef<FmaV2ViewerHandle>(null);
  const pendingShowRef = useRef<{ classId: number; objectId: number } | null>(null);

  // ── Build FM Access tree via search ──────────────────────────────────────────
  // The Fastigheter are NOT accessible via Kfast's children in perspective/json.
  // Instead we search for them using Geminus building names, then load their
  // Byggnad/Plan hierarchy.
  const buildTree = useCallback(async () => {
    setTreeLoading(true);
    const sb = (await import('@/integrations/supabase/client')).supabase;

    const proxyGet = async (path: string) => {
      const { data } = await sb.functions.invoke('fm-access-query', {
        body: { action: 'proxy', path },
      });
      return data?.data;
    };

    try {
      // Load class config for proper tab labels
      try {
        const classConfig = await proxyGet('/api/config/classes/json');
        if (classConfig?.list) {
          for (const cls of classConfig.list) {
            // Each class has classId and a label from its labelField
            const id = cls.classId ?? cls.id;
            const label = cls.classLabel ?? cls.label ?? cls.name ?? cls.labelField;
            if (id && label && typeof label === 'string') {
              dynamicClassLabels[id] = label;
            }
          }
        }
      } catch {}

      // Search terms: all known Fastigheter including Kfast itself
      const searchTerms = [
        ...(navigatorTreeData ?? []).map(n => n.commonName || n.name || '').filter(Boolean),
        'Kfast', '2631', '3044', '3272', 'Stockholmshem', 'Centralstationen', 'Småviken',
      ];

      // Deduplicate and search FM Access for each term
      const fastighetMap = new Map<number, FmAccessNode>();
      const byggnadMap = new Map<number, FmAccessNode>();

      await Promise.all([...new Set(searchTerms)].map(async term => {
        try {
          const d = await proxyGet(`/api/search/quick?query=${encodeURIComponent(term)}`);
          const children: any[] = d?.children ?? [];
          for (const c of children) {
            if (c.classId === 103 && c.objectId && !fastighetMap.has(c.objectId)) {
              fastighetMap.set(c.objectId, c);
            } else if (c.classId === 104 && c.objectId && !byggnadMap.has(c.objectId)) {
              byggnadMap.set(c.objectId, c);
            }
          }
        } catch {}
      }));

      // For each found Fastighet, load its Byggnader
      const fastigheterWithBuildings = await Promise.all(
        [...fastighetMap.values()].map(async f => {
          const d = await proxyGet(`/api/perspective/json/8/${f.classId}/${f.objectId}`);
          const byggnader: FmAccessNode[] = d?.children ?? [];

          // For each Byggnad, load its Plan children
          const byggnaderWithPlan = await Promise.all(
            byggnader.map(async b => {
              const bd = await proxyGet(`/api/perspective/json/8/${b.classId}/${b.objectId}`);
              return { ...b, children: bd?.children ?? [] };
            })
          );
          return { ...f, children: byggnaderWithPlan };
        })
      );

      // Also add standalone Byggnader found via search that aren't under a Fastighet
      const fastighetBuildingIds = new Set(
        fastigheterWithBuildings.flatMap(f => (f.children ?? []).map((b: any) => b.objectId))
      );
      const standaloneByggnader = await Promise.all(
        [...byggnadMap.values()]
          .filter(b => !fastighetBuildingIds.has(b.objectId))
          .map(async b => {
            const d = await proxyGet(`/api/perspective/json/8/${b.classId}/${b.objectId}`);
            return { ...b, children: d?.children ?? [] };
          })
      );

      // All Fastigheter + standalone Byggnader are direct children of BLM Demo
      // (Kfast is a sibling, not a parent — matches FM Access tree structure)
      const allChildren = [
        ...fastigheterWithBuildings,
        ...standaloneByggnader,
      ].sort((a, b) => (a.objectName || '').localeCompare(b.objectName || '', 'sv'));

      console.log('[FmaV2] buildTree done —', allChildren.length, 'nodes:',
        allChildren.map(f => f.objectName));

      setRootNode({ objectName: 'BLM Demo', classId: 102, objectId: -1, children: allChildren });
    } catch (e) {
      console.error('[FmaV2] buildTree error:', e);
      setRootNode({ objectName: '0000 - Kfast', classId: 103, objectId: 41854, children: [] });
    } finally {
      setTreeLoading(false);
    }
  }, [navigatorTreeData]);

  useEffect(() => { buildTree(); }, [buildTree]);

  // ── Tree node selected ────────────────────────────────────────────────────────
  const handleNodeSelect = useCallback(async (node: FmAccessNode, path: FmAccessNode[]) => {
    setSelectedNode(node);
    setSelectedGridGuid(null);
    setClassTabs([]);
    setGridObjects([]);

    // Resolve viewer GUIDs
    const allNodes = [...path, node];
    const byggnad = [...allNodes].reverse().find(n => n.classId === 104);
    const fastighet = [...allNodes].reverse().find(n => n.classId === 103);

    // FM Access building systemGuid → used to resolve drawings in get-embed-config
    const fmaGuid = byggnad?.systemGuid || fastighet?.systemGuid || '';
    if (fmaGuid) setViewerFmaGuid(fmaGuid);

    // Geminus fmGuid — try name match first, fall back to first available building
    const searchName = (byggnad?.objectName || fastighet?.objectName || '').toLowerCase();
    const geminusMatch = (navigatorTreeData ?? []).find(n =>
      searchName && (n.commonName || n.name || '').toLowerCase().includes(searchName)
    ) ?? navigatorTreeData?.[0];

    if (geminusMatch?.fmGuid) setViewerBuildingGuid(geminusMatch.fmGuid);
    else if (navigatorTreeData?.[0]?.fmGuid) setViewerBuildingGuid(navigatorTreeData[0].fmGuid);

    // Navigate viewer based on node level
    const showCmd = (): void => {
      const v = viewerRef.current;
      if (!v?.isReady() || !node.classId || !node.objectId) return;
      const oid = String(node.objectId);
      const cid = String(node.classId);
      if (node.classId === 103 || node.classId === 104) {
        // Fastighet / Byggnad → show full building
        v.showMultiObject({ objectId: node.objectId, classId: node.classId }, null,
          undefined, { mode: '2D', fitMode: 0, fitMargin: 0.8 });
      } else if (node.classId === 105) {
        // Plan → show floor cut-out
        v.showObject(oid, cid, undefined, { mode: '2D', fitMode: 0, fitMargin: 0.3 });
      }
    };

    if (node.classId && node.objectId) {
      if (viewerRef.current?.isReady()) {
        showCmd();
        pendingShowRef.current = null;
      } else {
        pendingShowRef.current = { classId: node.classId, objectId: node.objectId };
      }
    }

    // 3D viewer URL param — pass objectId for building-level navigation
    if (node.classId === 104 && node.systemGuid) {
      setViewer3dObject(node.systemGuid);
    }

    const classId = node.classId;
    const objectId = node.objectId;
    if (!classId || !objectId || objectId < 0) return;

    // Load object stats for tabs
    setGridLoading(true);
    try {
      const stats = await getObjectStats(classId, objectId);
      if (stats && stats.length > 0) {
        const tabs: ClassTab[] = stats.map(s => ({
          key: String(s.objectClass),
          classId: s.objectClass,
          label: (dynamicClassLabels[s.objectClass] || CLASS_LABELS[s.objectClass] || `Klass ${s.objectClass}`)
            .replace(/\s*■\s*/g, '').trim() +
            (SPOT_CLASS_IDS.has(s.objectClass) ? ' ■' : ''),
          count: s.links,
          objects: [],
        }));
        setClassTabs(tabs);
        // Auto-select first tab and load its objects
        const firstTab = tabs[0];
        setActiveTabKey(firstTab.key);
        const objects = await getGridObjects(classId, objectId, firstTab.classId);
        setGridObjects(objects ?? []);
      }
    } catch (e) {
      console.error('[FmaV2] handleNodeSelect error:', e);
    } finally {
      setGridLoading(false);
    }
  }, [getObjectStats, getGridObjects, navigatorTreeData]);

  // ── Tab changed → load objects ────────────────────────────────────────────────
  useEffect(() => {
    if (!activeTabKey || !selectedNode?.classId || !selectedNode?.objectId) return;
    const tab = classTabs.find(t => t.key === activeTabKey);
    if (!tab) return;
    if (tab.objects.length > 0) { setGridObjects(tab.objects); return; }

    setGridLoading(true);
    getGridObjects(selectedNode.classId, selectedNode.objectId, tab.classId)
      .then(objects => {
        setGridObjects(objects ?? []);
        tab.objects = objects ?? [];
      })
      .finally(() => setGridLoading(false));
  }, [activeTabKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Grid row selected ─────────────────────────────────────────────────────────
  const handleGridSelect = useCallback((node: FmAccessNode) => {
    const guid = node.guid || node.systemGuid;
    setSelectedGridGuid(guid ?? null);
    // Show selected object/room in viewer — tight zoom
    if (viewerRef.current?.isReady() && node.classId && node.objectId) {
      viewerRef.current.showObject(
        String(node.objectId), String(node.classId),
        undefined, { mode: '2D', fitMode: 0, fitMargin: 0.2 },
      );
    }
  }, []);

  const handleViewerSelection = useCallback((objects: any[]) => {
    if (objects.length > 0) setSelectedGridGuid(objects[0].externalId || objects[0].objectId || null);
  }, []);

  const handleViewerReady = useCallback(() => {
    const v = viewerRef.current;
    if (!v) return;
    const pending = pendingShowRef.current;
    const node = pending ? { classId: pending.classId, objectId: pending.objectId } : selectedNode;
    if (!node?.classId || !node?.objectId) return;
    pendingShowRef.current = null;

    const oid = String(node.objectId);
    const cid = String(node.classId);
    if (node.classId === 103 || node.classId === 104) {
      v.showMultiObject({ objectId: node.objectId, classId: node.classId }, null,
        undefined, { mode: '2D', fitMode: 0, fitMargin: 0.8 });
    } else if (node.classId === 105) {
      v.showObject(oid, cid, undefined, { mode: '2D', fitMode: 0, fitMargin: 0.3 });
    }
  }, [selectedNode]);

  const totalObjects = useMemo(() => classTabs.reduce((s, t) => s + t.count, 0), [classTabs]);
  const selectedGuid = selectedNode?.guid || selectedNode?.systemGuid || null;

  const [showDiagnostics, setShowDiagnostics] = useState(false);

  if (isMobile) {
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card shrink-0">
          <span className="text-sm font-semibold truncate flex-1">FM Access 2.0</span>
          <Badge variant="outline" className="text-[10px]">FMA 2.0</Badge>
        </div>
        <ResizablePanelGroup direction="vertical" className="flex-1">
          <ResizablePanel defaultSize={40} minSize={20}>
            <FmAccessTree
              rootNode={rootNode}
              loading={treeLoading}
              selectedGuid={selectedGuid}
              onSelect={handleNodeSelect}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={60}>
            {viewerBuildingGuid
              ? <FmaV2ViewerPanel ref={viewerRef} buildingFmGuid={viewerBuildingGuid}
                  fmAccessBuildingGuid={viewerFmaGuid || undefined}
                  onObjectSelected={handleViewerSelection} onReady={handleViewerReady} className="h-full" />
              : <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                  Select a node to load the viewer
                </div>
            }
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-card shrink-0">
        <span className="text-sm font-semibold truncate">
          {selectedNode?.objectName || 'FM Access 2.0'}
        </span>
        <Badge variant="outline" className="text-[10px]">FMA 2.0</Badge>
        <div className="flex-1" />
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={buildTree} title="Refresh tree">
          <RefreshCw size={12} className={treeLoading ? 'animate-spin' : ''} />
        </Button>
      </div>

      <ResizablePanelGroup direction="horizontal" className="flex-1 overflow-hidden">
        {/* Left: tree */}
        <ResizablePanel defaultSize={22} minSize={15} maxSize={35}>
          <div className="flex flex-col h-full border-r border-border">
            <div className="px-3 py-1.5 border-b border-border bg-muted/30 shrink-0">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Hierarchy
              </span>
            </div>
            <div className="flex-1 overflow-hidden">
              <FmAccessTree
                rootNode={rootNode}
                loading={treeLoading}
                selectedGuid={selectedGuid}
                onSelect={handleNodeSelect}
              />
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right: tabs + grid + viewer */}
        <ResizablePanel defaultSize={78}>
          <div className="flex flex-col h-full">
            {/* Viewer mode toolbar */}
            <ViewerToolbar
              viewMode={viewMode}
              onViewMode={setViewMode}
              enabled={!!viewerBuildingGuid}
            />

            {/* Grid panel */}
            <div
              className="border-b border-border shrink-0 flex flex-col overflow-hidden transition-all"
              style={{ height: gridCollapsed ? '28px' : '220px' }}
            >
              {/* Tab bar */}
              <div className="flex items-center border-b border-border shrink-0 bg-card min-h-[28px]">
                <div className="flex-1 overflow-x-auto flex items-center gap-0 px-1 py-0.5">
                  {classTabs.length > 0 ? (
                    <>
                      {classTabs.length > 1 && (
                        <button
                          onClick={() => setActiveTabKey('__all__')}
                          className={`px-2.5 py-0.5 text-xs rounded whitespace-nowrap transition-colors ${
                            activeTabKey === '__all__'
                              ? 'bg-primary text-primary-foreground'
                              : 'text-muted-foreground hover:bg-accent'
                          }`}
                        >
                          All ({totalObjects})
                        </button>
                      )}
                      {classTabs.map(tab => (
                        <button
                          key={tab.key}
                          onClick={() => setActiveTabKey(tab.key)}
                          className={`px-2.5 py-0.5 text-xs rounded whitespace-nowrap transition-colors ${
                            activeTabKey === tab.key
                              ? 'bg-primary text-primary-foreground'
                              : 'text-muted-foreground hover:bg-accent'
                          }`}
                        >
                          {tab.label} ({tab.count})
                        </button>
                      ))}
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground px-2">
                      {gridLoading
                        ? <span className="flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Loading…</span>
                        : 'Select a node in the tree'
                      }
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setGridCollapsed(c => !c)}
                  className="px-2 h-full text-muted-foreground hover:text-foreground shrink-0"
                >
                  {gridCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
                </button>
              </div>

              {!gridCollapsed && (
                <div className="flex-1 overflow-hidden">
                  <FmaV2ObjectGrid
                    objects={gridObjects}
                    loading={gridLoading}
                    selectedGuid={selectedGridGuid}
                    onSelect={handleGridSelect}
                  />
                </div>
              )}
            </div>

            {/* Viewer */}
            <div className="flex-1 overflow-hidden">
              {!viewerBuildingGuid ? (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                  Select a building or floor to load the viewer
                </div>
              ) : viewMode === '2d' ? (
                <FmaV2ViewerPanel ref={viewerRef} buildingFmGuid={viewerBuildingGuid}
                  fmAccessBuildingGuid={viewerFmaGuid || undefined}
                  onObjectSelected={handleViewerSelection} onReady={handleViewerReady} className="h-full" />
              ) : viewMode === '3d' ? (
                <iframe src={`/viewer?building=${viewerBuildingGuid}${viewer3dObject ? `&fmGuid=${viewer3dObject}` : ''}`}
                  className="w-full h-full border-0" title="3D Viewer" />
              ) : (
                <div className="flex h-full">
                  <div className="flex-1 border-r border-border overflow-hidden">
                    <FmaV2ViewerPanel ref={viewerRef} buildingFmGuid={viewerBuildingGuid}
                      fmAccessBuildingGuid={viewerFmaGuid || undefined}
                      onObjectSelected={handleViewerSelection} onReady={handleViewerReady} className="h-full" />
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <iframe src={`/viewer?building=${viewerBuildingGuid}`}
                      className="w-full h-full border-0" title="3D Viewer" />
                  </div>
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};

export default FmaV2View;
