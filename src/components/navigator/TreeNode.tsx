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
  selectedFmGuids?: Set<string>;
};

export function TreeNode({ node, depth = 0, expanded, onToggle, onAddChild, onView, onOpen3D, selectedFmGuids }: Props) {
  const label = node.commonName || node.name || "(unnamed)";
  const hasChildren = Boolean(node.children?.length);
  const isOpen = expanded.has(node.fmGuid);
  const isSelected = selectedFmGuids?.has(node.fmGuid) ?? false;

  // Determine which actions are available based on category
  // Plus button only on Space level (to create objectType 4)
  const canAddChild = node.category === 'Space';
  const canView = true; // All nodes can be viewed
  const canOpen3D = true; // All nodes can potentially have 3D models

  // Get child count and appropriate label
  const childCount = node.children?.length || 0;
  const getChildLabel = (category: string | undefined, count: number): string => {
    if (count === 0) return "";
    if (category === 'Building') return count === 1 ? "floor" : "floors";
    if (category === 'Building Storey') return count === 1 ? "room" : "rooms";
    return count === 1 ? "item" : "items";
  };

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-2 rounded-md px-2 py-1.5",
          "hover:bg-accent/40",
          isSelected && "bg-primary/15 ring-1 ring-primary/40 hover:bg-primary/20",
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
            aria-label={isOpen ? "Collapse" : "Expand"}
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
            <span className={cn(
              "truncate text-sm",
              isSelected ? "font-medium text-primary" : "text-foreground"
            )}>{label}</span>
            {isSelected && (
              <span className="shrink-0 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                AI match
              </span>
            )}
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
                  aria-label="Open 3D"
                >
                  <Box className="h-3.5 w-3.5 text-primary" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">View in 3D</TooltipContent>
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
                  aria-label="View"
                >
                  <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">View details</TooltipContent>
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
                  aria-label="Add"
                >
                  <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Add item</TooltipContent>
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
              selectedFmGuids={selectedFmGuids}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
