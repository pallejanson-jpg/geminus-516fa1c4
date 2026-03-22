import React, { useState, useEffect, useCallback } from 'react';
import { ChevronRight, ChevronDown, Building2, Layers, DoorOpen, Box, Home, Loader2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { FmAccessNode, CLASS_LABELS } from '@/hooks/useFmAccessApi';

interface FmAccessTreeProps {
  rootNode: FmAccessNode | null;
  loading: boolean;
  selectedGuid: string | null;
  onSelect: (node: FmAccessNode) => void;
}

const CLASS_ICONS: Record<number, React.ElementType> = {
  102: Home,      // Fastighet
  103: Building2, // Byggnad
  105: Layers,    // Plan
  106: Layers,    // Ritning
  107: DoorOpen,  // Rum
};

interface TreeNodeProps {
  node: FmAccessNode;
  depth: number;
  selectedGuid: string | null;
  onSelect: (node: FmAccessNode) => void;
}

const TreeNodeItem: React.FC<TreeNodeProps> = ({ node, depth, selectedGuid, onSelect }) => {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;
  const nodeGuid = node.guid || node.systemGuid;
  const isSelected = nodeGuid === selectedGuid;
  const Icon = CLASS_ICONS[node.classId || 0] || Box;
  const label = node.objectName || node.name || 'Namnlöst';
  const classLabel = node.classId ? CLASS_LABELS[node.classId] : node.className;

  return (
    <div>
      <button
        className={cn(
          'w-full flex items-center gap-1.5 py-1.5 px-2 text-sm hover:bg-accent/50 rounded-md transition-colors text-left',
          isSelected && 'bg-accent text-accent-foreground'
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => {
          onSelect(node);
          if (hasChildren) setExpanded(!expanded);
        }}
      >
        {hasChildren ? (
          expanded ? <ChevronDown size={14} className="flex-shrink-0 text-muted-foreground" /> : <ChevronRight size={14} className="flex-shrink-0 text-muted-foreground" />
        ) : (
          <span className="w-3.5 flex-shrink-0" />
        )}
        <Icon size={14} className="flex-shrink-0 text-primary" />
        <span className="truncate flex-1">{label}</span>
        {classLabel && (
          <span className="text-[10px] text-muted-foreground flex-shrink-0">{classLabel}</span>
        )}
      </button>
      {expanded && hasChildren && (
        <div>
          {node.children!.map((child, i) => (
            <TreeNodeItem
              key={child.guid || child.systemGuid || child.objectId || i}
              node={child}
              depth={depth + 1}
              selectedGuid={selectedGuid}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const FmAccessTree: React.FC<FmAccessTreeProps> = ({ rootNode, loading, selectedGuid, onSelect }) => {
  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">
        <Loader2 size={20} className="animate-spin mr-2" />
        <span className="text-sm">Loading hierarchy…</span>
      </div>
    );
  }

  if (!rootNode) {
    return (
      <div className="p-4 text-sm text-muted-foreground text-center">
        Välj en byggnad för att visa hierarkin.
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="py-1">
        <TreeNodeItem node={rootNode} depth={0} selectedGuid={selectedGuid} onSelect={onSelect} />
      </div>
    </ScrollArea>
  );
};

export default FmAccessTree;
