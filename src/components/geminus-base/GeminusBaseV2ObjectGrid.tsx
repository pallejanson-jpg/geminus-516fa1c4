/**
 * GeminusBaseV2ObjectGrid — Geminus Base object grid with column filter.
 */
import React, { useMemo, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { GeminusBaseNode } from '@/hooks/useGeminusBaseApi';
import { Loader2 } from 'lucide-react';

interface GeminusBaseV2ObjectGridProps {
  objects: GeminusBaseNode[];
  loading?: boolean;
  selectedGuid?: string | null;
  onSelect?: (node: GeminusBaseNode) => void;
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SKIP_KEYS = new Set(['hdid', 'ssid', 'securityMask']);

function prettyKey(key: string): string {
  return key
    .replace(/^(equip|floor|prop|space|struct|document|room)_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function getNodeGuid(n: GeminusBaseNode): string {
  return n.systemGuid || n.guid || String(n.objectId ?? '');
}

function getNodeLabel(n: GeminusBaseNode): string {
  return n.objectName || n.name || String(n.objectId ?? '–');
}

function getMeta(n: GeminusBaseNode): Record<string, any> {
  return (n as any).metadata ?? n.properties ?? {};
}

// Pick most-populated non-GUID metadata columns, deduplicated
function pickColumns(objects: GeminusBaseNode[], max = 6): string[] {
  const counts = new Map<string, number>();
  const seen = new Set<string>(); // track normalised key to deduplicate

  for (const obj of objects) {
    const meta = getMeta(obj);
    for (const [k, v] of Object.entries(meta)) {
      if (SKIP_KEYS.has(k)) continue;
      if (k.endsWith('_guid') || k.endsWith('_id')) continue;
      if (typeof v === 'string' && GUID_RE.test(v)) continue;

      // Normalise: strip prefix, lowercase
      const norm = k.replace(/^(equip|floor|prop|space|struct|document|room)_/, '').toLowerCase();
      if (seen.has(norm)) continue; // skip duplicate column
      seen.add(norm);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([k]) => k);
}

const GeminusBaseV2ObjectGrid: React.FC<GeminusBaseV2ObjectGridProps> = ({
  objects, loading = false, selectedGuid, onSelect,
}) => {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const columns = useMemo(() => pickColumns(objects), [objects]);

  const filtered = useMemo(() => {
    return objects.filter(obj => {
      const label = getNodeLabel(obj).toLowerCase();
      const meta = getMeta(obj);
      // Check name filter
      if (filters['__name__'] && !label.includes(filters['__name__'].toLowerCase())) return false;
      // Check column filters
      for (const col of columns) {
        const f = filters[col];
        if (f && !String(meta[col] ?? '').toLowerCase().includes(f.toLowerCase())) return false;
      }
      return true;
    });
  }, [objects, filters, columns]);

  const setFilter = (col: string, val: string) =>
    setFilters(prev => val ? { ...prev, [col]: val } : (() => { const r = { ...prev }; delete r[col]; return r; })());

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 size={14} className="animate-spin mr-2" />
        <span className="text-xs">Loading objects…</span>
      </div>
    );
  }
  if (objects.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-muted-foreground">Select a node in the tree to load objects.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ScrollArea className="flex-1">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur-sm">
            {/* Column headers */}
            <tr className="border-b border-border">
              <th className="text-left px-2 py-1 font-medium text-muted-foreground w-8">#</th>
              <th className="text-left px-2 py-1 font-medium text-muted-foreground">Namn</th>
              {columns.map(col => (
                <th key={col} className="text-left px-2 py-1 font-medium text-muted-foreground whitespace-nowrap">
                  {prettyKey(col)}
                </th>
              ))}
            </tr>
            {/* Filter row */}
            <tr className="border-b border-border bg-muted/50">
              <td />
              <td className="px-1 py-0.5">
                <Input
                  placeholder="Filter…"
                  value={filters['__name__'] ?? ''}
                  onChange={e => setFilter('__name__', e.target.value)}
                  className="h-5 text-[11px] px-1 py-0"
                />
              </td>
              {columns.map(col => (
                <td key={col} className="px-1 py-0.5">
                  <Input
                    placeholder="Filter…"
                    value={filters[col] ?? ''}
                    onChange={e => setFilter(col, e.target.value)}
                    className="h-5 text-[11px] px-1 py-0"
                  />
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((obj, idx) => {
              const guid = getNodeGuid(obj);
              const meta = getMeta(obj);
              return (
                <tr
                  key={guid || idx}
                  onClick={() => onSelect?.(obj)}
                  className={cn(
                    'cursor-pointer border-b border-border/40 hover:bg-accent/40 transition-colors',
                    guid === selectedGuid && 'bg-primary/10 hover:bg-primary/15',
                  )}
                >
                  <td className="px-2 py-1 text-muted-foreground">{idx + 1}</td>
                  <td className="px-2 py-1 font-medium max-w-[140px]">
                    <span className="block truncate">{getNodeLabel(obj)}</span>
                  </td>
                  {columns.map(col => (
                    <td key={col} className="px-2 py-1 text-muted-foreground whitespace-nowrap max-w-[120px]">
                      <span className="block truncate">{String(meta[col] ?? '')}</span>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
};

export default GeminusBaseV2ObjectGrid;
