import React, { useEffect, useRef } from 'react';
import { Info, MousePointer, ZoomIn, EyeOff, Focus, Eye } from 'lucide-react';
import { Separator } from '@/components/ui/separator';

interface ViewerContextMenuProps {
  position: { x: number; y: number };
  entityId: string | null;
  entityName: string | null;
  onClose: () => void;
  onProperties: () => void;
  onSelect: () => void;
  onZoomToFit: () => void;
  onIsolate: () => void;
  onHideSelected: () => void;
  onShowAll: () => void;
}

const ViewerContextMenu: React.FC<ViewerContextMenuProps> = ({
  position,
  entityId,
  entityName,
  onClose,
  onProperties,
  onSelect,
  onZoomToFit,
  onIsolate,
  onHideSelected,
  onShowAll,
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

  const menuWidth = 200;
  const menuHeight = 280;
  const x = Math.min(position.x, window.innerWidth - menuWidth - 8);
  const y = Math.min(position.y, window.innerHeight - menuHeight - 8);

  const hasEntity = !!entityId;

  const handleClick = (action: () => void) => { action(); onClose(); };

  const items = [
    { icon: Info, label: 'Properties', action: onProperties, needsEntity: true, color: 'text-primary' },
  ];

  const viewerItems = [
    { icon: MousePointer, label: 'Select object', action: onSelect, needsEntity: true },
    { icon: ZoomIn, label: 'Zoom to fit', action: onZoomToFit, needsEntity: true },
    { icon: Focus, label: 'Isolate object', action: onIsolate, needsEntity: true },
    { icon: EyeOff, label: 'Hide object', action: onHideSelected, needsEntity: true },
    { icon: Eye, label: 'Show all', action: onShowAll, needsEntity: false },
  ];

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] min-w-[190px] rounded-lg border border-zinc-700 bg-zinc-900/95 backdrop-blur-md shadow-xl animate-in fade-in-0 zoom-in-95 duration-100 text-zinc-100"
      style={{ left: x, top: y }}
    >
      {entityName && (
        <div className="px-3 py-2 border-b border-zinc-700">
          <p className="text-xs text-zinc-400 truncate max-w-[180px]">{entityName}</p>
        </div>
      )}

      <div className="py-1">
        {items.map(({ icon: Icon, label, action, needsEntity, color }) => (
          <button
            key={label}
            className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => handleClick(action)}
            disabled={needsEntity && !hasEntity}
          >
            <Icon className={`h-4 w-4 ${color || 'text-muted-foreground'}`} />
            {label}
          </button>
        ))}
      </div>

      <Separator className="bg-zinc-700" />

      <div className="py-1">
        {viewerItems.map(({ icon: Icon, label, action, needsEntity }) => (
          <button
            key={label}
            className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => handleClick(action)}
            disabled={needsEntity && !hasEntity}
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
