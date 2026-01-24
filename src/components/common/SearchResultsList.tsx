import React from 'react';
import { Building2, Layers, DoorOpen, Box } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SearchResult, getCategoryLabel, getCategoryColor } from '@/hooks/useSearchResults';

interface SearchResultsListProps {
  results: SearchResult[];
  onSelect: (result: SearchResult) => void;
  isLoading?: boolean;
  emptyMessage?: string;
}

const categoryIcons: Record<string, React.ComponentType<any>> = {
  'Building': Building2,
  'Building Storey': Layers,
  'Space': DoorOpen,
  'Door': Box,
};

export function SearchResultsList({ 
  results, 
  onSelect, 
  isLoading = false,
  emptyMessage = 'Inga resultat hittades'
}: SearchResultsListProps) {
  if (isLoading) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        Söker...
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <ul className="max-h-80 overflow-y-auto">
      {results.map((result) => {
        const Icon = categoryIcons[result.category] || Box;
        return (
          <li key={result.fmGuid}>
            <button
              type="button"
              onClick={() => onSelect(result)}
              className={cn(
                "w-full flex items-start gap-3 px-3 py-2.5 text-left",
                "hover:bg-accent/50 transition-colors",
                "focus:outline-none focus:bg-accent/50"
              )}
            >
              <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">
                    {result.name}
                  </span>
                  <span className={cn(
                    "shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium",
                    getCategoryColor(result.category)
                  )}>
                    {getCategoryLabel(result.category)}
                  </span>
                </div>
                {(result.buildingName || result.levelName) && (
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {[result.buildingName, result.levelName].filter(Boolean).join(' › ')}
                  </div>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
