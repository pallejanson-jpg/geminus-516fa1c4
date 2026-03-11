import React, { useContext, useCallback, useEffect, useState } from 'react';
import { Building2, Layers, DoorOpen, Box, Search } from 'lucide-react';
import { AppContext } from '@/context/AppContext';
import { useSearchResults, SearchResult, getCategoryLabel, getCategoryColor } from '@/hooks/useSearchResults';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';

const categoryIcons: Record<string, React.ComponentType<any>> = {
  'Building': Building2,
  'Building Storey': Layers,
  'Space': DoorOpen,
  'Door': Box,
};

interface CommandSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandSearch({ open, onOpenChange }: CommandSearchProps) {
  const { navigatorTreeData, setSelectedFacility, setActiveApp, setViewer3dFmGuid } = useContext(AppContext);
  const [query, setQuery] = useState('');

  const results = useSearchResults(navigatorTreeData, query, 30);

  // Group results by category
  const grouped = React.useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    results.forEach(r => {
      const list = map.get(r.category) || [];
      list.push(r);
      map.set(r.category, list);
    });
    return map;
  }, [results]);

  const handleSelect = useCallback((result: SearchResult) => {
    onOpenChange(false);
    setQuery('');

    if (result.category === 'Building') {
      setSelectedFacility({
        fmGuid: result.fmGuid,
        name: result.name,
        commonName: result.name,
        category: result.category,
      });
      setActiveApp('portfolio');
    } else {
      setViewer3dFmGuid(result.fmGuid);
      setActiveApp('native_viewer');
    }
  }, [onOpenChange, setSelectedFacility, setActiveApp, setViewer3dFmGuid]);

  // Reset query when closing
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput 
        placeholder="Search buildings, floors, rooms..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="max-h-[400px]">
        <CommandEmpty>No results found</CommandEmpty>
        {Array.from(grouped.entries()).map(([category, items]) => {
          const Icon = categoryIcons[category] || Box;
          return (
            <CommandGroup key={category} heading={getCategoryLabel(category)}>
              {items.map(item => (
                <CommandItem
                  key={item.fmGuid}
                  value={`${item.name} ${item.buildingName || ''} ${item.levelName || ''}`}
                  onSelect={() => handleSelect(item)}
                  className="flex items-center gap-3 cursor-pointer"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{item.name}</span>
                      <span className={cn(
                        "shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium",
                        getCategoryColor(item.category)
                      )}>
                        {getCategoryLabel(item.category)}
                      </span>
                    </div>
                    {(item.buildingName || item.levelName) && (
                      <div className="text-xs text-muted-foreground truncate">
                        {[item.buildingName, item.levelName].filter(Boolean).join(' › ')}
                      </div>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
