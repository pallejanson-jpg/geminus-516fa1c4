import React, { useEffect, useRef } from 'react';
import { Type, MessageSquarePlus, MessageSquare, Tags, Scan, EyeOff, Eye, ZoomIn, Info, Move, Trash2, MousePointer } from 'lucide-react';

interface ViewerContextMenuProps {
  position: { x: number; y: number };
  entityId: string | null;
  entityName: string | null;
  fmGuid?: string | null;
  onClose: () => void;
  onShowLabels: () => void;
  onCreateIssue: () => void;
  onViewIssues: () => void;
  onShowRoomLabels: () => void;
  onShowProperties?: () => void;
  onZoomTo?: () => void;
  onHideEntity?: () => void;
  onIsolateEntity?: () => void;
  onShowAll?: () => void;
  onSelectEntity?: () => void;
  onMoveObject?: () => void;
  onDeleteObject?: () => void;
}

const ViewerContextMenu: React.FC<ViewerContextMenuProps> = ({
  position,
  entityId,
  entityName,
  onClose,
  onShowLabels,
  onCreateIssue,
  onViewIssues,
  onShowRoomLabels,
  onShowProperties,
  onZoomTo,
  onHideEntity,
  onIsolateEntity,
  onShowAll,
  onSelectEntity,
  onMoveObject,
  onDeleteObject,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => { document.removeEventListener('mousedown', handleClickOutside); document.removeEventListener('keydown', handleKeyDown); };
  }, [onClose]);

  const menuWidth = 220;
  const menuHeight = 340;
  const x = Math.min(position.x, window.innerWidth - menuWidth - 8);
  const y = Math.min(position.y, window.innerHeight - menuHeight - 8);

  const handleClick = (action: () => void) => { action(); onClose(); };

  // Build items — entity-specific items always shown but disabled when no entity
  const hasEntity = !!entityId;
  const items: { icon: any; label: string; action: () => void; disabled?: boolean; separator?: boolean }[] = [];

  // Entity-specific actions (always visible, disabled when no entity)
  items.push({ icon: Info, label: 'Properties', action: onShowProperties || (() => {}), disabled: !hasEntity || !onShowProperties });
  items.push({ icon: MousePointer, label: 'Select', action: onSelectEntity || (() => {}), disabled: !hasEntity || !onSelectEntity });
  items.push({ icon: ZoomIn, label: 'Zoom to', action: onZoomTo || (() => {}), disabled: !hasEntity || !onZoomTo });
  items.push({ icon: Scan, label: 'Isolate', action: onIsolateEntity || (() => {}), disabled: !hasEntity || !onIsolateEntity });
  items.push({ icon: EyeOff, label: 'Hide', action: onHideEntity || (() => {}), disabled: !hasEntity || !onHideEntity });
  items.push({ icon: Move, label: 'Move object', action: onMoveObject || (() => {}), disabled: !hasEntity || !onMoveObject });
  items.push({ icon: Trash2, label: 'Delete object', action: onDeleteObject || (() => {}), disabled: !hasEntity || !onDeleteObject });

  // Separator + always-available actions
  if (onShowAll) items.push({ icon: Eye, label: 'Show all', action: onShowAll, separator: true });
  items.push({ icon: Tags, label: 'Show labels', action: onShowLabels });
  items.push({ icon: Type, label: 'Show room labels', action: onShowRoomLabels });
  items.push({ icon: MessageSquarePlus, label: 'Create issue', action: onCreateIssue });
  items.push({ icon: MessageSquare, label: 'Show issues', action: onViewIssues });

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] min-w-[200px] rounded-lg border border-zinc-700 bg-zinc-900/95 backdrop-blur-md shadow-xl animate-in fade-in-0 zoom-in-95 duration-100 text-zinc-100"
      style={{ left: x, top: y }}
    >
      {entityName && (
        <div className="px-3 py-2 border-b border-zinc-700">
          <p className="text-xs text-zinc-400 truncate max-w-[200px]">{entityName}</p>
        </div>
      )}

      <div className="py-1">
        {items.map(({ icon: Icon, label, action, disabled, separator }, idx) => (
          <React.Fragment key={`${label}-${idx}`}>
            {separator && <div className="my-1 border-t border-zinc-700" />}
            <button
              className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm transition-colors ${disabled ? 'text-zinc-500 cursor-not-allowed' : 'text-zinc-100 hover:bg-zinc-800'}`}
              onClick={() => !disabled && handleClick(action)}
              disabled={disabled}
            >
              <Icon className={`h-4 w-4 ${disabled ? 'text-zinc-600' : 'text-muted-foreground'}`} />
              {label}
            </button>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

export default ViewerContextMenu;
