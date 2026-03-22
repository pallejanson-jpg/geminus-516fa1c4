import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { GripVertical, Save, RotateCcw, ClipboardList, AlertTriangle, BarChart2, Building2, Box, Zap, Archive, Radar, Scan, Cuboid } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { toast } from 'sonner';
import {
  SidebarItem,
  DEFAULT_SIDEBAR_ORDER,
  DEFAULT_APP_CONFIGS,
  SIDEBAR_ORDER_STORAGE_KEY,
  SIDEBAR_SETTINGS_CHANGED_EVENT,
} from '@/lib/constants';

// Map sidebar item IDs to their display config
const SIDEBAR_ITEM_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  inventory: { label: 'Inventory', icon: ClipboardList, color: 'text-orange-500' },
  fault_report: { label: 'Fault Report', icon: AlertTriangle, color: 'text-red-500' },
  insights: { label: 'Insights', icon: BarChart2, color: 'text-green-500' },
  fma_plus: { label: DEFAULT_APP_CONFIGS.fma_plus.label, icon: Building2, color: 'text-blue-500' },
  asset_plus: { label: DEFAULT_APP_CONFIGS.asset_plus.label, icon: Box, color: 'text-purple-500' },
  iot: { label: DEFAULT_APP_CONFIGS.iot.label, icon: Zap, color: 'text-yellow-500' },
  original_archive: { label: DEFAULT_APP_CONFIGS.original_archive.label, icon: Archive, color: 'text-indigo-500' },
  radar: { label: DEFAULT_APP_CONFIGS.radar.label, icon: Radar, color: 'text-pink-500' },
  ai_scan: { label: 'AI Scan', icon: Scan, color: 'text-emerald-500' },
  native_viewer: { label: '3D Viewer', icon: Cuboid, color: 'text-blue-500' },
};

export const getSidebarOrder = (): SidebarItem[] => {
  try {
    const stored = localStorage.getItem(SIDEBAR_ORDER_STORAGE_KEY);
    if (stored) {
      const parsed: SidebarItem[] = JSON.parse(stored);
      // Ensure all items from defaults exist (merge in case new items were added)
      const storedIds = new Set(parsed.map(i => i.id));
      const missing = DEFAULT_SIDEBAR_ORDER.filter(d => !storedIds.has(d.id));
      if (missing.length > 0) {
        return [...parsed, ...missing];
      }
      // Remove any items no longer in defaults
      const validIds = new Set(DEFAULT_SIDEBAR_ORDER.map(i => i.id));
      return parsed.filter(i => validIds.has(i.id));
    }
  } catch (e) {
    console.warn('Failed to load sidebar order:', e);
  }
  return DEFAULT_SIDEBAR_ORDER;
};

export const saveSidebarOrder = (items: SidebarItem[]) => {
  try {
    localStorage.setItem(SIDEBAR_ORDER_STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(SIDEBAR_SETTINGS_CHANGED_EVENT, { detail: items }));
  } catch (e) {
    console.warn('Failed to save sidebar order:', e);
  }
};

// Sortable row component
const SortableSidebarItem: React.FC<{
  item: SidebarItem;
  onToggleDivider: (id: string) => void;
}> = ({ item, onToggleDivider }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const meta = SIDEBAR_ITEM_META[item.id];
  if (!meta) return null;

  const IconComp = meta.icon;

  return (
    <div ref={setNodeRef} style={style}>
      <div className="flex items-center gap-3 p-2.5 bg-card border rounded-lg hover:bg-muted/50">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing touch-none"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>

        <IconComp size={16} className={meta.color} />
        <span className="flex-1 text-sm">{meta.label}</span>

        <div className="flex items-center gap-2">
          <Switch
            id={`divider-${item.id}`}
            checked={item.hasDividerAfter}
            onCheckedChange={() => onToggleDivider(item.id)}
          />
          <Label htmlFor={`divider-${item.id}`} className="text-xs text-muted-foreground whitespace-nowrap">
            Divider
          </Label>
        </div>
      </div>
      {item.hasDividerAfter && (
        <div className="flex items-center gap-2 py-1 px-4">
          <div className="flex-1 h-px bg-border" />
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">avdelare</span>
          <div className="flex-1 h-px bg-border" />
        </div>
      )}
    </div>
  );
};

interface AppMenuSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

const AppMenuSettings: React.FC<AppMenuSettingsProps> = ({ isOpen, onClose }) => {
  const [items, setItems] = useState<SidebarItem[]>(getSidebarOrder());

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    if (isOpen) {
      setItems(getSidebarOrder());
    }
  }, [isOpen]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setItems((prev) => {
        const oldIndex = prev.findIndex((i) => i.id === active.id);
        const newIndex = prev.findIndex((i) => i.id === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  };

  const handleToggleDivider = (id: string) => {
    setItems(prev => prev.map(item =>
      item.id === id ? { ...item, hasDividerAfter: !item.hasDividerAfter } : item
    ));
  };

  const handleSave = () => {
    saveSidebarOrder(items);
    toast.success('App order saved');
    onClose();
  };

  const handleReset = () => {
    setItems(DEFAULT_SIDEBAR_ORDER);
    toast.info('Appordning återställd till standard');
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-md max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Anpassa appmeny</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Dra för att ändra ordning. Aktivera avdelare för att skapa visuella grupper.
        </p>

        <div className="flex-1 min-h-0 overflow-y-auto pr-1" style={{ maxHeight: 'calc(100dvh - 14rem)' }}>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-1.5 pb-2">
                {items.map((item) => (
                  <SortableSidebarItem
                    key={item.id}
                    item={item}
                    onToggleDivider={handleToggleDivider}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        <DialogFooter className="gap-2 flex-col-reverse sm:flex-row">
          <Button variant="outline" onClick={handleReset} className="w-full sm:w-auto">
            <RotateCcw className="h-4 w-4 mr-2" />
            Återställ
          </Button>
          <Button onClick={handleSave} className="w-full sm:w-auto">
            <Save className="h-4 w-4 mr-2" />
            Spara
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AppMenuSettings;
