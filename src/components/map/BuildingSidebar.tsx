import React, { useMemo, useState } from 'react';
import { Building2, ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export interface BuildingSidebarItem {
  id: string;
  displayName: string;
  address: string;
}

interface BuildingSidebarProps {
  facilities: BuildingSidebarItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  title?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  noMatchLabel?: string;
}

const BuildingSidebar: React.FC<BuildingSidebarProps> = ({
  facilities,
  selectedId,
  onSelect,
  title = 'Buildings',
  searchPlaceholder = 'Search buildings...',
  emptyLabel = 'No buildings loaded',
  noMatchLabel = 'No matching buildings',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return facilities;
    const q = searchQuery.toLowerCase();
    return facilities.filter(f =>
      f.displayName.toLowerCase().includes(q) ||
      f.address.toLowerCase().includes(q),
    );
  }, [facilities, searchQuery]);

  // Collapsed state: show only an icon button
  if (!isOpen) {
    return (
      <div className="absolute top-14 sm:top-4 left-3 sm:left-4 z-10">
        <Button
          variant="secondary"
          size="icon"
          onClick={() => setIsOpen(true)}
          className="bg-card/90 backdrop-blur-sm shadow-lg border border-border/50 h-9 w-9 sm:h-10 sm:w-10"
          title={title}
        >
          <Building2 size={16} className="text-primary" />
        </Button>
      </div>
    );
  }

  // Expanded state: full sidebar panel
  return (
    <div className="absolute top-14 sm:top-4 left-3 sm:left-4 z-10 w-[calc(100%-1.5rem)] sm:w-72 max-h-[calc(100%-4.5rem)] sm:max-h-[calc(100%-2rem)]">
      <Card className="bg-card/95 backdrop-blur-sm shadow-xl">
        <CardHeader className="pb-2 p-3 sm:p-4">
          <CardTitle className="text-xs sm:text-sm flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Building2 size={14} className="sm:w-4 sm:h-4 text-primary" />
              {title} ({facilities.length})
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setIsOpen(false)}
            >
              <X size={14} />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-y-auto space-y-2 pt-0 px-3 sm:px-4 pb-3 sm:pb-4 max-h-60 sm:max-h-80">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>
          {filtered.length === 0 ? (
            <p className="text-xs sm:text-sm text-muted-foreground py-4 text-center">
              {searchQuery ? noMatchLabel : emptyLabel}
            </p>
          ) : (
            filtered.map(f => (
              <div
                key={f.id}
                onClick={() => { onSelect(f.id); setIsOpen(false); }}
                className={`p-2 rounded-md cursor-pointer transition-colors ${
                  selectedId === f.id
                    ? 'bg-primary/20 border border-primary/50'
                    : 'bg-muted/50 hover:bg-muted'
                }`}
              >
                <p className="text-xs sm:text-sm font-medium truncate">{f.displayName}</p>
                <p className="text-[10px] sm:text-xs text-muted-foreground truncate">{f.address}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default BuildingSidebar;
