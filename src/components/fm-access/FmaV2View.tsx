/**
 * FmaV2View — FM Access 2.0 native Geminus layout.
 *
 * Tree strategy (hybrid):
 *   Root nodes  = Geminus buildings (from allData, already loaded)
 *   Child nodes = FM Access subtree loaded on first expand (classId 103/105/107…)
 *
 * This avoids calling /api/perspective/root which returns 404 for perspective 8.
 * Each building node is expanded lazily by calling get-hierarchy with its fmGuid.
 *
 * Right panel:
 *   Tab bar  — object classes for selected floor (dynamic, from getSubtree)
 *   Grid     — objects of selected class tab
 *   Viewer   — EmbeddedViewer iframe (postMessage EmbeddedAPI)
 */
import React, {
  useState, useCallback, useMemo, useRef, useContext, useEffect,
} from 'react';
import { AppContext } from '@/context/AppContext';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ChevronRight, ChevronDown, Building2, Layers, DoorOpen, Box, Loader2,
  ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFmAccessApi, FmAccessNode, CLASS_LABELS, NAV_CLASS_IDS } from '@/hooks/useFmAccessApi';
import { useIsMobile } from '@/hooks/use-mobile';
import FmaV2ViewerPanel, { FmaV2ViewerHandle } from './FmaV2ViewerPanel';
import FmaV2ObjectGrid from './FmaV2ObjectGrid';
import FmaV2Diagnostics from './FmaV2Diagnostics';

// ── Class tab helpers ──────────────────────────────────────────────────────────

interface ClassTab {
  key: string;
  classId: number;   // integer classId for API calls
  label: string;
  count: number;
  objects: FmAccessNode[];
}

function buildClassTabsFromStats(
  stats: Array<{ objectClass: number; links: number }>,
): ClassTab[] {
  return stats.map(s => ({
    key: String(s.objectClass),
    classId: s.objectClass,
    label: CLASS_LABELS[s.objectClass] || `Klass ${s.objectClass}`,
    count: s.links,
    objects: [],
  }));
}

function buildClassTabs(nodes: FmAccessNode[]): ClassTab[] {
  const map = new Map<string, ClassTab>();
  for (const node of nodes) {
    const cid = node.classId ?? 0;
    const key = String(cid);
    const label = CLASS_LABELS[cid] || node.className || key;
    const existing = map.get(key);
    if (existing) { existing.count++; existing.objects.push(node); }
    else map.set(key, { key, classId: cid, label, count: 1, objects: [node] });
  }
  return Array.from(map.values());
}

function nodeLabel(n: FmAccessNode | Facility): string {
  return (n as FmAccessNode).objectName
    || (n as Facility).commonName
    || (n as Facility).name
    || String((n as FmAccessNode).objectId ?? '–');
}

const CLASS_ICONS: Record<number, React.ElementType> = {
  102: Building2, 103: Building2, 105: Layers, 106: Layers, 107: DoorOpen,
};

// ── Lazy tree node ─────────────────────────────────────────────────────────────

interface LazyNodeProps {
  node: FmAccessNode;
  depth: number;
  selectedGuid: string | null;
  loadChildren: (node: FmAccessNode) => Promise<FmAccessNode[]>;
  onSelect: (node: FmAccessNode, path: FmAccessNode[]) => void;
  path: FmAccessNode[];
}

const LazyTreeNode: React.FC<LazyNodeProps> = ({
  node, depth, selectedGuid, loadChildren, onSelect, path,
}) => {
  // Auto-expand first two levels (BLM Demo + Kfast)
  const autoExpand = node.objectId === 0 || depth <= 1;
  const [expanded, setExpanded] = useState(autoExpand);
  const [children, setChildren] = useState<FmAccessNode[] | null>(
    node.children?.length ? node.children : null,
  );
  const [loading, setLoading] = useState(false);

  // Auto-load children when expanded but not yet loaded
  useEffect(() => {
    if (!expanded || children !== null || loading) return;
    setLoading(true);
    loadChildren(node).then(loaded => {
      setChildren(loaded);
      setLoading(false);
    });
  }, [expanded]); // eslint-disable-line react-hooks/exhaustive-deps

  const nodeGuid = node.guid || node.systemGuid || String(node.objectId ?? '');
  const isSelected = nodeGuid === selectedGuid;
  const Icon = CLASS_ICONS[node.classId ?? 0] ?? Box;
  const label = nodeLabel(node);
  const classLabel = (node.classId && CLASS_LABELS[node.classId]) ? CLASS_LABELS[node.classId] : undefined;

  const hasChildren = children !== null ? children.length > 0 : true; // unknown = assume expandable

  const toggle = () => setExpanded(e => !e);

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-0 hover:bg-accent/50 rounded-md transition-colors cursor-pointer',
          isSelected && 'bg-accent text-accent-foreground',
        )}
        style={{ paddingLeft: `${depth * 14}px` }}
      >
        {/* Expand toggle — separate from select */}
        <button
          className="flex items-center justify-center w-6 h-6 shrink-0 text-muted-foreground"
          onClick={e => { e.stopPropagation(); toggle(); }}
          tabIndex={-1}
        >
          {loading
            ? <Loader2 size={12} className="animate-spin" />
            : hasChildren
              ? expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
              : null
          }
        </button>

        {/* Node label — click selects without toggling */}
        <button
          className="flex items-center gap-1.5 flex-1 py-1 pr-2 text-left min-w-0"
          onClick={() => { onSelect(node, path); toggle(); }}
        >
          <Icon size={13} className="shrink-0 text-primary" />
          <span className="truncate text-xs flex-1">{label}</span>
          {classLabel && (
            <span className="text-[10px] text-muted-foreground shrink-0">{classLabel}</span>
          )}
        </button>
      </div>

      {expanded && children && children.length > 0 && (
        <div>
          {children.map((child, i) => (
            <LazyTreeNode
              key={`${child.objectId ?? child.systemGuid ?? i}`}
              node={child}
              depth={depth + 1}
              selectedGuid={selectedGuid}
              loadChildren={loadChildren}
              onSelect={onSelect}
              path={[...path, node]}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ── Main view ─────────────────────────────────────────────────────────────────

const FmaV2View: React.FC = () => {
  const isMobile = useIsMobile();
  const { navigatorTreeData } = useContext(AppContext);
  const { getSubtree, getRootTree, getObject, getTreeChildren, getObjectStats, getGridObjects } = useFmAccessApi();

  // Selection
  const [selectedNode, setSelectedNode] = useState<FmAccessNode | null>(null);

  // Tabs + grid
  const [classTabs, setClassTabs] = useState<ClassTab[]>([]);
  const [activeTabKey, setActiveTabKey] = useState('__all__');
  const [gridLoading, setGridLoading] = useState(false);
  const [selectedGridGuid, setSelectedGridGuid] = useState<string | null>(null);

  // Viewer
  const [viewerBuildingGuid, setViewerBuildingGuid] = useState('');
  const [gridCollapsed, setGridCollapsed] = useState(false);

  const viewerRef = useRef<FmaV2ViewerHandle>(null);

  // ── Load root directly from FM Access ────────────────────────────────────
  // Tries several FM Access endpoints until one returns nodes.
  // Falls back to Geminus navigatorTreeData if all FM Access endpoints fail.
  const [rootNodes, setRootNodes] = useState<FmAccessNode[]>([]);
  const [validating, setValidating] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const loadFmaRoot = useCallback(async () => {
    setValidating(true);

    // 1. Try FM Access root endpoints (perspective, class lists, etc.)
    const fmaNodes = await getRootTree();
    if (fmaNodes && fmaNodes.length > 0) {
      // Filter root to only show navigational nodes
      const navRoots = filterNavNodes(fmaNodes);
      setRootNodes(navRoots.length > 0 ? navRoots : fmaNodes); // fallback to unfiltered if all filtered out
      setValidating(false);
      return;
    }

    // 2. FM Access root unavailable → validate Geminus buildings individually.
    //    Uses fmGuid directly as FM Access GUID (same approach as old FmAccessNativeView).
    //    Display name comes from Geminus so it's always human-readable.
    const candidates = navigatorTreeData ?? [];
    if (!candidates.length) { setRootNodes([]); setValidating(false); return; }

    const results = await Promise.all(
      candidates.map(async n => {
        try {
          const obj = await getObject(n.fmGuid);
          if (!obj) return null;
          return {
            // Use Geminus name — FM Access objectName is often just the class label
            objectName: n.commonName || n.name || obj.objectName || n.fmGuid,
            guid: n.fmGuid,
            systemGuid: n.fmGuid,
            classId: obj.classId ?? 103,
            children: undefined,
          } as FmAccessNode;
        } catch { return null; }
      })
    );

    const validated = results.filter((r): r is FmAccessNode => r !== null);
    console.log(`[FmaV2] validated ${validated.length}/${candidates.length} buildings against FM Access`);
    setRootNodes(validated);
    setValidating(false);
  }, [getRootTree, getObject, navigatorTreeData]);

  useEffect(() => { loadFmaRoot(); }, [navigatorTreeData]);

  // ── Filter a node list to only navigation-level classes ──────────────────
  const filterNavNodes = useCallback((nodes: FmAccessNode[]): FmAccessNode[] =>
    nodes
      .filter(n => {
        if (!n.classId) return true; // unknown class — keep (might be structural)
        return NAV_CLASS_IDS.has(n.classId); // keep only Fastighet/Byggnad/Plan
      })
      .map(n => ({
        ...n,
        // Recursively filter children too
        children: n.children ? filterNavNodes(n.children) : n.children,
      })),
  []);

  // ── Lazy child loader — uses correct FM Access endpoint ──────────────────
  // FM Access tree uses: GET /api/perspective/json/8/{classId}/{objectId}
  // NOT the GUID-based /subtree endpoint we were using before.
  const loadChildren = useCallback(async (node: FmAccessNode): Promise<FmAccessNode[]> => {
    // Synthetic nodes (objectId=0) have pre-loaded children — no API call needed
    if (node.objectId === 0 && node.children) return filterNavNodes(node.children);

    const classId = node.classId;
    const objectId = node.objectId;

    // Primary: integer-ID endpoint (confirmed from FM Access network capture)
    if (classId && objectId) {
      const result = await getTreeChildren(classId, objectId);
      if (result) {
        const children: FmAccessNode[] = Array.isArray(result)
          ? result
          : result.children ?? [];
        if (children.length > 0) return filterNavNodes(children);
      }
    }

    // Fallback: GUID-based subtree
    const guid = node.guid || node.systemGuid;
    if (!guid) return [];
    const data = await getSubtree(guid);
    if (!data) return [];
    const raw: FmAccessNode[] = Array.isArray(data) ? data : data.children ?? [];
    return filterNavNodes(raw);
  }, [getTreeChildren, getSubtree, filterNavNodes]);

  // ── Resolve building GUID from selected node + path ───────────────────────
  function resolveBuildingGuid(node: FmAccessNode, path: FmAccessNode[]): string {
    // Prefer _geminusGuid stored on root building node (used by get-embed-config)
    const rootNode = path[0] ?? node;
    if ((rootNode as any)._geminusGuid) return (rootNode as any)._geminusGuid;
    // Walk backwards for Byggnad/Fastighet
    for (const n of [...path, node].reverse()) {
      if (n.classId === 103 || n.classId === 102) {
        return (n as any)._geminusGuid || n.guid || n.systemGuid || String(n.objectId ?? '');
      }
    }
    return rootNode.guid || rootNode.systemGuid || String(rootNode.objectId ?? '');
  }

  // ── Tree node selected ─────────────────────────────────────────────────────
  const handleNodeSelect = useCallback(async (node: FmAccessNode, path: FmAccessNode[]) => {
    setSelectedNode(node);
    setSelectedGridGuid(null);
    setActiveTabKey('__all__');

    const bGuid = resolveBuildingGuid(node, path);
    if (bGuid) setViewerBuildingGuid(bGuid);

    // Show in viewer
    const nodeGuid = node.guid || node.systemGuid;
    const nodeObjectId = node.objectId ? String(node.objectId) : nodeGuid;
    const nodeClassId = node.classId ? String(node.classId) : node.className || '';
    if (viewerRef.current?.isReady() && nodeObjectId && nodeClassId) {
      viewerRef.current.showMultiObject(
        { objectId: nodeObjectId, classId: nodeClassId }, null, undefined,
        { mode: '2D', fitMode: 0 },
      );
    }

    const classId = node.classId;
    const objectId = node.objectId;

    if (!nodeGuid && (!classId || !objectId)) { setClassTabs([]); return; }

    setGridLoading(true);

    // Use confirmed statistics endpoint to get tab counts
    if (classId && objectId) {
      const stats = await getObjectStats(classId, objectId);
      if (stats && stats.length > 0) {
        const tabs = buildClassTabsFromStats(stats);
        setClassTabs(tabs);
        setGridLoading(false);
        return;
      }
    }

    // Fallback: load subtree and group by class
    if (nodeGuid) {
      const subtree = await getSubtree(nodeGuid);
      const rawChildren: FmAccessNode[] = subtree
        ? (Array.isArray(subtree) ? subtree : subtree.children ?? [])
        : [];
      setClassTabs(rawChildren.length > 0 ? buildClassTabs(rawChildren) : []);
    } else {
      setClassTabs([]);
    }
    setGridLoading(false);
  }, [getSubtree]);

  // ── Grid row → viewer ─────────────────────────────────────────────────────
  const handleGridSelect = useCallback((node: FmAccessNode) => {
    const guid = node.guid || node.systemGuid;
    setSelectedGridGuid(guid || null);
    if (!viewerRef.current?.isReady()) return;
    const objectId = node.objectId ? String(node.objectId) : guid || '';
    const classId = node.classId ? String(node.classId) : node.className || '';
    if (objectId && classId) {
      viewerRef.current.showObject(objectId, classId, undefined, { mode: '2D', fitMode: 0 });
    }
  }, []);

  // ── Viewer selection → sync grid ──────────────────────────────────────────
  const handleViewerSelection = useCallback((objects: any[]) => {
    if (objects.length > 0) setSelectedGridGuid(objects[0].externalId || objects[0].objectId || null);
  }, []);

  const handleViewerReady = useCallback(() => {
    if (!selectedNode || !viewerRef.current) return;
    const guid = selectedNode.guid || selectedNode.systemGuid;
    const objectId = selectedNode.objectId ? String(selectedNode.objectId) : guid || '';
    const classId = selectedNode.classId ? String(selectedNode.classId) : selectedNode.className || '';
    if (objectId && classId) {
      viewerRef.current.showMultiObject({ objectId, classId }, null, undefined, { mode: '2D' });
    }
  }, [selectedNode]);

  // ── Load grid objects when tab changes ────────────────────────────────────
  const [gridObjects, setGridObjects] = useState<FmAccessNode[]>([]);

  useEffect(() => {
    if (!selectedNode?.classId || !selectedNode?.objectId) {
      setGridObjects(classTabs.flatMap(t => t.objects));
      return;
    }
    const tab = classTabs.find(t => t.key === activeTabKey);
    if (!tab) { setGridObjects([]); return; }

    // If objects already loaded in tab, use them
    if (tab.objects.length > 0) { setGridObjects(tab.objects); return; }

    // Load from FM Access grid endpoint
    setGridLoading(true);
    getGridObjects(selectedNode.classId, selectedNode.objectId, tab.classId)
      .then(objects => {
        setGridObjects(objects ?? []);
        // Cache in tab
        tab.objects = objects ?? [];
        setGridLoading(false);
      });
  }, [activeTabKey, classTabs, selectedNode]);

  const totalObjects = useMemo(() => classTabs.reduce((s, t) => s + t.count, 0), [classTabs]);

  const selectedGuid = selectedNode?.guid || selectedNode?.systemGuid || null;

  // ── Tab bar ────────────────────────────────────────────────────────────────
  const TabBar = () => (
    <div className="flex items-center gap-0 px-1 py-0.5 overflow-x-auto">
      {classTabs.length > 1 && (
        <button
          onClick={() => setActiveTabKey('__all__')}
          className={cn(
            'flex items-center gap-0.5 px-2.5 py-1 text-xs font-medium rounded whitespace-nowrap transition-colors',
            activeTabKey === '__all__'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          All <span className="opacity-60">({totalObjects})</span>
        </button>
      )}
      {classTabs.map(tab => (
        <button
          key={tab.key}
          onClick={() => setActiveTabKey(tab.key)}
          className={cn(
            'flex items-center gap-0.5 px-2.5 py-1 text-xs font-medium rounded whitespace-nowrap transition-colors',
            activeTabKey === tab.key
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {tab.label} <span className="opacity-60">({tab.count})</span>
        </button>
      ))}
    </div>
  );

  // ── Tree panel JSX (inlined — avoids React unmount/remount on re-render) ──
  const treePanelJsx = (
    <div className="flex flex-col h-full border-r border-border">
      <div className="px-3 py-1.5 border-b border-border bg-muted/30 shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Hierarchy
        </span>
      </div>
      {validating ? (
        <div className="flex items-center justify-center flex-1 gap-2 text-xs text-muted-foreground">
          <Loader2 size={13} className="animate-spin" /> Loading FM Access…
        </div>
      ) : rootNodes.length === 0 ? (
        <div className="flex items-center justify-center flex-1 text-xs text-muted-foreground p-4 text-center">
          No buildings found in FM Access.
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="py-1">
            {rootNodes.map((node, i) => (
              <LazyTreeNode
                key={`tree-${node.objectId ?? i}-${node.systemGuid ?? i}`}
                node={node}
                depth={0}
                selectedGuid={selectedGuid}
                loadChildren={loadChildren}
                onSelect={handleNodeSelect}
                path={[]}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );

  // ── Viewer placeholder ─────────────────────────────────────────────────────
  const viewerPlaceholderJsx = (
    <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
      Select a building or floor to load the viewer
    </div>
  );

  // ── Mobile ─────────────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card shrink-0">
          <Building2 size={15} className="text-primary" />
          <span className="text-sm font-semibold truncate flex-1">
            {selectedNode ? nodeLabel(selectedNode) : 'FM Access 2.0'}
          </span>
          <Badge variant="outline" className="text-[10px]">FMA 2.0</Badge>
        </div>
        <ResizablePanelGroup direction="vertical" className="flex-1">
          <ResizablePanel defaultSize={35} minSize={20}>{treePanelJsx}</ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={65}>
            {viewerBuildingGuid
              ? <FmaV2ViewerPanel ref={viewerRef} buildingFmGuid={viewerBuildingGuid}
                  onObjectSelected={handleViewerSelection} onReady={handleViewerReady} className="h-full" />
              : viewerPlaceholderJsx}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    );
  }

  // ── Desktop ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-card shrink-0">
        <Building2 size={15} className="text-primary" />
        <span className="text-sm font-semibold truncate">
          {selectedNode ? nodeLabel(selectedNode) : 'FM Access 2.0'}
        </span>
        <Badge variant="outline" className="text-[10px]">FMA 2.0</Badge>
        <div className="flex-1" />
        <Button
          variant={showDiagnostics ? 'secondary' : 'ghost'}
          size="sm"
          className="text-xs h-6 px-2"
          onClick={() => setShowDiagnostics(d => !d)}
        >
          {showDiagnostics ? 'Stäng diagnostik' : '🔧 Diagnostik'}
        </Button>
      </div>

      {showDiagnostics ? (
        <div className="flex-1 overflow-hidden">
          <FmaV2Diagnostics />
        </div>
      ) : (
        <>
          {/* Body */}
          <ResizablePanelGroup direction="horizontal" className="flex-1 overflow-hidden">
        {/* Left: tree */}
        <ResizablePanel defaultSize={22} minSize={15} maxSize={35}>
          {treePanelJsx}
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right: tabs + grid + viewer */}
        <ResizablePanel defaultSize={78}>
          <div className="flex flex-col h-full">

            {/* Grid panel (collapsible) */}
            <div
              className="border-b border-border shrink-0 flex flex-col overflow-hidden transition-all duration-200"
              style={{ height: gridCollapsed ? '28px' : '220px' }}
            >
              {/* Tab + collapse row */}
              <div className="flex items-center border-b border-border shrink-0 bg-card min-h-[28px]">
                <div className="flex-1 overflow-x-auto">
                  {classTabs.length > 0
                    ? <TabBar />
                    : (
                      <div className="px-3 py-1 text-xs text-muted-foreground">
                        {gridLoading
                          ? <span className="flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Loading…</span>
                          : 'Select a floor or building node'}
                      </div>
                    )
                  }
                </div>
                <button
                  onClick={() => setGridCollapsed(c => !c)}
                  className="px-2 h-full text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  title={gridCollapsed ? 'Expand grid' : 'Collapse grid'}
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
              {viewerBuildingGuid
                ? <FmaV2ViewerPanel ref={viewerRef} buildingFmGuid={viewerBuildingGuid}
                    onObjectSelected={handleViewerSelection} onReady={handleViewerReady} className="h-full" />
                : viewerPlaceholderJsx}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
        </>
      )}
    </div>
  );
};

export default FmaV2View;
