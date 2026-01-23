import React from "react";
import { ChevronRight, Plus, Eye, Box } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
  onAddChild?: (parentNode: NavigatorNode) => void;
  onView?: (node: NavigatorNode) => void;
  onOpen3D?: (node: NavigatorNode) => void;
};

export function TreeNode({ node, depth = 0, expanded, onToggle, onAddChild, onView, onOpen3D }: Props) {
  const label = node.commonName || node.name || "(namnlös)";
  const hasChildren = Boolean(node.children?.length);
  const isOpen = expanded.has(node.fmGuid);

  // Determine which actions are available based on category
  const canAddChild = node.category === 'Building' || node.category === 'Building Storey';
  const canView = true; // All nodes can be viewed
  const canOpen3D = true; // All nodes can potentially have 3D models

  // Get child count and appropriate label
  const childCount = node.children?.length || 0;
  const getChildLabel = (category: string | undefined, count: number): string => {
    if (count === 0) return "";
    if (category === 'Building') return count === 1 ? "våningsplan" : "våningsplan";
    if (category === 'Building Storey') return count === 1 ? "rum" : "rum";
    return count === 1 ? "objekt" : "objekt";
  };

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-2 rounded-md px-2 py-1.5",
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
            className="h-7 w-7 shrink-0"
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
          <span className="h-7 w-7 shrink-0" />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm text-foreground">{label}</span>
            {childCount > 0 && (
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {childCount} {getChildLabel(node.category, childCount)}
              </span>
            )}
          </div>
        </div>

        {/* Action buttons - visible on hover */}
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {canOpen3D && onOpen3D && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen3D(node);
                  }}
                  className="h-6 w-6"
                  aria-label="Öppna 3D"
                >
                  <Box className="h-3.5 w-3.5 text-primary" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Visa i 3D</TooltipContent>
            </Tooltip>
          )}
          {canView && onView && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    onView(node);
                  }}
                  className="h-6 w-6"
                  aria-label="Visa"
                >
                  <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Visa detaljer</TooltipContent>
            </Tooltip>
          )}
          {canAddChild && onAddChild && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddChild(node);
                  }}
                  className="h-6 w-6"
                  aria-label="Lägg till"
                >
                  <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {node.category === 'Building' ? 'Lägg till våningsplan' : 'Lägg till rum'}
              </TooltipContent>
            </Tooltip>
          )}
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
              onAddChild={onAddChild}
              onView={onView}
              onOpen3D={onOpen3D}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
