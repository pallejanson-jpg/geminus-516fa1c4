import React, { useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { FileQuestion, RotateCcw } from 'lucide-react';

const ILEAN_SETTINGS_KEY = 'ilean-settings';
export const ILEAN_SETTINGS_CHANGED_EVENT = 'ilean-settings-changed';

export interface IleanSettingsData {
  visible: boolean;
  buttonPosition: { x: number; y: number } | null;
}

const DEFAULT_SETTINGS: IleanSettingsData = {
  visible: false,
  buttonPosition: null,
};

export function getIleanSettings(): IleanSettingsData {
  try {
    const stored = localStorage.getItem(ILEAN_SETTINGS_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.error('Failed to load Ilean settings:', e);
  }
  return DEFAULT_SETTINGS;
}

export function saveIleanSettings(settings: Partial<IleanSettingsData>): void {
  try {
    const current = getIleanSettings();
    const updated = { ...current, ...settings };
    localStorage.setItem(ILEAN_SETTINGS_KEY, JSON.stringify(updated));
    window.dispatchEvent(
      new CustomEvent(ILEAN_SETTINGS_CHANGED_EVENT, { detail: updated })
    );
  } catch (e) {
    console.error('Failed to save Ilean settings:', e);
  }
}

const IleanSettings: React.FC = () => {
  const [settings, setSettings] = useState<IleanSettingsData>(getIleanSettings);

  useEffect(() => {
    const handler = (e: CustomEvent<IleanSettingsData>) => {
      setSettings(e.detail);
    };
    window.addEventListener(ILEAN_SETTINGS_CHANGED_EVENT, handler as EventListener);
    return () => window.removeEventListener(ILEAN_SETTINGS_CHANGED_EVENT, handler as EventListener);
  }, []);

  const handleVisibilityChange = (visible: boolean) => {
    setSettings(prev => ({ ...prev, visible }));
    saveIleanSettings({ visible });
  };

  const handleResetPosition = () => {
    setSettings(prev => ({ ...prev, buttonPosition: null }));
    saveIleanSettings({ buttonPosition: null });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 pb-3 border-b">
        <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-cyan-500/20 to-teal-500/20 flex items-center justify-center">
          <FileQuestion className="h-5 w-5 text-cyan-500" />
        </div>
        <div>
          <h3 className="font-semibold">Ilean AI</h3>
          <p className="text-sm text-muted-foreground">Document assistant from Senslinc</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="ilean-visible" className="text-sm font-medium">
              Show Ilean button
            </Label>
            <p className="text-xs text-muted-foreground">
              Shows the floating document assistant in the application
            </p>
          </div>
          <Switch
            id="ilean-visible"
            checked={settings.visible}
            onCheckedChange={handleVisibilityChange}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Button Position</Label>
            <p className="text-xs text-muted-foreground">
              {settings.buttonPosition 
                ? `Custom position (${Math.round(settings.buttonPosition.x)}, ${Math.round(settings.buttonPosition.y)})`
                : 'Default position (bottom left)'
              }
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetPosition}
            disabled={!settings.buttonPosition}
            className="gap-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground mb-1">Tip</p>
        <p>You can drag the Ilean button to any position on the screen. The position is saved automatically.</p>
      </div>
    </div>
  );
};

export default IleanSettings;
