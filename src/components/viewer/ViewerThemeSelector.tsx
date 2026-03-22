/**
 * ViewerThemeSelector - Dropdown for selecting viewer color themes
 */
import React, { useEffect, useState } from 'react';
import { Palette, Check, Loader2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useViewerTheme, ViewerTheme, VIEWER_THEME_REQUESTED_EVENT } from '@/hooks/useViewerTheme';

interface ViewerThemeSelectorProps {
  viewerRef: React.MutableRefObject<any>;
  disabled?: boolean;
}

const ViewerThemeSelector: React.FC<ViewerThemeSelectorProps> = ({
  viewerRef,
  disabled = false,
}) => {
  const { themes, activeTheme, isLoading, selectTheme } = useViewerTheme();
  const [selectedId, setSelectedId] = useState<string>('');

  // Find Standard theme ID for default selection
  useEffect(() => {
    if (themes.length > 0 && !selectedId) {
      const standardTheme = themes.find(t => t.name === 'Standard' && t.is_system);
      if (standardTheme) {
        setSelectedId(standardTheme.id);
      }
    }
  }, [themes, selectedId]);

  // Sync with active theme changes
  useEffect(() => {
    if (activeTheme) {
      setSelectedId(activeTheme.id);
    }
  }, [activeTheme]);

  // Listen for external theme change requests
  useEffect(() => {
    const handleThemeRequest = (e: CustomEvent) => {
      const { themeId } = e.detail || {};
      if (themeId) {
        handleThemeChange(themeId);
      }
    };
    
    window.addEventListener(VIEWER_THEME_REQUESTED_EVENT, handleThemeRequest as EventListener);
    return () => {
      window.removeEventListener(VIEWER_THEME_REQUESTED_EVENT, handleThemeRequest as EventListener);
    };
  }, [themes]);

  const handleThemeChange = (themeId: string) => {
    setSelectedId(themeId);
    selectTheme(viewerRef, themeId);
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-1.5">
        <div className="p-1 sm:p-1.5 rounded-md bg-muted text-muted-foreground">
          <Palette className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </div>
        <span className="text-xs sm:text-sm text-muted-foreground">Loading themes...</span>
        <Loader2 className="h-3 w-3 animate-spin ml-auto" />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="p-1 sm:p-1.5 rounded-md bg-muted text-muted-foreground">
          <Palette className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </div>
        <Label className="text-xs sm:text-sm">Viewer Theme</Label>
      </div>
      
      <Select
        value={selectedId}
        onValueChange={handleThemeChange}
        disabled={disabled}
      >
        <SelectTrigger className="h-8 text-xs sm:text-sm bg-background/80">
          <SelectValue placeholder="Välj tema..." />
        </SelectTrigger>
        <SelectContent className="bg-popover z-[100]">
          {themes.map((theme) => (
            <SelectItem 
              key={theme.id} 
              value={theme.id}
              className="text-xs sm:text-sm"
            >
              <div className="flex items-center gap-2">
                <span>{theme.name}</span>
                {theme.is_system && (
                  <span className="text-[10px] text-muted-foreground">(System)</span>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export default ViewerThemeSelector;
