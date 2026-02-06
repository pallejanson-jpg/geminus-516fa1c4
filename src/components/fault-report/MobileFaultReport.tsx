import React, { useState, useId } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Loader2, Send, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import PhotoCapture from './PhotoCapture';
import type { FaultReportFormData } from './FaultReportForm';

const faultReportSchema = z.object({
  description: z.string().trim().min(1, 'Beskrivning krävs').max(2000, 'Max 2000 tecken'),
  errorCode: z.string().trim().max(100, 'Max 100 tecken').optional().or(z.literal('')),
  email: z.string().trim().max(255).optional().or(z.literal('')).refine(
    (val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
    { message: 'Ogiltig e-postadress' }
  ),
  phone: z.string().trim().max(20, 'Max 20 tecken').optional().or(z.literal('')),
});

interface MobileFaultReportProps {
  buildingName?: string;
  spaceName?: string;
  installationNumber?: string;
  assetName?: string;
  onSubmit: (data: FaultReportFormData, photos: string[]) => Promise<void>;
  isSubmitting: boolean;
  onBack?: () => void;
}

const MobileFaultReport: React.FC<MobileFaultReportProps> = ({
  buildingName,
  spaceName,
  installationNumber,
  assetName,
  onSubmit,
  isSubmitting,
  onBack,
}) => {
  const [photos, setPhotos] = useState<string[]>([]);
  const workOrderId = useId().replace(/:/g, '');

  const form = useForm<FaultReportFormData>({
    resolver: zodResolver(faultReportSchema),
    defaultValues: {
      description: '',
      errorCode: '',
      email: '',
      phone: '',
    },
  });

  const handleSubmit = (data: FaultReportFormData) => {
    onSubmit(data, photos);
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-border">
        {onBack && (
          <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold">Anmäl fel</h1>
        </div>
      </div>

      {/* Scrollable content */}
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(handleSubmit)}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {/* Installation info box */}
            {(installationNumber || assetName || buildingName) && (
              <div className="rounded-md bg-muted/60 border border-border p-3 mt-4">
                <div className="flex items-start gap-2">
                  <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="space-y-0.5 min-w-0">
                    {(installationNumber || assetName) && (
                      <p className="text-sm font-medium">
                        {installationNumber && (
                          <span className="font-mono">{installationNumber}</span>
                        )}
                        {installationNumber && assetName && ' — '}
                        {assetName}
                      </p>
                    )}
                    {(buildingName || spaceName) && (
                      <p className="text-xs text-muted-foreground">
                        {buildingName}
                        {spaceName && ` — ${spaceName}`}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-4 mt-4">
              {/* Description */}
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Beskrivning *</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Beskriv felet så tydligt du kan för att underlätta processen för alla involverade personer"
                        rows={4}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Error code */}
              <FormField
                control={form.control}
                name="errorCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Felkod</FormLabel>
                    <FormControl>
                      <Input placeholder="Ange en matchande felkod" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Email */}
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Återkoppling via e-post</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="Fyll i e-post om du vill ha återkoppling"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Phone */}
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Kontakt, telefonnummer</FormLabel>
                    <FormControl>
                      <Input
                        type="tel"
                        placeholder="Fyll i telefonnummer om du vill bli kontaktad"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Photos */}
              <div className="space-y-2">
                <Label>Bifoga bilder</Label>
                <PhotoCapture
                  photos={photos}
                  onPhotosChange={setPhotos}
                  workOrderId={workOrderId}
                />
              </div>
            </div>
          </div>

          {/* Submit button */}
          <div className="p-4 border-t border-border">
            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full"
              size="lg"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Skicka felanmälan
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
};

export default MobileFaultReport;
