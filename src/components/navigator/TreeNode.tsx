import React from "react";
import { ChevronRight, Plus, Eye, Box, Square, ClipboardList, AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { NavigatorNode } from '@/lib/types';

export type { NavigatorNode } from '@/lib/types';

type Props = {
  node: NavigatorNode;
  depth?: number;
  expanded: Set<string>;
  onToggle: (fmGuid: string) => void;
  onAddChild?: (parentNode: NavigatorNode) => void;
  onView?: (node: NavigatorNode) => void;
  onOpen3D?: (node: NavigatorNode) => void;
  onOpen2D?: (node: NavigatorNode) => void;
  onInventory?: (node: NavigatorNode) => void;
  onSyncToAssetPlus?: (node: NavigatorNode) => void;
  selectedFmGuids?: Set<string>;
};

export function TreeNode({ node, depth = 0, expanded, onToggle, onAddChild, onView, onOpen3D, onOpen2D, onInventory, onSyncToAssetPlus, selectedFmGuids }: Props) {
  const label = node.commonName || node.name || "(unnamed)";
  const hasChildren = Boolean(node.children?.length);
  const isOpen = expanded.has(node.fmGuid);
  const isSelected = selectedFmGuids?.has(node.fmGuid) ?? false;

  // Determine which actions are available based on category
  // Plus button only on Space level (to create objectType 4)
  const canAddChild = node.category === 'Space';
  const canView = true; // All nodes can be viewed
  const canOpen3D = true; // All nodes can potentially have 3D models
  const canOpen2D = node.category === 'Building Storey'; // 2D view only for floors
  const canInventory = node.category === 'Building' || node.category === 'Building Storey' || node.category === 'Space';
  // Sync button only for Instance assets that are local (not yet synced) and have a room
  const canSyncToAssetPlus = node.category === 'Instance' && node.isLocal === true && node.inRoomFmGuid;

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
          "group flex items-center gap-1 sm:gap-2 rounded-md px-1.5 sm:px-2 py-1 sm:py-1.5",
          "hover:bg-accent/40 active:bg-accent/60",
          isSelected && "bg-primary/15 ring-1 ring-primary/40 hover:bg-primary/20",
        )}
        style={{ paddingLeft: Math.max(4, 4 + depth * 10) }}
      >
        {hasChildren ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onToggle(node.fmGuid)}
            className="h-6 w-6 sm:h-7 sm:w-7 shrink-0"
            aria-label={isOpen ? "Collapse" : "Expand"}
          >
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground transition-transform",
                isOpen && "rotate-90",
              )}
            />
          </Button>
        ) : (
          <span className="h-6 w-6 sm:h-7 sm:w-7 shrink-0" />
        )}

        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex items-center gap-1 sm:gap-2 min-w-0">
            <span className={cn(
              "truncate text-xs sm:text-sm leading-tight",
              isSelected ? "font-medium text-primary" : "text-foreground"
            )}>{label}</span>
            {/* "Not in model" indicator for Instance nodes */}
            {node.category === 'Instance' && node.createdInModel === false && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertCircle className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-amber-500 shrink-0" />
                </TooltipTrigger>
                <TooltipContent side="top">Not in model</TooltipContent>
              </Tooltip>
            )}
            {isSelected && (
              <span className="hidden sm:inline shrink-0 rounded-full bg-primary/20 px-1 sm:px-1.5 py-0.5 text-[8px] sm:text-[10px] font-medium text-primary">
                AI
              </span>
            )}
            {childCount > 0 && (
              <span className="shrink-0 rounded-full bg-muted px-1 sm:px-1.5 py-0.5 text-[8px] sm:text-[10px] font-medium text-muted-foreground">
                {childCount}
              </span>
            )}
          </div>
        </div>

        {/* Action buttons - visible on hover on desktop, always visible on mobile via tap */}
        <div className="flex items-center gap-0.5 sm:gap-1 opacity-100 sm:opacity-0 transition-opacity group-hover:opacity-100 shrink-0">
          {canInventory && onInventory && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    onInventory(node);
                  }}
                  className="h-6 w-6 sm:h-6 sm:w-6"
                  aria-label="Inventory"
                >
                  <ClipboardList className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-orange-500" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Inventory</TooltipContent>
            </Tooltip>
          )}
          {canOpen2D && onOpen2D && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen2D(node);
                  }}
                  className="h-6 w-6 sm:h-6 sm:w-6"
                  aria-label="2D"
                >
                  <Square className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-accent" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">2D</TooltipContent>
            </Tooltip>
          )}
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
                  className="h-6 w-6 sm:h-6 sm:w-6"
                  aria-label="3D"
                >
                  <Box className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-primary" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">3D</TooltipContent>
            </Tooltip>
          )}
          {/* Hide less important buttons on mobile to save space */}
          <span className="hidden sm:inline-flex">
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
                <TooltipContent side="top">Details</TooltipContent>
              </Tooltip>
            )}
          </span>
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
                  <Plus className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-muted-foreground" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Add</TooltipContent>
            </Tooltip>
          )}
          {canSyncToAssetPlus && onSyncToAssetPlus && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSyncToAssetPlus(node);
                  }}
                  className="h-6 w-6"
                  aria-label="Sync to Asset+"
                >
                  <RefreshCw className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-blue-500" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Sync to Asset+</TooltipContent>
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
              onOpen2D={onOpen2D}
              onInventory={onInventory}
              onSyncToAssetPlus={onSyncToAssetPlus}
              selectedFmGuids={selectedFmGuids}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
