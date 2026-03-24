import React, { memo } from 'react';
import { ChevronRight, AlertCircle } from 'lucide-react';
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
  onSelect?: (node: NavigatorNode) => void;
}

/**
 * Memoized row component for the virtual tree.
 * Renders a single tree node with proper indentation.
 * Action buttons have been moved to a selection toolbar in NavigatorView.
 */
export const VirtualTreeRow = memo(function VirtualTreeRow({
  flatNode,
  style,
  isSelected,
  onToggle,
  onSelect,
}: VirtualTreeRowProps) {
  const { node, depth, hasChildren, isExpanded } = flatNode;
  const label = node.commonName || node.name || '(unnamed)';
  const childCount = node.children?.length || 0;

  return (
    <div
      style={style}
      className={cn(
        'group flex items-center gap-1 sm:gap-2 rounded-md px-1.5 sm:px-2 cursor-pointer',
        'hover:bg-accent/40 active:bg-accent/60',
        isSelected && 'bg-primary/15 ring-1 ring-primary/40 hover:bg-primary/20'
      )}
      onClick={(e) => {
        // Don't select when clicking expand/collapse
        if ((e.target as HTMLElement).closest('[data-expand-btn]')) return;
        onSelect?.(node);
      }}
    >
      {/* Indentation based on depth */}
      <div style={{ width: Math.max(4, 4 + depth * 10) }} className="shrink-0" />
      
      {/* Expand/Collapse button */}
      {hasChildren ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-expand-btn
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
    </div>
  );
});
