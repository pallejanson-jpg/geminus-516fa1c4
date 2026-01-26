import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { GripVertical, Save, RotateCcw } from 'lucide-react';
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

export interface ToolConfig {
  id: string;
  label: string;
  visible: boolean;
  inOverflow: boolean;
}

const DEFAULT_TOOLS: ToolConfig[] = [
  { id: 'orbit', label: 'Orbit (rotera)', visible: true, inOverflow: false },
  { id: 'firstPerson', label: 'Första person', visible: true, inOverflow: false },
  { id: 'zoomIn', label: 'Zooma in', visible: true, inOverflow: false },
  { id: 'zoomOut', label: 'Zooma ut', visible: true, inOverflow: false },
  { id: 'viewFit', label: 'Anpassa vy', visible: true, inOverflow: false },
  { id: 'resetView', label: 'Återställ vy', visible: true, inOverflow: false },
  { id: 'select', label: 'Välj objekt', visible: true, inOverflow: false },
  { id: 'measure', label: 'Mätverktyg', visible: true, inOverflow: false },
  { id: 'slicer', label: 'Snittplan', visible: true, inOverflow: false },
  { id: 'viewMode', label: '2D/3D växla', visible: true, inOverflow: false },
  { id: 'treeView', label: 'Modellträd', visible: true, inOverflow: false },
  { id: 'visualization', label: 'Rumsvisualisering', visible: true, inOverflow: false },
  { id: 'xray', label: 'X-ray läge', visible: true, inOverflow: true },
  { id: 'spaces', label: 'Visa/dölj rum', visible: true, inOverflow: true },
  { id: 'navCube', label: 'Navigationskub', visible: true, inOverflow: true },
  { id: 'minimap', label: 'Minimap', visible: true, inOverflow: true },
  { id: 'annotations', label: 'Annotationer', visible: true, inOverflow: true },
  { id: 'objectInfo', label: 'Objektinfo (Asset+)', visible: true, inOverflow: false },
  { id: 'properties', label: 'Egenskaper (Lovable)', visible: true, inOverflow: false },
  { id: 'addAsset', label: 'Registrera tillgång', visible: true, inOverflow: false },
];

const STORAGE_KEY = 'viewer-toolbar-settings';

export const getToolbarSettings = (): ToolConfig[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to handle new tools - add missing tools at end
      const mergedTools = DEFAULT_TOOLS.map(defaultTool => {
        const storedTool = parsed.find((t: ToolConfig) => t.id === defaultTool.id);
        return storedTool || defaultTool;
      });
      
      // Check if any new tools were added (not in stored settings)
      const hasNewTools = DEFAULT_TOOLS.some(
        dt => !parsed.find((t: ToolConfig) => t.id === dt.id)
      );
      
      // If new tools were added, save the merged settings
      if (hasNewTools) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(mergedTools));
      }
      
      return mergedTools;
    }
  } catch (e) {
    console.warn('Failed to load toolbar settings:', e);
  }
  return DEFAULT_TOOLS;
};

export const saveToolbarSettings = (tools: ToolConfig[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tools));
  } catch (e) {
    console.warn('Failed to save toolbar settings:', e);
  }
};

interface SortableToolItemProps {
  tool: ToolConfig;
  onToggleVisible: (id: string) => void;
  onToggleOverflow: (id: string) => void;
}

const SortableToolItem: React.FC<SortableToolItemProps> = ({ tool, onToggleVisible, onToggleOverflow }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tool.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 p-2 bg-card border rounded-lg hover:bg-muted/50"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing touch-none"
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </button>
      
      <span className="flex-1 text-sm">{tool.label}</span>
      
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Switch
            id={`visible-${tool.id}`}
            checked={tool.visible}
            onCheckedChange={() => onToggleVisible(tool.id)}
          />
          <Label htmlFor={`visible-${tool.id}`} className="text-xs text-muted-foreground">
            Synlig
          </Label>
        </div>
        
        <div className="flex items-center gap-2">
          <Switch
            id={`overflow-${tool.id}`}
            checked={tool.inOverflow}
            onCheckedChange={() => onToggleOverflow(tool.id)}
            disabled={!tool.visible}
          />
          <Label htmlFor={`overflow-${tool.id}`} className="text-xs text-muted-foreground">
            Övermeny
          </Label>
        </div>
      </div>
    </div>
  );
};

interface ToolbarSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  onSettingsChange?: (tools: ToolConfig[]) => void;
}

const ToolbarSettings: React.FC<ToolbarSettingsProps> = ({ isOpen, onClose, onSettingsChange }) => {
  const [tools, setTools] = useState<ToolConfig[]>(getToolbarSettings());

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    if (isOpen) {
      setTools(getToolbarSettings());
    }
  }, [isOpen]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setTools((items) => {
        const oldIndex = items.findIndex((i) => i.id === active.id);
        const newIndex = items.findIndex((i) => i.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const handleToggleVisible = (id: string) => {
    setTools(prev => prev.map(t => 
      t.id === id ? { ...t, visible: !t.visible, inOverflow: !t.visible ? t.inOverflow : false } : t
    ));
  };

  const handleToggleOverflow = (id: string) => {
    setTools(prev => prev.map(t => 
      t.id === id ? { ...t, inOverflow: !t.inOverflow } : t
    ));
  };

  const handleSave = () => {
    saveToolbarSettings(tools);
    onSettingsChange?.(tools);
    toast.success('Verktygsfält-inställningar sparade');
    onClose();
  };

  const handleReset = () => {
    setTools(DEFAULT_TOOLS);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>Anpassa verktygsfält</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Dra för att ändra ordning. Välj vilka verktyg som ska vara synliga och vilka som ska ligga i övermenyn.
        </p>

        <ScrollArea className="h-[400px] pr-4">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={tools.map(t => t.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {tools.map((tool) => (
                  <SortableToolItem
                    key={tool.id}
                    tool={tool}
                    onToggleVisible={handleToggleVisible}
                    onToggleOverflow={handleToggleOverflow}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </ScrollArea>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleReset}>
            <RotateCcw className="h-4 w-4 mr-2" />
            Återställ
          </Button>
          <Button onClick={handleSave}>
            <Save className="h-4 w-4 mr-2" />
            Spara
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ToolbarSettings;
