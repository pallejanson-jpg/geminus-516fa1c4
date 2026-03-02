import React, { useState } from 'react';
import { Mic, Volume2, MessageSquare, Vibrate, Gauge, RotateCcw } from 'lucide-react';
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import { toast } from 'sonner';

const VOICE_SETTINGS_KEY = 'voice-control-settings';

export interface VoiceSettingsData {
  enabled: boolean;
  sensitivity: number;
  feedbackVolume: number;
  hapticFeedback: boolean;
  showTranscription: boolean;
  continuousListening: boolean;
}

const DEFAULT_VOICE_SETTINGS: VoiceSettingsData = {
  enabled: false,
  sensitivity: 0.5,
  feedbackVolume: 0.5,
  hapticFeedback: false,
  showTranscription: true,
  continuousListening: false,
};

export const VOICE_SETTINGS_CHANGED_EVENT = 'voice-settings-changed';

export function getVoiceSettings(): VoiceSettingsData {
  try {
    const stored = localStorage.getItem(VOICE_SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_VOICE_SETTINGS, ...parsed };
    }
  } catch (e) {
    console.debug("Failed to load voice settings:", e);
  }
  return DEFAULT_VOICE_SETTINGS;
}

export function saveVoiceSettings(settings: VoiceSettingsData): void {
  try {
    localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent(VOICE_SETTINGS_CHANGED_EVENT, { detail: settings }));
  } catch (e) {
    console.debug("Failed to save voice settings:", e);
  }
}

// FastNav setting helpers
const FASTNAV_KEY = 'viewer-fastnav-enabled';
export function getFastNavEnabled(): boolean {
  try {
    const stored = localStorage.getItem(FASTNAV_KEY);
    return stored !== null ? JSON.parse(stored) : false;
  } catch { return false; }
}
export function setFastNavEnabled(enabled: boolean) {
  localStorage.setItem(FASTNAV_KEY, JSON.stringify(enabled));
}

const VoiceSettings: React.FC = () => {
  const [settings, setSettings] = useState<VoiceSettingsData>(getVoiceSettings);

  const updateSetting = <K extends keyof VoiceSettingsData>(
    key: K,
    value: VoiceSettingsData[K]
  ) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    saveVoiceSettings(newSettings);
  };

  const handleResetVoicePosition = () => {
    localStorage.removeItem('voice-control-position');
    toast.success('Voice control button position reset');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Configure voice control and speech recognition.
        </p>
      </div>

      <Accordion type="multiple" className="space-y-2">
        {/* Master Enable Section */}
        <AccordionItem value="master" className="border rounded-lg">
          <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50">
            <div className="flex items-center gap-3 flex-1">
              <div className={cn(
                "p-2 rounded-md",
                settings.enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              )}>
                <Mic className="h-5 w-5" />
              </div>
              <div className="text-left">
                <h4 className="font-medium text-sm">Voice Control</h4>
                <p className="text-xs text-muted-foreground">
                  {settings.enabled ? 'Enabled' : 'Disabled'}
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 pt-2">
            <div className="flex items-center justify-between py-2">
              <span className="text-sm">Enable microphone for voice commands</span>
              <Switch
                checked={settings.enabled}
                onCheckedChange={(checked) => updateSetting('enabled', checked)}
              />
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Sensitivity Section */}
        <AccordionItem value="sensitivity" className="border rounded-lg">
          <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50">
            <div className="flex items-center gap-3 flex-1">
              <div className="p-2 rounded-md bg-muted text-muted-foreground">
                <Gauge className="h-5 w-5" />
              </div>
              <div className="text-left">
                <h4 className="font-medium text-sm">Microphone Sensitivity</h4>
                <p className="text-xs text-muted-foreground">
                  {Math.round(settings.sensitivity * 100)}%
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 pt-2">
            <div className="flex items-center gap-4">
              <span className="text-xs text-muted-foreground w-8">Low</span>
              <Slider
                value={[settings.sensitivity]}
                onValueChange={(value) => updateSetting('sensitivity', value[0])}
                min={0}
                max={1}
                step={0.05}
                className="flex-1"
                disabled={!settings.enabled}
              />
              <span className="text-xs text-muted-foreground w-8 text-right">High</span>
              <span className="text-sm font-medium w-12 text-right">
                {Math.round(settings.sensitivity * 100)}%
              </span>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Feedback Volume Section */}
        <AccordionItem value="volume" className="border rounded-lg">
          <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50">
            <div className="flex items-center gap-3 flex-1">
              <div className="p-2 rounded-md bg-muted text-muted-foreground">
                <Volume2 className="h-5 w-5" />
              </div>
              <div className="text-left">
                <h4 className="font-medium text-sm">Feedback Volume</h4>
                <p className="text-xs text-muted-foreground">
                  {Math.round(settings.feedbackVolume * 100)}%
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 pt-2">
            <div className="flex items-center gap-4">
              <span className="text-xs text-muted-foreground w-8">Mute</span>
              <Slider
                value={[settings.feedbackVolume]}
                onValueChange={(value) => updateSetting('feedbackVolume', value[0])}
                min={0}
                max={1}
                step={0.05}
                className="flex-1"
                disabled={!settings.enabled}
              />
              <span className="text-xs text-muted-foreground w-8 text-right">Max</span>
              <span className="text-sm font-medium w-12 text-right">
                {Math.round(settings.feedbackVolume * 100)}%
              </span>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Additional Options Section */}
        <AccordionItem value="options" className="border rounded-lg">
          <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50">
            <div className="flex items-center gap-3 flex-1">
              <div className="p-2 rounded-md bg-muted text-muted-foreground">
                <MessageSquare className="h-5 w-5" />
              </div>
              <div className="text-left">
                <h4 className="font-medium text-sm">Additional Options</h4>
                <p className="text-xs text-muted-foreground">
                  Transcription, haptics, continuous listening
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 pt-2 space-y-3">
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "p-1.5 rounded-md",
                  settings.showTranscription ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                )}>
                  <MessageSquare className="h-4 w-4" />
                </div>
                <div>
                  <span className="text-sm">Show Transcription</span>
                  <p className="text-xs text-muted-foreground">Display spoken text on screen</p>
                </div>
              </div>
              <Switch
                checked={settings.showTranscription}
                onCheckedChange={(checked) => updateSetting('showTranscription', checked)}
                disabled={!settings.enabled}
              />
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "p-1.5 rounded-md",
                  settings.hapticFeedback ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                )}>
                  <Vibrate className="h-4 w-4" />
                </div>
                <div>
                  <span className="text-sm">Haptic Feedback</span>
                  <p className="text-xs text-muted-foreground">Vibrate on recognized command (mobile)</p>
                </div>
              </div>
              <Switch
                checked={settings.hapticFeedback}
                onCheckedChange={(checked) => updateSetting('hapticFeedback', checked)}
                disabled={!settings.enabled}
              />
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "p-1.5 rounded-md",
                  settings.continuousListening ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                )}>
                  <Mic className="h-4 w-4" />
                </div>
                <div>
                  <span className="text-sm">Continuous Listening</span>
                  <p className="text-xs text-muted-foreground">Always listen instead of push-and-hold</p>
                </div>
              </div>
              <Switch
                checked={settings.continuousListening}
                onCheckedChange={(checked) => updateSetting('continuousListening', checked)}
                disabled={!settings.enabled}
              />
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Position Reset */}
        <AccordionItem value="position" className="border rounded-lg">
          <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50">
            <div className="flex items-center gap-3 flex-1">
              <div className="p-2 rounded-md bg-muted text-muted-foreground">
                <RotateCcw className="h-5 w-5" />
              </div>
              <div className="text-left">
                <h4 className="font-medium text-sm">Reset Positions</h4>
                <p className="text-xs text-muted-foreground">
                  Reset button positions to default
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 pt-2">
            <Button variant="outline" size="sm" onClick={handleResetVoicePosition}>
              Reset voice control button position
            </Button>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
};

export default VoiceSettings;
