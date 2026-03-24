import React, { useRef, useMemo, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { flattenVisibleTree, buildFmGuidToIndexMap } from './virtualTreeUtils';
import { VirtualTreeRow } from './VirtualTreeRow';
import type { NavigatorNode } from './TreeNode';

interface VirtualTreeProps {
  nodes: NavigatorNode[];
  expanded: Set<string>;
  selectedFmGuids?: Set<string>;
  scrollToFmGuid?: string | null;
  selectedNodeFmGuid?: string | null;
  onToggle: (fmGuid: string) => void;
  onSelect?: (node: NavigatorNode) => void;
}

const ROW_HEIGHT = 36;
const OVERSCAN = 5;

/**
 * VirtualTree component that renders a virtualized tree view.
 * Only renders visible rows + overscan for optimal performance.
 */
export function VirtualTree({
  nodes,
  expanded,
  selectedFmGuids,
  scrollToFmGuid,
  selectedNodeFmGuid,
  onToggle,
  onSelect,
}: VirtualTreeProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Compute flat list from tree - memoized for performance
  const flatNodes = useMemo(
    () => flattenVisibleTree(nodes, expanded),
    [nodes, expanded]
  );

  // Build index map for scroll-to functionality
  const fmGuidToIndex = useMemo(
    () => buildFmGuidToIndexMap(flatNodes),
    [flatNodes]
  );

  // Virtualizer from @tanstack/react-virtual
  const virtualizer = useVirtualizer({
    count: flatNodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  // Scroll to specific node (e.g., on AI selection)
  useEffect(() => {
    if (scrollToFmGuid) {
      const index = fmGuidToIndex.get(scrollToFmGuid);
      if (index !== undefined) {
        virtualizer.scrollToIndex(index, { align: 'center', behavior: 'smooth' });
      }
    }
  }, [scrollToFmGuid, fmGuidToIndex, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();

  if (flatNodes.length === 0) {
    return (
      <div className="p-2 sm:p-3 text-xs sm:text-sm text-muted-foreground">
        No items to display.
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="h-full overflow-auto"
      style={{ contain: 'strict' }}
    >
      {/* Container with total height for correct scrollbar */}
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualItem) => {
          const flatNode = flatNodes[virtualItem.index];
          const isSelected = selectedFmGuids?.has(flatNode.fmGuid) ?? false;
          const isNodeSelected = selectedNodeFmGuid === flatNode.fmGuid;

          return (
            <VirtualTreeRow
              key={flatNode.fmGuid}
              flatNode={flatNode}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
              isSelected={isSelected || isNodeSelected}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          );
        })}
      </div>
    </div>
  );
}
