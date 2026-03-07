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

  // Build items — entity-specific items only show when an entity is picked
  const items: { icon: any; label: string; action: () => void; entityOnly?: boolean }[] = [];

  // Entity-specific actions
  if (entityId) {
    if (onShowProperties) items.push({ icon: Info, label: 'Egenskaper', action: onShowProperties, entityOnly: true });
    if (onSelectEntity) items.push({ icon: MousePointer, label: 'Markera', action: onSelectEntity, entityOnly: true });
    if (onZoomTo) items.push({ icon: ZoomIn, label: 'Zooma till', action: onZoomTo, entityOnly: true });
    if (onIsolateEntity) items.push({ icon: Scan, label: 'Isolera', action: onIsolateEntity, entityOnly: true });
    if (onHideEntity) items.push({ icon: EyeOff, label: 'Dölj', action: onHideEntity, entityOnly: true });
    if (onMoveObject) items.push({ icon: Move, label: 'Flytta objekt', action: onMoveObject, entityOnly: true });
    if (onDeleteObject) items.push({ icon: Trash2, label: 'Ta bort objekt', action: onDeleteObject, entityOnly: true });
  }

  // Always-available actions
  if (onShowAll) items.push({ icon: Eye, label: 'Visa alla', action: onShowAll });
  items.push({ icon: Tags, label: 'Visa etiketter', action: onShowLabels });
  items.push({ icon: Type, label: 'Visa rumsetiketter', action: onShowRoomLabels });
  items.push({ icon: MessageSquarePlus, label: 'Skapa ärende', action: onCreateIssue });
  items.push({ icon: MessageSquare, label: 'Visa ärenden', action: onViewIssues });

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
        {items.map(({ icon: Icon, label, action }, idx) => (
          <button
            key={`${label}-${idx}`}
            className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-800 transition-colors"
            onClick={() => handleClick(action)}
          >
            <Icon className="h-4 w-4 text-muted-foreground" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default ViewerContextMenu;
