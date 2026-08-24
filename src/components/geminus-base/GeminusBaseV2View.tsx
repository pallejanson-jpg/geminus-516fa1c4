/**
 * GeminusBaseV2View — Geminus Base 2.0
 * Uses the proven GeminusBaseTree component with data loaded from Geminus Base API.
 */
import React, { useState, useEffect, useCallback, useRef, useContext, useMemo } from 'react';
import { AppContext } from '@/context/AppContext';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Loader2, ChevronUp, ChevronDown, RefreshCw, ArrowLeft,
  Square, LayoutPanelLeft, Box, SplitSquareHorizontal, Combine, View, BarChart2, Map as MapIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { useGeminusBaseApi, GeminusBaseNode, CLASS_LABELS, NAV_CLASS_IDS, LEAF_CLASS_IDS, dynamicClassLabels, SPOT_CLASS_IDS } from '@/hooks/useGeminusBaseApi';
import { useIsMobile } from '@/hooks/use-mobile';
import GeminusBaseTree from './GeminusBaseTree';
import GeminusBaseV2ViewerPanel, { GeminusBaseV2ViewerHandle } from './GeminusBaseV2ViewerPanel';
import GeminusBaseV2ObjectGrid from './GeminusBaseV2ObjectGrid';
import GeminusBaseLegendPanel, { LegendFilter } from './GeminusBaseLegendPanel';

import { logger } from '@/lib/logger';
// ── Viewer toolbar ────────────────────────────────────────────────────────────
// 2d-fma = FM Access vector drawing (Tessel embedded viewer).
// All other modes render the Geminus UnifiedViewer (/viewer) embedded in an iframe.

type ViewMode = '2d-fma' | '2d' | 'split2d3d' | '3d' | 'split' | 'vt' | '360';

const MODE_DEFS: Array<{ mode: ViewMode; label: string; Icon: React.ComponentType<{ size?: number | string; className?: string }> }> = [
  { mode: '2d-fma', label: '2D-FMA', Icon: MapIcon },
  { mode: '2d', label: '2D', Icon: Square },
  { mode: 'split2d3d', label: '2D/3D', Icon: LayoutPanelLeft },
  { mode: '3d', label: '3D', Icon: Box },
  { mode: 'split', label: '3D/360', Icon: SplitSquareHorizontal },
  { mode: 'vt', label: 'VT', Icon: Combine },
  { mode: '360', label: '360°', Icon: View },
];

interface ViewerToolbarProps {
  viewMode: ViewMode;
  onViewMode: (m: ViewMode) => void;
  /** 2D-FMA only needs the FM Access side (no Geminus building link required) */
  fmaEnabled: boolean;
  /** All other modes embed the Geminus viewer, which needs a real building match */
  geminusEnabled: boolean;
  insightsOpen: boolean;
  onToggleInsights: () => void;
}

const ViewerToolbar: React.FC<ViewerToolbarProps> = ({ viewMode, onViewMode, fmaEnabled, geminusEnabled, insightsOpen, onToggleInsights }) => (
  <div className="flex items-center gap-1 px-3 py-1 border-b border-border bg-card shrink-0">
    {MODE_DEFS.map(({ mode, label, Icon }) => {
      const enabled = mode === '2d-fma' ? fmaEnabled : geminusEnabled;
      return (
        <button
          key={mode}
          disabled={!enabled}
          onClick={() => onViewMode(mode)}
          title={!enabled ? 'This FM Access building isn\'t linked to a Geminus 3D model yet' : undefined}
          className={cn(
            'flex items-center gap-1.5 px-3 py-0.5 text-xs rounded font-medium transition-colors',
            viewMode === mode
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          <Icon size={13} />
          {label}
        </button>
      );
    })}
    <div className="flex-1" />
    <button
      disabled={!geminusEnabled}
      onClick={onToggleInsights}
      title={!geminusEnabled ? 'This FM Access building isn\'t linked to a Geminus 3D model yet' : undefined}
      className={cn(
        'flex items-center gap-1.5 px-3 py-0.5 text-xs rounded font-medium transition-colors',
        insightsOpen
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed',
      )}
    >
      <BarChart2 size={13} />
      Insights
    </button>
  </div>
);

// ── Class tab ─────────────────────────────────────────────────────────────────
interface ClassTab {
  key: string;
  classId: number;
  label: string;
  count: number;
  objects: GeminusBaseNode[];
}

// ── Main component ─────────────────────────────────────────────────────────────
const GeminusBaseV2View: React.FC = () => {
  const isMobile = useIsMobile();
  const { navigatorTreeData, setActiveApp } = useContext(AppContext);
  const {
    getHierarchy, getObjectStats, getGridObjects,
  } = useGeminusBaseApi();

  // Filter tree to navigation-level nodes only (no Ritning, Rum etc.)
  const filterNavTree = useCallback((node: GeminusBaseNode): GeminusBaseNode => ({
    ...node,
    children: node.children
      ?.filter(c => !c.classId || !LEAF_CLASS_IDS.has(c.classId))
      .map(c => filterNavTree(c)),
  }), []);

  // ── Tree state ────────────────────────────────────────────────────────────────
  const [rootNode, setRootNode] = useState<GeminusBaseNode | null>(null);
  const [treeLoading, setTreeLoading] = useState(true);

  // ── Grid / tab state ──────────────────────────────────────────────────────────
  const [selectedNode, setSelectedNode] = useState<GeminusBaseNode | null>(null);
  const [classTabs, setClassTabs] = useState<ClassTab[]>([]);
  const [activeTabKey, setActiveTabKey] = useState('');
  const [gridObjects, setGridObjects] = useState<GeminusBaseNode[]>([]);
  const [gridLoading, setGridLoading] = useState(false);
  const [selectedGridGuid, setSelectedGridGuid] = useState<string | null>(null);
  const [gridCollapsed, setGridCollapsed] = useState(false);

  // ── Viewer ────────────────────────────────────────────────────────────────────
  // viewerBuildingGuid: Geminus fmGuid — only set when the FM Access building has a
  // genuine name match in the Geminus portfolio; drives the embedded Geminus viewer
  // (2D/2D-3D/3D/VT/360/Insights). Demo tenants often have zero real matches, so this
  // must NOT fall back to guessing some other building — that produced "Building not
  // found" (a guessed fmGuid with no matching row) or, worse, silently showed the
  // wrong building's 3D model.
  // viewerGeminusBaseGuid: Geminus Base building systemGuid — the FM Access side, all
  // that 2D-FMA needs (get-embed-config resolves the drawing from this, not from a
  // Geminus fmGuid at all).
  const [viewerBuildingGuid, setViewerBuildingGuid] = useState('');
  const [viewerGeminusBaseGuid, setViewerGeminusBaseGuid] = useState('');
  const [hasGeminusMatch, setHasGeminusMatch] = useState(false);

  // Persist last-used view mode in localStorage (v2 key — the old key used
  // '2d'/'split'/'3d' with different semantics)
  const [viewMode, setViewModeRaw] = useState<ViewMode>(() => {
    const stored = localStorage.getItem('fma_viewMode_v2') as ViewMode | null;
    if (stored && MODE_DEFS.some(d => d.mode === stored)) return stored;
    const legacy = localStorage.getItem('fma_viewMode');
    if (legacy === '3d') return '3d';
    if (legacy === 'split') return 'split2d3d';
    return '2d-fma';
  });

  // The Geminus UnifiedViewer iframe stays mounted once loaded (models are heavy);
  // mode changes are pushed via postMessage instead of remounting.
  const [iframeMounted, setIframeMounted] = useState(viewMode !== '2d-fma');
  const [iframeInitialMode] = useState<ViewMode>(viewMode !== '2d-fma' ? viewMode : '3d');
  const [insightsOpen, setInsightsOpen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const viewModeStateRef = useRef(viewMode);
  const insightsOpenRef = useRef(insightsOpen);
  useEffect(() => { viewModeStateRef.current = viewMode; }, [viewMode]);
  useEffect(() => { insightsOpenRef.current = insightsOpen; }, [insightsOpen]);

  const postToViewer = useCallback((msg: object) => {
    iframeRef.current?.contentWindow?.postMessage(msg, window.location.origin);
  }, []);

  const setViewMode = (m: ViewMode) => {
    localStorage.setItem('fma_viewMode_v2', m);
    setViewModeRaw(m);
    if (m !== '2d-fma') {
      if (!iframeMounted) setIframeMounted(true);
      else postToViewer({ type: 'geminus-viewer-mode', mode: m });
    }
  };

  const handleToggleInsights = () => {
    const open = !insightsOpen;
    setInsightsOpen(open);
    // Insights lives in the embedded Geminus viewer — switch away from the FMA drawing
    if (viewMode === '2d-fma') setViewMode('3d');
    postToViewer({ type: 'geminus-viewer-insights', open });
  };

  // Re-assert current mode + insights once the iframe SPA has booted
  // (postMessages sent before boot are lost)
  const handleIframeLoad = useCallback(() => {
    setTimeout(() => {
      const m = viewModeStateRef.current;
      if (m !== '2d-fma') postToViewer({ type: 'geminus-viewer-mode', mode: m });
      if (insightsOpenRef.current) postToViewer({ type: 'geminus-viewer-insights', open: true });
    }, 1500);
  }, [postToViewer]);

  const iframeSrc = useMemo(() =>
    viewerBuildingGuid
      ? `/viewer?building=${viewerBuildingGuid}&embedded=true&mode=${iframeInitialMode === '2d-fma' ? '3d' : iframeInitialMode}`
      : '',
    [viewerBuildingGuid, iframeInitialMode]);

  const viewerRef = useRef<GeminusBaseV2ViewerHandle>(null);
  const pendingShowRef = useRef<{ classId: number; objectId: number } | null>(null);

  // ── Legend (FM Access presentation API) ─────────────────────────────────────
  const [selectedFloor, setSelectedFloor] = useState<{ classId: number; objectId: number } | null>(null);

  const handleLegendApplied = useCallback((presentationId: number, _filters: LegendFilter[]) => {
    // Ask the embedded Tessel viewer to render the presentation coloring
    viewerRef.current?.postRaw({ type: 'showPresentation', presentationId });
    viewerRef.current?.applyFilter(presentationId);
  }, []);

  const handleLegendCleared = useCallback(() => {
    viewerRef.current?.clearFilter();
  }, []);

  const handleLegendFilterClicked = useCallback((filter: LegendFilter) => {
    // Zoom the viewer to the rooms in this legend bucket
    const first = filter.spotObjects[0];
    if (first && viewerRef.current?.isReady()) {
      viewerRef.current.showObject(String(first.objectId), String(first.classId),
        undefined, { mode: '2D', fitMode: 0, fitMargin: 0.3 });
    }
  }, []);

  // ── Build Geminus Base tree via search ──────────────────────────────────────────
  // The Fastigheter are NOT accessible via Kfast's children in perspective/json.
  // Instead we search for them using Geminus building names, then load their
  // Byggnad/Plan hierarchy.
  const buildTree = useCallback(async () => {
    setTreeLoading(true);
    const sb = (await import('@/integrations/supabase/client')).supabase;

    const proxyGet = async (path: string) => {
      const { data } = await sb.functions.invoke('geminus-base-query', {
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

      // Deduplicate and search Geminus Base for each term
      const fastighetMap = new Map<number, GeminusBaseNode>();
      const byggnadMap = new Map<number, GeminusBaseNode>();

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
          const byggnader: GeminusBaseNode[] = d?.children ?? [];

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
      // (Kfast is a sibling, not a parent — matches Geminus Base tree structure)
      const allChildren = [
        ...fastigheterWithBuildings,
        ...standaloneByggnader,
      ].sort((a, b) => (a.objectName || '').localeCompare(b.objectName || '', 'sv'));

      logger.log('[GeminusBaseV2] buildTree done —', allChildren.length, 'nodes:',
        allChildren.map(f => f.objectName));

      setRootNode({ objectName: 'BLM Demo', classId: 102, objectId: -1, children: allChildren });
    } catch (e) {
      console.error('[GeminusBaseV2] buildTree error:', e);
      toast({
        variant: 'destructive',
        title: 'Could not load Geminus Base tree',
        description: 'The connection to Geminus Base may be down. The tree shown is a fallback, not your real data.',
      });
      setRootNode({ objectName: '0000 - Kfast', classId: 103, objectId: 41854, children: [] });
    } finally {
      setTreeLoading(false);
    }
  }, [navigatorTreeData]);

  useEffect(() => { buildTree(); }, [buildTree]);

  // ── Tree node selected ────────────────────────────────────────────────────────
  const handleNodeSelect = useCallback(async (node: GeminusBaseNode, path: GeminusBaseNode[]) => {
    setSelectedNode(node);
    setSelectedGridGuid(null);
    setClassTabs([]);
    setGridObjects([]);

    // Resolve viewer GUIDs
    const allNodes = [...path, node];
    const byggnad = [...allNodes].reverse().find(n => n.classId === 104);
    const fastighet = [...allNodes].reverse().find(n => n.classId === 103);

    // Legend context: nearest floor (Plan) in the selection path
    const plan = [...allNodes].reverse().find(n => n.classId === 105);
    setSelectedFloor(plan?.objectId ? { classId: 105, objectId: plan.objectId } : null);

    // Geminus Base building systemGuid → used to resolve drawings in get-embed-config
    const geminusBaseGuid = byggnad?.systemGuid || fastighet?.systemGuid || '';
    if (geminusBaseGuid) setViewerGeminusBaseGuid(geminusBaseGuid);

    // Geminus fmGuid — only via a genuine name match. No fallback: a guessed building
    // either doesn't exist (→ "Building not found") or exists but is the WRONG
    // building, silently shown as if it were correct. Neither is acceptable.
    const searchName = (byggnad?.objectName || fastighet?.objectName || '').toLowerCase();
    const geminusMatch = (navigatorTreeData ?? []).find(n =>
      searchName && (n.commonName || n.name || '').toLowerCase().includes(searchName)
    );

    setViewerBuildingGuid(geminusMatch?.fmGuid || '');
    setHasGeminusMatch(!!geminusMatch?.fmGuid);

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
      console.error('[GeminusBaseV2] handleNodeSelect error:', e);
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
  const handleGridSelect = useCallback((node: GeminusBaseNode) => {
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
          <span className="text-sm font-semibold truncate flex-1">Geminus Base 2.0</span>
          <Badge variant="outline" className="text-[10px]">Geminus Base 2.0</Badge>
        </div>
        <ResizablePanelGroup direction="vertical" className="flex-1">
          <ResizablePanel defaultSize={40} minSize={20}>
            <GeminusBaseTree
              rootNode={rootNode}
              loading={treeLoading}
              selectedGuid={selectedGuid}
              onSelect={handleNodeSelect}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={60}>
            {viewerGeminusBaseGuid
              ? <GeminusBaseV2ViewerPanel ref={viewerRef} buildingFmGuid={viewerBuildingGuid || viewerGeminusBaseGuid}
                  geminusBaseBuildingGuid={viewerGeminusBaseGuid || undefined}
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
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border bg-card shrink-0">
        <Button variant="ghost" size="sm" className="h-6 px-2 gap-1.5" onClick={() => setActiveApp('home')}>
          <ArrowLeft size={13} />
          Back
        </Button>
        <div className="h-4 w-px bg-border" />
        <span className="text-sm font-semibold truncate">
          {selectedNode?.objectName || 'Geminus Base 2.0'}
        </span>
        <Badge variant="outline" className="text-[10px]">Geminus Base 2.0</Badge>
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
              <GeminusBaseTree
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
              fmaEnabled={!!viewerGeminusBaseGuid}
              geminusEnabled={hasGeminusMatch}
              insightsOpen={insightsOpen}
              onToggleInsights={handleToggleInsights}
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
                  <GeminusBaseV2ObjectGrid
                    objects={gridObjects}
                    loading={gridLoading}
                    selectedGuid={selectedGridGuid}
                    onSelect={handleGridSelect}
                  />
                </div>
              )}
            </div>

            {/* Viewer — both viewers stay mounted; visibility toggles with mode */}
            <div className="flex-1 overflow-hidden relative">
              {!viewerGeminusBaseGuid ? (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                  Select a building or floor to load the viewer
                </div>
              ) : (
                <>
                  <div className={cn('absolute inset-0 flex', viewMode === '2d-fma' ? 'flex' : 'hidden')}>
                    <div className="flex-1 overflow-hidden">
                      <GeminusBaseV2ViewerPanel ref={viewerRef} buildingFmGuid={viewerBuildingGuid || viewerGeminusBaseGuid}
                        geminusBaseBuildingGuid={viewerGeminusBaseGuid || undefined}
                        onObjectSelected={handleViewerSelection} onReady={handleViewerReady} className="h-full" />
                    </div>
                    <GeminusBaseLegendPanel
                      floorNode={selectedFloor}
                      onPresentationApplied={handleLegendApplied}
                      onCleared={handleLegendCleared}
                      onFilterClicked={handleLegendFilterClicked}
                      className="w-64 border-l border-border bg-card shrink-0"
                    />
                  </div>
                  {/* Geminus-embedded modes need a real building match — the FM Access
                      demo tenant usually has none, so show an honest message instead of
                      a guessed building (silently wrong) or a hard "Building not found". */}
                  {viewMode !== '2d-fma' && !hasGeminusMatch && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background">
                      <p className="text-xs text-muted-foreground max-w-xs text-center px-4">
                        This FM Access building isn't linked to a Geminus 3D model yet.
                        Only the 2D-FMA (native drawing) view is available for it.
                      </p>
                    </div>
                  )}
                  {hasGeminusMatch && iframeMounted && iframeSrc && (
                    <iframe ref={iframeRef} src={iframeSrc} onLoad={handleIframeLoad}
                      className={cn('absolute inset-0 w-full h-full border-0', viewMode !== '2d-fma' ? 'block' : 'hidden')}
                      title="Geminus Viewer" />
                  )}
                </>
              )}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};

export default GeminusBaseV2View;
