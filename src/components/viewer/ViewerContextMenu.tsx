import React, { useEffect, useRef, useState } from 'react';
import { Info, MessageSquarePlus, Wrench, Eye, MousePointer, ZoomIn, EyeOff, Focus } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { getContextMenuSettings, CONTEXT_MENU_SETTINGS_CHANGED_EVENT } from './ContextMenuSettings';

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  properties: Info,
  createIssue: MessageSquarePlus,
  createWorkOrder: Wrench,
  viewInSpace: Eye,
  select: MousePointer,
  zoomToFit: ZoomIn,
  isolate: Focus,
  hideSelected: EyeOff,
  showAll: Eye,
};

const COLOR_MAP: Record<string, string> = {
  properties: 'text-primary',
  createIssue: 'text-amber-500',
  createWorkOrder: 'text-accent',
};

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
  const [settings] = useState(() => getContextMenuSettings());

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
      className="fixed z-[100] min-w-[200px] rounded-lg border border-zinc-700 bg-zinc-900/95 backdrop-blur-md shadow-xl animate-in fade-in-0 zoom-in-95 duration-100 text-zinc-100"
      style={{ left: x, top: y }}
    >
      {/* Entity name header */}
      {entityName && (
        <div className="px-3 py-2 border-b border-zinc-700">
          <p className="text-xs text-zinc-400 truncate max-w-[200px]">{entityName}</p>
        </div>
      )}

      {/* Geminus actions */}
      {(() => {
        const gItems = settings.filter((s) => s.group === 'geminus' && s.visible);
        if (!gItems.length) return null;
        return (
          <div className="py-1">
            {gItems.map((item) => {
              const Icon = ICON_MAP[item.id] || Info;
              const color = COLOR_MAP[item.id] || 'text-muted-foreground';
              const disabled = item.id === 'properties' && !hasEntity;
              return (
                <button
                  key={item.id}
                  className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  onClick={() => handleClick(item.id)}
                  disabled={disabled}
                >
                  <Icon className={`h-4 w-4 ${color}`} />
                  {item.label}
                </button>
              );
            })}
          </div>
        );
      })()}

      {(() => {
        const gItems = settings.filter((s) => s.group === 'geminus' && s.visible);
        const vItems = settings.filter((s) => s.group === 'viewer' && s.visible);
        return gItems.length > 0 && vItems.length > 0 ? <Separator className="bg-zinc-700" /> : null;
      })()}

      {/* Viewer actions */}
      {(() => {
        const vItems = settings.filter((s) => s.group === 'viewer' && s.visible);
        if (!vItems.length) return null;
        return (
          <div className="py-1">
            {vItems.map((item) => {
              const Icon = ICON_MAP[item.id] || Eye;
              const color = COLOR_MAP[item.id] || 'text-muted-foreground';
              const needsEntity = item.id !== 'showAll';
              return (
                <button
                  key={item.id}
                  className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  onClick={() => handleClick(item.id)}
                  disabled={needsEntity && !hasEntity}
                >
                  <Icon className={`h-4 w-4 ${color}`} />
                  {item.label}
                </button>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
};

export default ViewerContextMenu;
