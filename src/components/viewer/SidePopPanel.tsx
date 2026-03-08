import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SidePopPanelProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  parentPosition: { x: number; y: number };
  parentWidth: number;
  children: React.ReactNode;
  className?: string;
}

/**
 * Side-pop panel that appears to the left or right of a parent panel.
 * Automatically positions itself based on available screen space.
 * Uses semi-transparent frosted glass effect to allow viewing the 3D model behind.
 */
const SidePopPanel: React.FC<SidePopPanelProps> = ({
  isOpen,
  onClose,
  title,
  parentPosition,
  parentWidth,
  children,
  className,
}) => {
  const [screenWidth, setScreenWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);
  const panelWidth = 220;
  const gap = 8;

  // Update screen width on resize
  useEffect(() => {
    const handleResize = () => setScreenWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (!isOpen) return null;

  // Determine if panel should appear on left or right of parent
  const parentCenter = parentPosition.x + parentWidth / 2;
  const showOnLeft = parentCenter > screenWidth / 2;

  // Calculate position
  const position = showOnLeft
    ? { 
        left: Math.max(8, parentPosition.x - panelWidth - gap), 
        top: parentPosition.y 
      }
    : { 
        left: Math.min(screenWidth - panelWidth - 8, parentPosition.x + parentWidth + gap), 
        top: parentPosition.y 
      };

  return (
    <>
      {/* Backdrop — click to close */}
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <div
        className={cn(
          "fixed z-[61] border rounded-lg shadow-lg",
          "bg-card/65 backdrop-blur-md",
          "animate-in fade-in-0 slide-in-from-right-2 duration-200",
          showOnLeft && "slide-in-from-left-2",
          className
        )}
        style={{ 
          left: position.left, 
          top: position.top,
          width: panelWidth,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-2 border-b border-border/50">
          <span className="text-xs font-medium">{title}</span>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-5 w-5 hover:bg-muted/50" 
            onClick={onClose}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
        
        {/* Content */}
        <div className="p-2 max-h-[50vh] overflow-y-auto">
          {children}
        </div>
      </div>
    </>
  );
};

export default SidePopPanel;
