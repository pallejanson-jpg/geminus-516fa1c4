import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Sparkles, RotateCcw, Eye, MapPin, Languages, Volume2, Gauge } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { speakWithDeepgram, stopDeepgramAudio } from '@/lib/deepgram-tts';

const GUNNAR_SETTINGS_KEY = 'gunnar-settings';
export const GUNNAR_SETTINGS_CHANGED_EVENT = 'gunnar-settings-changed';

export interface GunnarSettingsData {
  visible: boolean;
  buttonPosition: { x: number; y: number } | null;
  speechLang: 'sv-SE' | 'en-US';
  /** Deepgram Aura voice model ID */
  voiceName: string | null;
  /** Speech rate 0.5–2.0 (default 1.0) */
  speechRate: number;
}

/** Preset Deepgram Aura voices */
export const DEEPGRAM_VOICES = [
  { id: 'aura-2-thalia-en', name: 'Thalia', description: 'Varm & balanserad' },
  { id: 'aura-2-andromeda-en', name: 'Andromeda', description: 'Mjuk & lugn' },
  { id: 'aura-2-asteria-en', name: 'Asteria', description: 'Klar & tydlig' },
  { id: 'aura-2-apollo-en', name: 'Apollo', description: 'Självsäker & stadig' },
  { id: 'aura-2-arcas-en', name: 'Arcas', description: 'Djup & manlig' },
  { id: 'aura-2-athena-en', name: 'Athena', description: 'Professionell & vänlig' },
] as const;

const DEFAULT_SETTINGS: GunnarSettingsData = {
  visible: false,
  buttonPosition: null,
  speechLang: 'sv-SE',
  voiceName: null,
  speechRate: 1.0,
};

export function getGunnarSettings(): GunnarSettingsData {
  try {
    const stored = localStorage.getItem(GUNNAR_SETTINGS_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.error('Failed to load Gunnar settings:', e);
  }
  return DEFAULT_SETTINGS;
}

export function saveGunnarSettings(settings: Partial<GunnarSettingsData>): void {
  try {
    const current = getGunnarSettings();
    const updated = { ...current, ...settings };
    localStorage.setItem(GUNNAR_SETTINGS_KEY, JSON.stringify(updated));
    window.dispatchEvent(
      new CustomEvent(GUNNAR_SETTINGS_CHANGED_EVENT, { detail: updated })
    );
  } catch (e) {
    console.error('Failed to save Gunnar settings:', e);
  }
}

// useAvailableVoices removed — using ElevenLabs presets instead

const GunnarSettings: React.FC = () => {
  const [settings, setSettings] = useState<GunnarSettingsData>(getGunnarSettings);

  useEffect(() => {
    const handler = (e: CustomEvent<GunnarSettingsData>) => {
      setSettings(e.detail);
    };
    window.addEventListener(GUNNAR_SETTINGS_CHANGED_EVENT, handler as EventListener);
    return () => window.removeEventListener(GUNNAR_SETTINGS_CHANGED_EVENT, handler as EventListener);
  }, []);

  const handleVisibilityChange = (visible: boolean) => {
    setSettings(prev => ({ ...prev, visible }));
    saveGunnarSettings({ visible });
  };

  const handleResetPosition = () => {
    setSettings(prev => ({ ...prev, buttonPosition: null }));
    saveGunnarSettings({ buttonPosition: null });
  };

  const handleLangChange = (lang: string) => {
    const speechLang = lang as 'sv-SE' | 'en-US';
    setSettings(prev => ({ ...prev, speechLang, voiceName: null }));
    saveGunnarSettings({ speechLang, voiceName: null });
  };

  const handleVoiceChange = (voiceId: string) => {
    const voiceName = voiceId === '__default__' ? null : voiceId;
    setSettings(prev => ({ ...prev, voiceName }));
    saveGunnarSettings({ voiceName });
  };

  const handleSpeechRateChange = (value: number[]) => {
    const speechRate = value[0];
    setSettings(prev => ({ ...prev, speechRate }));
    saveGunnarSettings({ speechRate });
  };

  const [isTesting, setIsTesting] = useState(false);
  const testAudioRef = useRef<HTMLAudioElement | null>(null);

  const handleTestVoice = useCallback(async () => {
    if (isTesting) return;
    setIsTesting(true);

    // Stop any playing test audio
    stopDeepgramAudio();
    if (testAudioRef.current) {
      testAudioRef.current.pause();
      testAudioRef.current = null;
    }

    const testText = settings.speechLang === 'sv-SE' 
      ? 'Hej! Jag är Geminus AI, din digitala fastighetsassistent.'
      : 'Hello! I am Geminus AI, your digital facility assistant.';

    try {
      const audio = await speakWithDeepgram(testText, {
        model: settings.voiceName || 'aura-2-thalia-en',
        lang: settings.speechLang || 'sv-SE',
        rate: settings.speechRate ?? 1,
      });
      testAudioRef.current = audio;

      if ((audio as any).__browserTTS) {
        const utt = (audio as any).__utterance as SpeechSynthesisUtterance;
        utt.onend = () => setIsTesting(false);
        utt.onerror = () => setIsTesting(false);
        return;
      }

      audio.addEventListener('ended', () => setIsTesting(false), { once: true });
      audio.addEventListener('error', () => setIsTesting(false), { once: true });
      await audio.play();
    } catch (e) {
      console.error('Test voice error:', e);
      setIsTesting(false);
    }
  }, [settings.speechLang, settings.voiceName, settings.speechRate, isTesting]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 pb-3 border-b">
        <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h3 className="font-semibold">Geminus AI</h3>
          <p className="text-sm text-muted-foreground">AI assistant for facility questions</p>
        </div>
      </div>

      <Accordion type="multiple" className="space-y-2">
        <AccordionItem value="visibility" className="border rounded-lg">
          <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50">
            <div className="flex items-center gap-3 flex-1">
              <div className="p-2 rounded-md bg-muted text-muted-foreground">
                <Eye className="h-5 w-5" />
              </div>
              <div className="text-left">
                <h4 className="font-medium text-sm">Visibility</h4>
                <p className="text-xs text-muted-foreground">
                  {settings.visible ? 'Geminus AI button is visible' : 'Geminus AI button is hidden'}
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 pt-2">
            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <Label htmlFor="gunnar-visible" className="text-sm font-medium">
                  Show Geminus AI button
                </Label>
                <p className="text-xs text-muted-foreground">
                  Shows the floating AI assistant button in the application
                </p>
              </div>
              <Switch
                id="gunnar-visible"
                checked={settings.visible}
                onCheckedChange={handleVisibilityChange}
              />
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="speech" className="border rounded-lg">
          <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50">
            <div className="flex items-center gap-3 flex-1">
              <div className="p-2 rounded-md bg-muted text-muted-foreground">
                <Languages className="h-5 w-5" />
              </div>
              <div className="text-left">
                <h4 className="font-medium text-sm">Speech & Language</h4>
                <p className="text-xs text-muted-foreground">
                  {settings.speechLang === 'sv-SE' ? 'Svenska' : 'English'}
                  {settings.voiceName ? ` · ${settings.voiceName}` : ''}
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 pt-2 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Language</Label>
              <Select value={settings.speechLang} onValueChange={handleLangChange}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sv-SE">🇸🇪 Svenska</SelectItem>
                  <SelectItem value="en-US">🇬🇧 English</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Controls both speech recognition and text-to-speech
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Voice</Label>
              <Select value={settings.voiceName || '__default__'} onValueChange={handleVoiceChange}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">Thalia (standard)</SelectItem>
                  {DEEPGRAM_VOICES.map(v => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name} — {v.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Deepgram Aura-röster (flerspråkigt stöd)
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Talhastighet</Label>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-8">Lång</span>
                <Slider
                  value={[settings.speechRate]}
                  onValueChange={handleSpeechRateChange}
                  min={0.5}
                  max={2.0}
                  step={0.1}
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground w-8">Snabb</span>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                {settings.speechRate.toFixed(1)}×
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestVoice}
              disabled={isTesting}
              className="gap-1.5 mt-2"
            >
              <Volume2 className="h-3.5 w-3.5" />
              {isTesting ? 'Spelar...' : 'Testa röst'}
            </Button>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="position" className="border rounded-lg">
          <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50">
            <div className="flex items-center gap-3 flex-1">
              <div className="p-2 rounded-md bg-muted text-muted-foreground">
                <MapPin className="h-5 w-5" />
              </div>
              <div className="text-left">
                <h4 className="font-medium text-sm">Button Position</h4>
                <p className="text-xs text-muted-foreground">
                  {settings.buttonPosition 
                    ? `Custom (${Math.round(settings.buttonPosition.x)}, ${Math.round(settings.buttonPosition.y)})`
                    : 'Default position (bottom right)'
                  }
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 pt-2">
            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Reset Position</Label>
                <p className="text-xs text-muted-foreground">Reset button to default position</p>
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
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground mb-1">Tip</p>
        <p>You can drag the Geminus AI button to any position on the screen. You can also ask Geminus AI to change language or voice via chat!</p>
      </div>
    </div>
  );
};

export default GunnarSettings;
