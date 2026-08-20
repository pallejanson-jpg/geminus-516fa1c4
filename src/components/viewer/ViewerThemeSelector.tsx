/**
 * ViewerThemeSelector - Dropdown for selecting viewer color themes
 *
 * Persists the last selection in localStorage (key: 'geminus-viewer-theme-id').
 * The special value "none" means "show native model colors" (no theme applied).
 * Applies saved theme after MODEL_LOAD_COMPLETE, waiting for themes to be loaded
 * from Supabase before emitting VIEWER_THEME_REQUESTED.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Palette, Loader2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useViewerTheme, VIEWER_THEME_REQUESTED_EVENT } from '@/hooks/useViewerTheme';
import { on, emit } from '@/lib/event-bus';
import { useLanguage } from '@/context/LanguageContext';

const STORAGE_KEY = 'geminus-viewer-theme-id';
const NONE_VALUE = 'none';

interface ViewerThemeSelectorProps {
  viewerRef: React.MutableRefObject<any>;
  disabled?: boolean;
}

const ViewerThemeSelector: React.FC<ViewerThemeSelectorProps> = ({
  viewerRef,
  disabled = false,
}) => {
  const { themes, activeTheme, isLoading, selectTheme, resetTheme } = useViewerTheme();
  const { t } = useLanguage();
  const [selectedId, setSelectedId] = useState<string>('');

  // True while we're waiting to apply the saved theme (MODEL_LOAD_COMPLETE fired but
  // themes haven't arrived from Supabase yet).
  const pendingApplyRef = useRef(false);
  // Reset on every MODEL_LOAD_COMPLETE so the saved theme is re-applied for every building.
  const appliedOnLoadRef = useRef(false);

  // ── Restore saved theme selection into the dropdown ───────────────────────
  useEffect(() => {
    if (!themes.length || selectedId) return;
    const saved = localStorage.getItem(STORAGE_KEY);
    setSelectedId(saved || NONE_VALUE);
  }, [themes, selectedId]);

  // ── Sync dropdown when an external event changes the active theme ─────────
  useEffect(() => {
    if (activeTheme) setSelectedId(activeTheme.id);
  }, [activeTheme]);

  // ── Apply the saved theme; called both on MODEL_LOAD_COMPLETE and when
  //    themes finish loading (fixes the race where themes arrive after the event).
  const applyPending = useCallback(() => {
    if (!pendingApplyRef.current) return;
    if (!themes.length) return; // still loading — will retry when themes arrive
    pendingApplyRef.current = false;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved !== NONE_VALUE) {
      selectTheme(viewerRef, saved);
    }
    // NONE_VALUE / no saved → native colours, nothing to do
  }, [themes, selectTheme, viewerRef]);

  // ── React whenever themes finish loading — flushes any pending apply ──────
  useEffect(() => {
    applyPending();
  }, [applyPending]);

  // ── MODEL_LOAD_COMPLETE: reset guard so every building load re-applies ────
  useEffect(() => {
    const handleReady = () => {
      // Reset per-load guard so switching buildings re-applies the theme.
      appliedOnLoadRef.current = false;
      if (appliedOnLoadRef.current) return; // (always false here — guard for clarity)
      appliedOnLoadRef.current = true;
      pendingApplyRef.current = true;
      // Small delay so the xeokit scene is fully ready before colorizing.
      setTimeout(() => applyPending(), 300);
    };

    return on('MODEL_LOAD_COMPLETE', handleReady);
  }, [applyPending]);

  // ── Listen for external theme requests (e.g. FilterPanel re-apply) ────────
  useEffect(() => {
    return on(VIEWER_THEME_REQUESTED_EVENT, (detail) => {
      if (detail.themeId) applyThemeId(detail.themeId);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themes]);

  const applyThemeId = (themeId: string) => {
    setSelectedId(themeId);
    if (themeId === NONE_VALUE) {
      resetTheme(viewerRef);
      localStorage.setItem(STORAGE_KEY, NONE_VALUE);
    } else {
      selectTheme(viewerRef, themeId);
      localStorage.setItem(STORAGE_KEY, themeId);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-1.5">
        <div className="p-1 sm:p-1.5 rounded-md bg-muted text-muted-foreground">
          <Palette className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </div>
        <span className="text-xs sm:text-sm text-muted-foreground">{t('Laddar teman...', 'Loading themes...')}</span>
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
        <Label className="text-xs sm:text-sm">{t('Viewer-tema', 'Viewer Theme')}</Label>
      </div>

      <Select
        value={selectedId}
        onValueChange={applyThemeId}
        disabled={disabled}
      >
        <SelectTrigger className="h-8 text-xs sm:text-sm bg-background/80">
          <SelectValue placeholder={t('Välj tema...', 'Select theme...')} />
        </SelectTrigger>
        <SelectContent className="bg-popover z-[100]">
          {/* "None" option — show native XKT model colours */}
          <SelectItem value={NONE_VALUE} className="text-xs sm:text-sm">
            <div className="flex items-center gap-2">
              <span>{t('Ingen (modellens färger)', 'None (model colors)')}</span>
              <span className="text-2xs text-muted-foreground">({t('Standard', 'Default')})</span>
            </div>
          </SelectItem>
          {themes.map((theme) => (
            <SelectItem
              key={theme.id}
              value={theme.id}
              className="text-xs sm:text-sm"
            >
              <div className="flex items-center gap-2">
                <span>{theme.name}</span>
                {theme.is_system && (
                  <span className="text-2xs text-muted-foreground">(System)</span>
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
