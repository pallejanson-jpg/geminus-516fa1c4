import React, { useContext, useMemo, useState, useCallback } from "react";
import { AppContext } from "@/context/AppContext";
import { Input } from "@/components/ui/input";
import { TreeNode, type NavigatorNode } from "@/components/navigator/TreeNode";
import { TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";

function filterTree(nodes: NavigatorNode[], q: string): NavigatorNode[] {
  if (!q.trim()) return nodes;
  const query = q.trim().toLowerCase();

  const matches = (n: NavigatorNode) =>
    (n.commonName || n.name || "").toLowerCase().includes(query);

  const walk = (n: NavigatorNode): NavigatorNode | null => {
    const children = (n.children || []).map(walk).filter(Boolean) as NavigatorNode[];
    if (matches(n) || children.length) return { ...n, children };
    return null;
  };

  return nodes.map(walk).filter(Boolean) as NavigatorNode[];
}

export default function NavigatorView() {
  const { navigatorTreeData, isLoadingData, setActiveApp, setViewer3dFmGuid, setSelectedFacility } = useContext(AppContext);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const visibleTree = useMemo(() => filterTree(navigatorTreeData, query), [navigatorTreeData, query]);

  const onToggle = (fmGuid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(fmGuid)) next.delete(fmGuid);
      else next.add(fmGuid);
      return next;
    });
  };

  const handleAddChild = useCallback((parentNode: NavigatorNode) => {
    // Placeholder - will be implemented when Asset+ write API is available
    // For Space nodes, this creates objectType 4
    toast.info(`Lägg till objekt i "${parentNode.commonName || parentNode.name}"`, {
      description: "Skapar objekttyp 4. Denna funktion kommer snart.",
    });
  }, []);

  const handleView = useCallback((node: NavigatorNode) => {
    // Navigate to Portfolio view for buildings
    if (node.category === 'Building') {
      setSelectedFacility({
        fmGuid: node.fmGuid,
        name: node.name,
        commonName: node.commonName,
        category: node.category,
      });
      setActiveApp('portfolio');
    } else {
      toast.info(`Visa: ${node.commonName || node.name}`, {
        description: `Kategori: ${node.category}`,
      });
    }
  }, [setSelectedFacility, setActiveApp]);

  const handleOpen3D = useCallback((node: NavigatorNode) => {
    // Set the FMGUID and navigate to 3D viewer
    setViewer3dFmGuid(node.fmGuid);
    setActiveApp('viewer');
    toast.success(`Laddar 3D-modell för "${node.commonName || node.name}"`, {
      description: `FMGUID: ${node.fmGuid.substring(0, 8)}...`,
    });
  }, [setViewer3dFmGuid, setActiveApp]);

  return (
    <TooltipProvider>
      <section className="h-full w-full p-4">
        <header className="mb-3">
          <h1 className="text-lg font-semibold text-foreground">Navigator</h1>
        </header>

        <div className="mb-3">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Sök i navigator…"
          />
        </div>

        <div className="rounded-lg border border-border bg-card p-2">
          {isLoadingData ? (
            <div className="p-3 text-sm text-muted-foreground">Laddar data…</div>
          ) : visibleTree.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">
              Inga objekt att visa (kontrollera Asset+-kopplingen eller filter).
            </div>
          ) : (
            <div className="space-y-0.5">
              {visibleTree.map((node) => (
                <TreeNode
                  key={node.fmGuid}
                  node={node}
                  expanded={expanded}
                  onToggle={onToggle}
                  onAddChild={handleAddChild}
                  onView={handleView}
                  onOpen3D={handleOpen3D}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </TooltipProvider>
  );
}
