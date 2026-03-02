import React, { useEffect, useRef } from 'react';
import { Type, MessageSquarePlus, MessageSquare, Tags } from 'lucide-react';

interface ViewerContextMenuProps {
  position: { x: number; y: number };
  entityId: string | null;
  entityName: string | null;
  onClose: () => void;
  onShowLabels: () => void;
  onCreateIssue: () => void;
  onViewIssues: () => void;
  onShowRoomLabels: () => void;
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
  const menuHeight = 200;
  const x = Math.min(position.x, window.innerWidth - menuWidth - 8);
  const y = Math.min(position.y, window.innerHeight - menuHeight - 8);

  const handleClick = (action: () => void) => { action(); onClose(); };

  const items = [
    { icon: Tags, label: 'Visa etiketter', action: onShowLabels },
    { icon: MessageSquarePlus, label: 'Skapa ärende', action: onCreateIssue },
    { icon: MessageSquare, label: 'Visa ärenden', action: onViewIssues },
    { icon: Type, label: 'Visa rumsetiketter', action: onShowRoomLabels },
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
        {items.map(({ icon: Icon, label, action }) => (
          <button
            key={label}
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
