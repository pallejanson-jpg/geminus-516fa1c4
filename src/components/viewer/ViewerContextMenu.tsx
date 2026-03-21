import React, { useEffect, useRef, useState } from 'react';
import { Type, MessageSquarePlus, MessageSquare, Tags, Scan, EyeOff, Eye, ZoomIn, Info, Move, Trash2, MousePointer, PointerOff, Check, ClipboardPlus } from 'lucide-react';
import { getContextMenuSettings, CONTEXT_MENU_SETTINGS_CHANGED_EVENT } from './ContextMenuSettings';

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
  onSelectNone?: () => void;
  onMoveObject?: () => void;
  onDeleteObject?: () => void;
  onCreateAsset?: () => void;
  labelsActive?: boolean;
  roomLabelsActive?: boolean;
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
  onSelectNone,
  onMoveObject,
  onDeleteObject,
  onCreateAsset,
  labelsActive,
  roomLabelsActive,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => {
    const settings = getContextMenuSettings();
    return new Set(settings.filter(s => !s.visible).map(s => s.id));
  });

  // Listen for settings changes
  useEffect(() => {
    const handler = () => {
      const settings = getContextMenuSettings();
      setHiddenIds(new Set(settings.filter(s => !s.visible).map(s => s.id)));
    };
    window.addEventListener(CONTEXT_MENU_SETTINGS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(CONTEXT_MENU_SETTINGS_CHANGED_EVENT, handler);
  }, []);
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    // Use capture phase to ensure we see events even if xeokit stops propagation
    document.addEventListener('mousedown', handleClickOutside, true);
    document.addEventListener('touchstart', handleClickOutside, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => { document.removeEventListener('mousedown', handleClickOutside, true); document.removeEventListener('touchstart', handleClickOutside, true); document.removeEventListener('keydown', handleKeyDown); };
  }, [onClose]);

  const menuWidth = 220;
  const menuHeight = 380;
  const x = Math.min(position.x, window.innerWidth - menuWidth - 8);
  const y = Math.min(position.y, window.innerHeight - menuHeight - 8);

  const handleClick = (action: () => void) => { action(); onClose(); };

  // Build items — entity-specific items always shown but disabled when no entity
  // Filter by ContextMenuSettings visibility
  const hasEntity = !!entityId;
  const items: { icon: any; label: string; action: () => void; disabled?: boolean; separator?: boolean; active?: boolean }[] = [];

  // Entity-specific actions (always visible, disabled when no entity)
  if (!hiddenIds.has('properties')) items.push({ icon: Info, label: 'Properties', action: onShowProperties || (() => {}), disabled: !hasEntity || !onShowProperties });
  if (!hiddenIds.has('select')) items.push({ icon: MousePointer, label: 'Select', action: onSelectEntity || (() => {}), disabled: !hasEntity || !onSelectEntity });
  if (!hiddenIds.has('zoomToFit')) items.push({ icon: ZoomIn, label: 'Zoom to', action: onZoomTo || (() => {}), disabled: !hasEntity || !onZoomTo });
  if (!hiddenIds.has('isolate')) items.push({ icon: Scan, label: 'Isolate', action: onIsolateEntity || (() => {}), disabled: !hasEntity || !onIsolateEntity });
  if (!hiddenIds.has('hideSelected')) items.push({ icon: EyeOff, label: 'Hide', action: onHideEntity || (() => {}), disabled: !hasEntity || !onHideEntity });
  if (!hiddenIds.has('moveObject')) items.push({ icon: Move, label: 'Move object', action: onMoveObject || (() => {}), disabled: !hasEntity || !onMoveObject });
  if (!hiddenIds.has('deleteObject')) items.push({ icon: Trash2, label: 'Delete object', action: onDeleteObject || (() => {}), disabled: !hasEntity || !onDeleteObject });

  // Separator + always-available actions
  if (!hiddenIds.has('showAll') && onShowAll) items.push({ icon: Eye, label: 'Show all', action: onShowAll, separator: true });
  if (onSelectNone) items.push({ icon: PointerOff, label: 'Select none', action: onSelectNone });
  items.push({ icon: Tags, label: 'Show labels', action: onShowLabels, active: labelsActive });
  items.push({ icon: Type, label: 'Show room labels', action: onShowRoomLabels, active: roomLabelsActive });
  if (!hiddenIds.has('createIssue')) items.push({ icon: MessageSquarePlus, label: 'Create issue', action: onCreateIssue });
  if (!hiddenIds.has('createAsset') && onCreateAsset) items.push({ icon: ClipboardPlus, label: 'Create asset', action: onCreateAsset });
  items.push({ icon: MessageSquare, label: 'Show issues', action: onViewIssues });

  return (
    <>
    {/* Invisible backdrop to catch taps on mobile */}
    <div className="fixed inset-0 z-[99]" onClick={onClose} onTouchStart={onClose} />
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
        {items.map(({ icon: Icon, label, action, disabled, separator, active }, idx) => (
          <React.Fragment key={`${label}-${idx}`}>
            {separator && <div className="my-1 border-t border-zinc-700" />}
            <button
              className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm transition-colors ${disabled ? 'text-zinc-500 cursor-not-allowed' : 'text-zinc-100 hover:bg-zinc-800'}`}
              onClick={() => !disabled && handleClick(action)}
              disabled={disabled}
            >
              <Icon className={`h-4 w-4 ${disabled ? 'text-zinc-600' : 'text-muted-foreground'}`} />
              <span className="flex-1 text-left">{label}</span>
              {active && <Check className="h-3.5 w-3.5 text-emerald-400" />}
            </button>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

export default ViewerContextMenu;
