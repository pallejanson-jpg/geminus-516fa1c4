import type { NavigatorNode } from '@/lib/types';

/**
 * A flat representation of a tree node for virtualization.
 * Contains all info needed to render a row without accessing the tree structure.
 */
export interface FlatNode {
  fmGuid: string;
  node: NavigatorNode;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  parentFmGuid: string | null;
}

/**
 * Flattens a hierarchical tree into a list based on expanded nodes.
 * Runs O(n) where n = number of visible nodes (not total).
 * 
 * @param nodes - The tree nodes to flatten
 * @param expanded - Set of fmGuids that are expanded
 * @param depth - Current depth level (default 0)
 * @param parentFmGuid - Parent's fmGuid for reference (default null)
 * @returns Array of FlatNode representing visible rows
 */
export function flattenVisibleTree(
  nodes: NavigatorNode[],
  expanded: Set<string>,
  depth = 0,
  parentFmGuid: string | null = null
): FlatNode[] {
  const result: FlatNode[] = [];

  for (const node of nodes) {
    const hasChildren = Boolean(node.children?.length);
    const isExpanded = expanded.has(node.fmGuid);

    result.push({
      fmGuid: node.fmGuid,
      node,
      depth,
      hasChildren,
      isExpanded,
      parentFmGuid,
    });

    // Only recurse if node is expanded
    if (hasChildren && isExpanded) {
      result.push(
        ...flattenVisibleTree(node.children!, expanded, depth + 1, node.fmGuid)
      );
    }
  }

  return result;
}

/**
 * Builds an index map for all visible nodes for fast lookup.
 * Used for scrolling to a specific node (e.g., AI selection).
 * 
 * @param flatNodes - The flattened node array
 * @returns Map from fmGuid to array index
 */
export function buildFmGuidToIndexMap(flatNodes: FlatNode[]): Map<string, number> {
  const map = new Map<string, number>();
  flatNodes.forEach((node, index) => {
    map.set(node.fmGuid, index);
  });
  return map;
}
