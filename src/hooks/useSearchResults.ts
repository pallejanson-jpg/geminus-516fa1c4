import { useMemo } from 'react';

export interface SearchResult {
  fmGuid: string;
  name: string;
  category: string;
  buildingName?: string;
  levelName?: string;
}

export interface NavigatorNode {
  fmGuid: string;
  category?: string;
  commonName?: string;
  name?: string;
  children?: NavigatorNode[];
  buildingFmGuid?: string;
  levelFmGuid?: string;
  complexCommonName?: string;
  [key: string]: any;
}

/**
 * Flattens a navigator tree into a searchable array
 */
function flattenTree(nodes: NavigatorNode[], buildingName?: string, levelName?: string): SearchResult[] {
  const results: SearchResult[] = [];

  for (const node of nodes) {
    const currentBuildingName = node.category === 'Building' 
      ? (node.commonName || node.name) 
      : buildingName;
    const currentLevelName = node.category === 'Building Storey' 
      ? (node.commonName || node.name) 
      : (node.category === 'Building' ? undefined : levelName);

    results.push({
      fmGuid: node.fmGuid,
      name: node.commonName || node.name || '(unnamed)',
      category: node.category || 'Unknown',
      buildingName: currentBuildingName,
      levelName: currentLevelName,
    });

    if (node.children?.length) {
      results.push(...flattenTree(node.children, currentBuildingName, currentLevelName));
    }
  }

  return results;
}

/**
 * Hook to search through navigator tree data and return matching results with categories
 */
export function useSearchResults(
  navigatorTreeData: NavigatorNode[],
  query: string,
  maxResults = 20
): SearchResult[] {
  return useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed || trimmed.length < 2) return [];

    const allItems = flattenTree(navigatorTreeData);
    
    const matches = allItems.filter(item => 
      item.name.toLowerCase().includes(trimmed) ||
      item.category.toLowerCase().includes(trimmed) ||
      item.buildingName?.toLowerCase().includes(trimmed) ||
      item.levelName?.toLowerCase().includes(trimmed)
    );

    // Sort by relevance: exact name match first, then starts with, then contains
    matches.sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      
      const aExact = aName === trimmed;
      const bExact = bName === trimmed;
      if (aExact !== bExact) return aExact ? -1 : 1;

      const aStarts = aName.startsWith(trimmed);
      const bStarts = bName.startsWith(trimmed);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;

      return aName.localeCompare(bName);
    });

    return matches.slice(0, maxResults);
  }, [navigatorTreeData, query, maxResults]);
}

/**
 * Returns a human-readable category label
 */
export function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    'Building': 'Building',
    'Building Storey': 'Floor',
    'Space': 'Room',
    'Door': 'Door',
    'Complex': 'Complex',
    'Unknown': 'Unknown',
  };
  return labels[category] || category;
}

/**
 * Returns a category color class for badges
 */
export function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    'Building': 'bg-blue-500/20 text-blue-400',
    'Building Storey': 'bg-amber-500/20 text-amber-400',
    'Space': 'bg-green-500/20 text-green-400',
    'Door': 'bg-purple-500/20 text-purple-400',
    'Complex': 'bg-pink-500/20 text-pink-400',
  };
  return colors[category] || 'bg-muted text-muted-foreground';
}
