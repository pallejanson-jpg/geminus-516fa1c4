import React, { memo } from 'react';
import { ChevronRight, Plus, Eye, Box, Square, ClipboardList, AlertCircle, RefreshCw, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { FlatNode } from './virtualTreeUtils';
import type { NavigatorNode } from './TreeNode';

interface VirtualTreeRowProps {
  flatNode: FlatNode;
  style: React.CSSProperties;
  isSelected: boolean;
  onToggle: (fmGuid: string) => void;
  onAddChild?: (node: NavigatorNode) => void;
  onView?: (node: NavigatorNode) => void;
  onOpen3D?: (node: NavigatorNode) => void;
  onOpen2D?: (node: NavigatorNode) => void;
  onInventory?: (node: NavigatorNode) => void;
  onSyncToAssetPlus?: (node: NavigatorNode) => void;
  onCreateWorkOrder?: (node: NavigatorNode) => void;
}

/**
 * Memoized row component for the virtual tree.
 * Renders a single tree node with proper indentation and action buttons.
 */
export const VirtualTreeRow = memo(function VirtualTreeRow({
  flatNode,
  style,
  isSelected,
  onToggle,
  onAddChild,
  onView,
  onOpen3D,
  onOpen2D,
  onInventory,
  onSyncToAssetPlus,
  onCreateWorkOrder,
}: VirtualTreeRowProps) {
  const { node, depth, hasChildren, isExpanded } = flatNode;
  const label = node.commonName || node.name || '(unnamed)';

  // Same logic as TreeNode for which buttons to show
  const canAddChild = node.category === 'Space';
  const canOpen2D = node.category === 'Building Storey';
  const canInventory = ['Building', 'Building Storey', 'Space'].includes(node.category || '');
  const canCreateWorkOrder = ['Building', 'Building Storey', 'Space', 'Instance'].includes(node.category || '');
  const canSyncToAssetPlus = node.category === 'Instance' && node.isLocal === true && node.inRoomFmGuid;
  const childCount = node.children?.length || 0;

  return (
    <div
      style={style}
      className={cn(
        'group flex items-center gap-1 sm:gap-2 rounded-md px-1.5 sm:px-2',
        'hover:bg-accent/40 active:bg-accent/60',
        isSelected && 'bg-primary/15 ring-1 ring-primary/40 hover:bg-primary/20'
      )}
    >
      {/* Indentation based on depth */}
      <div style={{ width: Math.max(4, 4 + depth * 10) }} className="shrink-0" />
      
      {/* Expand/Collapse button */}
      {hasChildren ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onToggle(node.fmGuid)}
          className="h-6 w-6 sm:h-7 sm:w-7 shrink-0"
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
        >
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground transition-transform',
              isExpanded && 'rotate-90'
            )}
          />
        </Button>
      ) : (
        <span className="h-6 w-6 sm:h-7 sm:w-7 shrink-0" />
      )}

      {/* Label and badges */}
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex items-center gap-1 sm:gap-2 min-w-0">
          <span className={cn(
            'truncate text-xs sm:text-sm leading-tight',
            isSelected ? 'font-medium text-primary' : 'text-foreground'
          )}>
            {label}
          </span>
          
          {node.category === 'Instance' && node.createdInModel === false && (
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertCircle className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-amber-500 shrink-0" />
              </TooltipTrigger>
              <TooltipContent side="top">Ej i modell</TooltipContent>
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

      {/* Action buttons */}
      <div className="flex items-center gap-0.5 sm:gap-1 opacity-100 sm:opacity-0 transition-opacity group-hover:opacity-100 shrink-0">
        {canCreateWorkOrder && onCreateWorkOrder && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={(e) => { e.stopPropagation(); onCreateWorkOrder(node); }}
                className="h-6 w-6"
                aria-label="Work Order"
              >
                <Wrench className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-amber-600" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Create Work Order</TooltipContent>
          </Tooltip>
        )}
        {canInventory && onInventory && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={(e) => { e.stopPropagation(); onInventory(node); }}
                className="h-6 w-6"
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
                onClick={(e) => { e.stopPropagation(); onOpen2D(node); }}
                className="h-6 w-6"
                aria-label="2D"
              >
                <Square className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-accent" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">2D</TooltipContent>
          </Tooltip>
        )}
        
        {onOpen3D && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={(e) => { e.stopPropagation(); onOpen3D(node); }}
                className="h-6 w-6"
                aria-label="3D"
              >
                <Box className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-primary" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">3D</TooltipContent>
          </Tooltip>
        )}
        
        <span className="hidden sm:inline-flex">
          {onView && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={(e) => { e.stopPropagation(); onView(node); }}
                  className="h-6 w-6"
                  aria-label="View"
                >
                  <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Detaljer</TooltipContent>
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
                onClick={(e) => { e.stopPropagation(); onAddChild(node); }}
                className="h-6 w-6"
                aria-label="Add"
              >
                <Plus className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-muted-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Lägg till</TooltipContent>
          </Tooltip>
        )}
        
        {canSyncToAssetPlus && onSyncToAssetPlus && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={(e) => { e.stopPropagation(); onSyncToAssetPlus(node); }}
                className="h-6 w-6"
                aria-label="Synka till Asset+"
              >
                <RefreshCw className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-blue-500" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Synka till Asset+</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
});
