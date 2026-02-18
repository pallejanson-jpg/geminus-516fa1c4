import React, { useState, useRef, useCallback } from 'react';
import { Camera, Sparkles, ChevronRight, Loader2, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { WizardFormData } from './MobileInventoryWizard';

interface PhotoScanStepProps {
  formData: WizardFormData;
  updateFormData: (updates: Partial<WizardFormData>) => void;
  onComplete: (highConfidence: boolean) => void;
  onSkip: () => void;
}

interface AiResult {
  objectType: string;
  suggestedName: string;
  confidence: number;
  category: string;
  properties?: {
    brand?: string | null;
    model?: string | null;
    size?: string | null;
    color?: string | null;
    condition?: string | null;
    text_visible?: string | null;
  };
}

const OBJECT_TYPE_LABELS: Record<string, string> = {
  fire_extinguisher: 'Brandsläckare',
  fire_alarm_button: 'Larmknapp',
  smoke_detector: 'Rökdetektor',
  fire_hose: 'Brandslang',
  electrical_panel: 'Eltavla',
  door: 'Dörr',
  elevator: 'Hiss',
  staircase: 'Trappa',
  ventilation: 'Ventilation',
  other: 'Övrigt',
};

const PhotoScanStep: React.FC<PhotoScanStepProps> = ({
  formData,
  updateFormData,
  onComplete,
  onSkip,
}) => {
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setAiResult(null);

    // Show preview
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      setImagePreview(dataUrl);

      // Extract base64 (strip data URI prefix)
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      setImageBase64(base64);

      // Auto-analyze
      await analyzeImage(base64);
    };
    reader.readAsDataURL(file);
  }, []);

  const analyzeImage = useCallback(async (base64: string) => {
    setIsAnalyzing(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('mobile-ai-scan', {
        body: { imageBase64: base64 },
      });

      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);

      const result = data as AiResult;
      setAiResult(result);

      // Pre-fill form data with AI suggestion
      updateFormData({
        category: result.category || '',
        categoryLabel: result.category || '',
        name: result.suggestedName || '',
        aiSuggestionConfidence: result.confidence,
      });

      // Upload image to storage in background
      uploadImageToStorage(base64);

    } catch (err: any) {
      console.error('[PhotoScanStep] Analysis failed:', err);
      if (err.message?.includes('429') || err.message?.includes('Rate limit')) {
        setError('AI-tjänsten är tillfälligt överbelastad. Försök igen om en stund.');
      } else if (err.message?.includes('402')) {
        setError('AI-krediter saknas. Kontakta administratören.');
      } else {
        setError('Kunde inte analysera bilden. Försök igen eller hoppa över.');
      }
    } finally {
      setIsAnalyzing(false);
    }
  }, [updateFormData]);

  const uploadImageToStorage = async (base64: string) => {
    try {
      const blob = await fetch(`data:image/jpeg;base64,${base64}`).then(r => r.blob());
      const fileName = `${crypto.randomUUID()}.jpg`;
      const filePath = `mobile/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('inventory-images')
        .upload(filePath, blob, { cacheControl: '3600', upsert: false });

      if (!uploadError) {
        const { data: publicUrlData } = supabase.storage
          .from('inventory-images')
          .getPublicUrl(filePath);
        updateFormData({ imageUrl: publicUrlData.publicUrl });
      }
    } catch (e) {
      console.warn('[PhotoScanStep] Image upload failed:', e);
    }
  };

  const handleRetry = () => {
    if (imageBase64) {
      analyzeImage(imageBase64);
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleConfirm = () => {
    if (!aiResult) return;
    const isHighConfidence = aiResult.confidence >= 0.7;
    onComplete(isHighConfidence);
  };

  const confidenceColor = (c: number) => {
    if (c >= 0.7) return 'text-green-600 dark:text-green-400';
    if (c >= 0.4) return 'text-amber-600 dark:text-amber-400';
    return 'text-destructive';
  };

  const confidenceLabel = (c: number) => {
    if (c >= 0.7) return 'Hög säkerhet';
    if (c >= 0.4) return 'Medel säkerhet';
    return 'Låg säkerhet';
  };

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      {/* Header */}
      <div className="text-center space-y-1">
        <div className="flex items-center justify-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-base font-semibold">AI-identifiering</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Fotografera objektet — AI identifierar typ och fyller i uppgifter automatiskt
        </p>
      </div>

      {/* Camera input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Image area */}
      {!imagePreview ? (
        <Button
          variant="outline"
          className="flex-1 border-2 border-dashed flex flex-col gap-3 min-h-[200px]"
          onClick={() => fileInputRef.current?.click()}
        >
          <Camera className="h-12 w-12 text-muted-foreground" />
          <span className="text-base font-medium">Ta foto</span>
          <span className="text-sm text-muted-foreground">eller välj bild från galleriet</span>
        </Button>
      ) : (
        <div className="relative rounded-lg overflow-hidden border flex-shrink-0">
          <img
            src={imagePreview}
            alt="Fotad bild"
            className="w-full h-48 object-cover"
          />
          {isAnalyzing && (
            <div className="absolute inset-0 bg-background/70 flex flex-col items-center justify-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="text-sm font-medium">Identifierar objekt...</span>
            </div>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="absolute bottom-2 right-2"
            onClick={() => fileInputRef.current?.click()}
            disabled={isAnalyzing}
          >
            <Camera className="h-3.5 w-3.5 mr-1" />
            Nytt foto
          </Button>
        </div>
      )}

      {/* AI result */}
      {aiResult && !isAnalyzing && (
        <div className={cn(
          'rounded-lg border p-3 space-y-2',
          aiResult.confidence >= 0.7 ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/30'
        )}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className={cn(
                'h-4 w-4',
                aiResult.confidence >= 0.7 ? 'text-primary' : 'text-muted-foreground'
              )} />
              <span className="font-semibold text-sm">
                {OBJECT_TYPE_LABELS[aiResult.objectType] || aiResult.objectType}
              </span>
              <Badge variant="secondary" className="text-xs">
                {aiResult.category}
              </Badge>
            </div>
            <span className={cn('text-xs font-medium', confidenceColor(aiResult.confidence))}>
              {Math.round(aiResult.confidence * 100)}% — {confidenceLabel(aiResult.confidence)}
            </span>
          </div>

          {aiResult.suggestedName && (
            <p className="text-sm text-foreground">
              <span className="text-muted-foreground">Föreslaget namn: </span>
              <span className="font-medium">{aiResult.suggestedName}</span>
            </p>
          )}

          {/* Properties */}
          {aiResult.properties && (
            <div className="flex flex-wrap gap-1">
              {Object.entries(aiResult.properties).map(([key, val]) => {
                if (!val) return null;
                const labelMap: Record<string, string> = {
                  brand: 'Märke', model: 'Modell', size: 'Storlek',
                  color: 'Färg', condition: 'Skick', text_visible: 'Text',
                };
                return (
                  <Badge key={key} variant="outline" className="text-xs">
                    {labelMap[key] || key}: {val}
                  </Badge>
                );
              })}
            </div>
          )}

          {aiResult.confidence < 0.5 && (
            <p className="text-xs text-muted-foreground italic">
              Låg säkerhet — du kan korrigera i nästa steg
            </p>
          )}
        </div>
      )}

      {/* Error */}
      {error && !isAnalyzing && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
          <div className="space-y-1 flex-1">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={handleRetry} className="h-7 text-xs">
              <RefreshCw className="h-3 w-3 mr-1" />
              Försök igen
            </Button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="space-y-2 mt-auto">
        {aiResult && !isAnalyzing && (
          <Button
            className="w-full h-12"
            onClick={handleConfirm}
          >
            <ChevronRight className="h-4 w-4 mr-2" />
            {aiResult.confidence >= 0.7
              ? 'Använd förslag & gå vidare'
              : 'Förhandsgranska & korrigera'}
          </Button>
        )}

        <Button
          variant="ghost"
          className="w-full h-10 text-muted-foreground"
          onClick={onSkip}
          disabled={isAnalyzing}
        >
          Hoppa över →
        </Button>
      </div>
    </div>
  );
};

export default PhotoScanStep;
