/**
 * FmaV2ObjectGrid — displays FM Access objects for selected floor/class tab.
 *
 * Grid data comes from POST /api/perspective/metadata/json/9
 * Each object has a 'metadata' field with class-specific properties.
 */
import React, { useMemo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { FmAccessNode } from '@/hooks/useFmAccessApi';
import { Loader2 } from 'lucide-react';

interface FmaV2ObjectGridProps {
  objects: FmAccessNode[];
  loading?: boolean;
  selectedGuid?: string | null;
  onSelect?: (node: FmAccessNode) => void;
}

// Pretty-print metadata field keys
function prettyKey(key: string): string {
  return key
    .replace(/^(equip|floor|prop|space|struct|document|room)_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function getNodeGuid(node: FmAccessNode): string {
  return node.systemGuid || node.guid || String(node.objectId ?? '');
}

function getNodeLabel(node: FmAccessNode): string {
  return node.objectName || node.name || String(node.objectId ?? '–');
}

// Pick the most relevant metadata columns (skip GUIDs and internal IDs)
const SKIP_FIELDS = new Set(['hdid', 'ssid', 'securityMask']);
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pickColumns(objects: FmAccessNode[], maxCols = 6): string[] {
  const counts = new Map<string, number>();
  for (const obj of objects) {
    const meta = (obj as any).metadata ?? obj.properties ?? {};
    for (const [k, v] of Object.entries(meta)) {
      if (SKIP_FIELDS.has(k)) continue;
      if (k.endsWith('_guid') || k.endsWith('_id')) continue;
      if (typeof v === 'string' && GUID_RE.test(v)) continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxCols)
    .map(([k]) => k);
}

const FmaV2ObjectGrid: React.FC<FmaV2ObjectGridProps> = ({
  objects,
  loading = false,
  selectedGuid,
  onSelect,
}) => {
  const columns = useMemo(() => pickColumns(objects), [objects]);

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
    <ScrollArea className="h-full">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted/90 backdrop-blur-sm z-10">
          <tr className="border-b border-border">
            <th className="text-left px-3 py-1.5 font-medium text-muted-foreground w-8">#</th>
            <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Namn</th>
            {columns.map(col => (
              <th key={col} className="text-left px-3 py-1.5 font-medium text-muted-foreground whitespace-nowrap">
                {prettyKey(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {objects.map((obj, idx) => {
            const guid = getNodeGuid(obj);
            const isSelected = guid === selectedGuid;
            const meta = (obj as any).metadata ?? obj.properties ?? {};
            return (
              <tr
                key={guid || idx}
                onClick={() => onSelect?.(obj)}
                className={cn(
                  'cursor-pointer border-b border-border/40 hover:bg-accent/40 transition-colors',
                  isSelected && 'bg-primary/10 hover:bg-primary/15',
                )}
              >
                <td className="px-3 py-1 text-muted-foreground">{idx + 1}</td>
                <td className="px-3 py-1 font-medium max-w-[160px]">
                  <span className="block truncate">{getNodeLabel(obj)}</span>
                </td>
                {columns.map(col => (
                  <td key={col} className="px-3 py-1 text-muted-foreground whitespace-nowrap max-w-[140px]">
                    <span className="block truncate">{String(meta[col] ?? '')}</span>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollArea>
  );
};

export default FmaV2ObjectGrid;
