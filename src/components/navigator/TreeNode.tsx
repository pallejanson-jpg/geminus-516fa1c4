import React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type NavigatorNode = {
  fmGuid: string;
  category?: string;
  commonName?: string;
  name?: string;
  children?: NavigatorNode[];
  [key: string]: any;
};

type Props = {
  node: NavigatorNode;
  depth?: number;
  expanded: Set<string>;
  onToggle: (fmGuid: string) => void;
};

export function TreeNode({ node, depth = 0, expanded, onToggle }: Props) {
  const label = node.commonName || node.name || "(namnlös)";
  const hasChildren = Boolean(node.children?.length);
  const isOpen = expanded.has(node.fmGuid);

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5",
          "hover:bg-accent/40",
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {hasChildren ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onToggle(node.fmGuid)}
            className="h-7 w-7"
            aria-label={isOpen ? "Fäll ihop" : "Fäll ut"}
          >
            <ChevronRight
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                isOpen && "rotate-90",
              )}
            />
          </Button>
        ) : (
          <span className="h-7 w-7" />
        )}

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-foreground">{label}</div>
          {node.category ? (
            <div className="truncate text-xs text-muted-foreground">{node.category}</div>
          ) : null}
        </div>
      </div>

      {hasChildren && isOpen ? (
        <div className="pl-0">
          {node.children!.map((child) => (
            <TreeNode
              key={child.fmGuid}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
