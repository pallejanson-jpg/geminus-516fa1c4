import React, { useEffect, useRef } from 'react';
import { Info, MessageSquarePlus, Wrench, Eye, MousePointer, ZoomIn, EyeOff, Focus } from 'lucide-react';
import { Separator } from '@/components/ui/separator';

interface ViewerContextMenuProps {
  position: { x: number; y: number };
  entityId: string | null;
  fmGuid: string | null;
  entityName: string | null;
  onClose: () => void;
  onProperties: () => void;
  onCreateIssue: () => void;
  onCreateWorkOrder: () => void;
  onViewInSpace: () => void;
  onSelect: () => void;
  onZoomToFit: () => void;
  onIsolate?: () => void;
  onHideSelected?: () => void;
  onShowAll?: () => void;
}

const MENU_ITEMS_GEMINUS = [
  { key: 'properties', label: 'Properties', icon: Info, color: 'text-primary' },
  { key: 'createIssue', label: 'Create issue', icon: MessageSquarePlus, color: 'text-amber-500' },
  { key: 'createWorkOrder', label: 'Create work order', icon: Wrench, color: 'text-accent' },
] as const;

const MENU_ITEMS_VIEWER = [
  { key: 'viewInSpace', label: 'View in space', icon: Eye, color: 'text-muted-foreground' },
  { key: 'select', label: 'Select object', icon: MousePointer, color: 'text-muted-foreground' },
  { key: 'zoomToFit', label: 'Zoom to fit', icon: ZoomIn, color: 'text-muted-foreground' },
  { key: 'isolate', label: 'Isolate object', icon: Focus, color: 'text-muted-foreground' },
  { key: 'hideSelected', label: 'Hide object', icon: EyeOff, color: 'text-muted-foreground' },
  { key: 'showAll', label: 'Show all', icon: Eye, color: 'text-muted-foreground' },
] as const;

const ViewerContextMenu: React.FC<ViewerContextMenuProps> = ({
  position,
  entityId,
  entityName,
  onClose,
  onProperties,
  onCreateIssue,
  onCreateWorkOrder,
  onViewInSpace,
  onSelect,
  onZoomToFit,
  onIsolate,
  onHideSelected,
  onShowAll,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click-outside or Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Clamp position to viewport
  const menuWidth = 220;
  const menuHeight = 340;
  const x = Math.min(position.x, window.innerWidth - menuWidth - 8);
  const y = Math.min(position.y, window.innerHeight - menuHeight - 8);

  const actionMap: Record<string, (() => void) | undefined> = {
    properties: onProperties,
    createIssue: onCreateIssue,
    createWorkOrder: onCreateWorkOrder,
    viewInSpace: onViewInSpace,
    select: onSelect,
    zoomToFit: onZoomToFit,
    isolate: onIsolate,
    hideSelected: onHideSelected,
    showAll: onShowAll,
  };

  const handleClick = (key: string) => {
    actionMap[key]?.();
    onClose();
  };

  const hasEntity = !!entityId;

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] min-w-[200px] rounded-lg border border-border bg-card/95 backdrop-blur-md shadow-xl animate-in fade-in-0 zoom-in-95 duration-100"
      style={{ left: x, top: y }}
    >
      {/* Entity name header */}
      {entityName && (
        <div className="px-3 py-2 border-b border-border">
          <p className="text-xs text-muted-foreground truncate max-w-[200px]">{entityName}</p>
        </div>
      )}

      {/* Geminus actions */}
      <div className="py-1">
        {MENU_ITEMS_GEMINUS.map((item) => {
          const Icon = item.icon;
          const disabled = item.key === 'properties' && !hasEntity;
          return (
            <button
              key={item.key}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => handleClick(item.key)}
              disabled={disabled}
            >
              <Icon className={`h-4 w-4 ${item.color}`} />
              {item.label}
            </button>
          );
        })}
      </div>

      <Separator />

      {/* Viewer actions */}
      <div className="py-1">
        {MENU_ITEMS_VIEWER.map((item) => {
          const Icon = item.icon;
          const needsEntity = item.key !== 'showAll';
          return (
            <button
              key={item.key}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => handleClick(item.key)}
              disabled={needsEntity && !hasEntity}
            >
              <Icon className={`h-4 w-4 ${item.color}`} />
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ViewerContextMenu;
