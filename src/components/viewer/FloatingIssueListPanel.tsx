import React, { useState, useEffect, useCallback } from 'react';
import { GripHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import IssueListPanel, { type BcfIssue } from './IssueListPanel';

interface FloatingIssueListPanelProps {
  isOpen: boolean;
  onClose: () => void;
  buildingFmGuid?: string;
  onSelectIssue?: (issue: BcfIssue) => void;
  onCreateIssue?: () => void;
  /** Parent toolbar position for relative placement */
  parentPosition?: { x: number; y: number };
  /** Parent toolbar width */
  parentWidth?: number;
}

/**
 * Floating draggable panel for the issue list.
 * Can be repositioned by dragging the header.
 */
const FloatingIssueListPanel: React.FC<FloatingIssueListPanelProps> = ({
  isOpen,
  onClose,
  buildingFmGuid,
  onSelectIssue,
  onCreateIssue,
  parentPosition,
  parentWidth,
}) => {
  const panelWidth = 280;
  const panelHeight = 400;

  // Position state - initialize to the left of parent toolbar
  const [position, setPosition] = useState({ 
    x: typeof window !== 'undefined' ? window.innerWidth - panelWidth - 20 : 200, 
    y: 60 
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Position to the left of parent toolbar when panel opens
  useEffect(() => {
    if (isOpen) {
      // Calculate position to the left of parent toolbar with 10px gap
      const x = parentPosition && parentWidth
        ? parentPosition.x - panelWidth - 10
        : window.innerWidth - panelWidth - 20;
      
      setPosition({
        x: Math.max(10, x),
        y: parentPosition?.y ?? 80,
      });
    }
  }, [isOpen, parentPosition, parentWidth]);

  // Drag start handler
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    // Don't start drag if clicking interactive elements
    if ((e.target as HTMLElement).closest('button')) return;
    setIsDragging(true);
    setDragOffset({ x: e.clientX - position.x, y: e.clientY - position.y });
  }, [position]);

  // Drag move/end handlers
  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e: MouseEvent) => {
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - panelWidth, e.clientX - dragOffset.x)),
        y: Math.max(0, Math.min(window.innerHeight - 100, e.clientY - dragOffset.y)),
      });
    };

    const handleUp = () => setIsDragging(false);

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDragging, dragOffset]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop — click to close */}
      <div className="fixed inset-0 z-[69]" onClick={onClose} />
      <div
        className={cn(
          "fixed z-[70] border border-border/30 rounded-lg shadow-lg",
          "bg-card/80 backdrop-blur-md",
          "flex flex-col",
          "animate-in fade-in-0 slide-in-from-right-2 duration-200",
          isDragging && "cursor-grabbing"
        )}
        style={{ 
          left: position.x, 
          top: position.y,
          width: panelWidth,
          maxHeight: panelHeight,
        }}
      >
        {/* Draggable Header */}
        <div
          className={cn(
            "flex items-center justify-between px-3 py-2 border-b",
            "cursor-grab select-none",
            isDragging && "cursor-grabbing"
          )}
          onMouseDown={handleDragStart}
        >
          <div className="flex items-center gap-2">
            <GripHorizontal className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Issues</span>
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-6 w-6 hover:bg-muted/50" 
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        
        {/* Issue List Content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <IssueListPanel
            buildingFmGuid={buildingFmGuid}
            onSelectIssue={onSelectIssue}
            onCreateIssue={onCreateIssue}
            className="border-none shadow-none h-full"
          />
        </div>
      </div>
    </>
  );
};

export default FloatingIssueListPanel;
export type { BcfIssue };
