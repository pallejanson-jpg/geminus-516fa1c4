import React, { useState, useCallback } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { FmAccessSearchResult, useFmAccessApi } from '@/hooks/useFmAccessApi';

interface FmAccessSearchProps {
  onSelect: (result: FmAccessSearchResult) => void;
}

const FmAccessSearch: React.FC<FmAccessSearchProps> = ({ onSelect }) => {
  const { searchObjects, loading } = useFmAccessApi();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FmAccessSearchResult[]>([]);
  const [searched, setSearched] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    const res = await searchObjects(query.trim());
    setResults(res || []);
    setSearched(true);
  }, [query, searchObjects]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search objects in FM Access..."
            className="pl-8 h-9 text-sm"
          />
          {loading && <Loader2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>
      </div>
      <ScrollArea className="flex-1">
        {searched && results.length === 0 && (
          <p className="text-sm text-muted-foreground text-center p-4">Inga resultat.</p>
        )}
        <div className="p-1">
          {results.map((r, i) => (
            <button
              key={r.guid || r.objectId || i}
              className="w-full text-left px-3 py-2 text-sm hover:bg-accent/50 rounded-md transition-colors"
              onClick={() => onSelect(r)}
            >
              <div className="font-medium truncate">{r.objectName || r.name || 'Namnlöst'}</div>
              {r.className && <div className="text-[11px] text-muted-foreground">{r.className}</div>}
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};

export default FmAccessSearch;
