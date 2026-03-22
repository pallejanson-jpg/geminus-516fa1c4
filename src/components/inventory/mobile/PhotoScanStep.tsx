import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Camera, Sparkles, ChevronRight, Loader2, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  description?: string;
  confidence: number;
  category: string;
  suggestedSymbolId?: string | null;
  properties?: {
    manufacturer?: string | null;
    model?: string | null;
    size?: string | null;
    color?: string | null;
    condition?: string | null;
    text_visible?: string | null;
    material?: string | null;
    installation_type?: string | null;
    brand?: string | null;
  };
}

const OBJECT_TYPE_LABELS: Record<string, string> = {
  fire_extinguisher: 'Fire Extinguisher',
  fire_alarm_button: 'Fire Alarm Button',
  smoke_detector: 'Smoke Detector',
  fire_hose: 'Fire Hose',
  electrical_panel: 'Electrical Panel',
  door: 'Door',
  elevator: 'Elevator',
  staircase: 'Staircase',
  ventilation: 'Ventilation',
  hvac_unit: 'HVAC Unit',
  sprinkler: 'Sprinkler',
  emergency_light: 'Emergency Light',
  access_control: 'Access Control',
  other: 'Other',
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

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      setImagePreview(dataUrl);

      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      setImageBase64(base64);

      await analyzeImage(base64);
    };
    reader.readAsDataURL(file);
  }, []);

  const analyzeImage = useCallback(async (base64: string) => {
    setIsAnalyzing(true);
    setError(null);

    try {
      // No templateId — all active templates are used automatically by the edge function
      const { data, error: fnError } = await supabase.functions.invoke('mobile-ai-scan', {
        body: { imageBase64: base64 },
      });

      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);

      const result = data as AiResult;
      setAiResult(result);

      const updates: Partial<WizardFormData> = {
        category: result.category || '',
        categoryLabel: result.category || '',
        name: result.suggestedName || '',
        aiSuggestionConfidence: result.confidence,
      };

      if (result.description) updates.description = result.description;
      if (result.suggestedSymbolId) updates.symbolId = result.suggestedSymbolId;

      if (result.properties) {
        const manufacturer = result.properties.manufacturer || result.properties.brand || null;
        updates.aiProperties = {
          manufacturer,
          model: result.properties.model || null,
          size: result.properties.size || null,
          color: result.properties.color || null,
          condition: result.properties.condition || null,
          text_visible: result.properties.text_visible || null,
          material: result.properties.material || null,
          installation_type: result.properties.installation_type || null,
        };
      }

      updateFormData(updates);
      uploadImageToStorage(base64);
    } catch (err: any) {
      console.error('[PhotoScanStep] Analysis failed:', err);
      if (err.message?.includes('429') || err.message?.includes('Rate limit')) {
        setError('The AI service is temporarily overloaded. Please try again in a moment.');
      } else if (err.message?.includes('402')) {
        setError('AI credits missing. Contact the administrator.');
      } else {
        setError('Could not analyze the image. Try again or skip.');
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

  const handleReanalyze = () => {
    if (imageBase64) {
      analyzeImage(imageBase64);
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
    if (c >= 0.7) return 'High confidence';
    if (c >= 0.4) return 'Medium confidence';
    return 'Low confidence';
  };

  const PROPERTY_LABELS: Record<string, string> = {
    manufacturer: 'Manufacturer',
    brand: 'Brand',
    model: 'Model',
    size: 'Size',
    color: 'Color',
    condition: 'Condition',
    text_visible: 'Visible text',
    material: 'Material',
    installation_type: 'Mounting',
  };

  const conditionLabel = (c: string) => {
    const map: Record<string, string> = { good: 'Good', fair: 'Fair', poor: 'Poor' };
    return map[c] || c;
  };

  return (
    <div className="h-full flex flex-col">
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Header */}
          <div className="text-center space-y-1">
            <div className="flex items-center justify-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <h2 className="text-base font-semibold">AI Identification</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Take a photo of the object — AI identifies the type and fills in details automatically
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
              className="w-full border-2 border-dashed flex flex-col gap-3 min-h-[200px]"
              onClick={() => fileInputRef.current?.click()}
            >
              <Camera className="h-12 w-12 text-muted-foreground" />
               <span className="text-base font-medium">Take photo</span>
               <span className="text-sm text-muted-foreground">or choose from gallery</span>
            </Button>
          ) : (
            <div className="relative rounded-lg overflow-hidden border flex-shrink-0">
              <img
                src={imagePreview}
                alt="Captured image"
                className="w-full h-48 object-cover"
              />
              {isAnalyzing && (
                <div className="absolute inset-0 bg-background/70 flex flex-col items-center justify-center gap-2">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <span className="text-sm font-medium">Identifying object...</span>
                </div>
              )}
              <div className="absolute bottom-2 right-2 flex gap-1.5">
                {/* Re-analyze button */}
                {imageBase64 && (aiResult || error) && !isAnalyzing && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleReanalyze}
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1" />
                    Re-analyze
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isAnalyzing}
                >
                  <Camera className="h-3.5 w-3.5 mr-1" />
                  New photo
                </Button>
              </div>
            </div>
          )}

          {/* AI result */}
          {aiResult && !isAnalyzing && (
            <div className={cn(
              'rounded-lg border p-3 space-y-2.5',
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
                  <span className="text-muted-foreground">Name: </span>
                  <span className="font-medium">{aiResult.suggestedName}</span>
                </p>
              )}

              {aiResult.description && (
                <p className="text-xs text-muted-foreground italic">
                  {aiResult.description}
                </p>
              )}

              {/* Properties */}
              {aiResult.properties && (
                <div className="flex flex-wrap gap-1">
                  {Object.entries(aiResult.properties).map(([key, val]) => {
                    if (!val) return null;
                    const label = PROPERTY_LABELS[key] || key;
                    const displayVal = key === 'condition' ? conditionLabel(val) : val;
                    return (
                      <Badge key={key} variant="outline" className="text-xs">
                        {label}: {displayVal}
                      </Badge>
                    );
                  })}
                </div>
              )}

              {aiResult.suggestedSymbolId && (
                <p className="text-xs text-primary">
                  ✓ Symbol automatically selected
                </p>
              )}

              {aiResult.confidence < 0.5 && (
                <p className="text-xs text-muted-foreground italic">
                  Low confidence — you can correct in the next step
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
                <Button variant="outline" size="sm" onClick={handleReanalyze} className="h-7 text-xs">
                   <RefreshCw className="h-3 w-3 mr-1" />
                   Try again
                </Button>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Actions */}
      <div className="p-4 space-y-2 border-t pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
        {aiResult && !isAnalyzing && (
          <Button className="w-full h-12" onClick={handleConfirm}>
            <ChevronRight className="h-4 w-4 mr-2" />
            {aiResult.confidence >= 0.7
              ? 'Use suggestion & continue'
              : 'Preview & correct'}
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
