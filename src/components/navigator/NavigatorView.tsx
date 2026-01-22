import React, { useContext, useMemo, useState } from "react";
import { AppContext } from "@/context/AppContext";
import { Input } from "@/components/ui/input";
import { TreeNode, type NavigatorNode } from "@/components/navigator/TreeNode";

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
  const { navigatorTreeData, isLoadingData } = useContext(AppContext);
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

  return (
    <section className="h-full w-full p-4">
      <header className="mb-3">
        <h1 className="text-lg font-semibold text-foreground">Navigator</h1>
        <p className="text-sm text-muted-foreground">Byggnad → Våningsplan → Rum → Dörr</p>
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
              <TreeNode key={node.fmGuid} node={node} expanded={expanded} onToggle={onToggle} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
