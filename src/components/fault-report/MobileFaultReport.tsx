import React, { useState, useId } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Form, FormField, FormItem, FormControl, FormMessage } from '@/components/ui/form';
import PhotoCapture, { type PhotoData } from './PhotoCapture';
import FormFieldWithHelp from './FormFieldWithHelp';
import ClearableInput from './ClearableInput';
import ErrorCodeCombobox, { type ErrorCode } from './ErrorCodeCombobox';
import type { FaultReportFormData } from './FaultReportForm';

const faultReportSchema = z.object({
  description: z.string().trim().min(1, 'Beskrivning krävs').max(2000, 'Max 2000 tecken'),
  errorCode: z.any().optional(),
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
  errorCodes?: ErrorCode[];
  onSubmit: (data: FaultReportFormData, photos: string[], photoData: PhotoData[]) => Promise<void>;
  isSubmitting: boolean;
  onBack?: () => void;
}

const MobileFaultReport: React.FC<MobileFaultReportProps> = ({
  buildingName,
  spaceName,
  installationNumber,
  assetName,
  errorCodes,
  onSubmit,
  isSubmitting,
  onBack,
}) => {
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoData, setPhotoData] = useState<PhotoData[]>([]);
  const workOrderId = useId().replace(/:/g, '');

  const form = useForm<FaultReportFormData>({
    resolver: zodResolver(faultReportSchema),
    defaultValues: {
      description: '',
      errorCode: null,
      email: '',
      phone: '',
    },
  });

  const handleSubmit = (data: FaultReportFormData) => {
    onSubmit(data, photos, photoData);
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
            {/* Installation info */}
            {(installationNumber || assetName) && (
              <div className="rounded-md bg-muted/40 border border-border px-3 py-2 mt-4">
                <p className="text-sm">
                  <span className="text-muted-foreground">Installation</span>{' '}
                  {installationNumber && (
                    <span className="font-mono font-medium">{installationNumber}</span>
                  )}
                  {installationNumber && assetName && ' '}
                  {assetName && <span className="font-medium">{assetName}</span>}
                </p>
              </div>
            )}

            <div className="space-y-4 mt-4">
              {/* Description */}
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormFieldWithHelp
                      label="Beskrivning"
                      required
                      helpText="Beskriv felet så tydligt du kan för att underlätta processen för alla involverade personer."
                    />
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
                    <FormFieldWithHelp
                      label="Felkod"
                      helpText="Ange en matchande felkod om en sådan finns angiven på installationen."
                    />
                    <FormControl>
                      <ErrorCodeCombobox
                        value={field.value as ErrorCode | null}
                        onChange={field.onChange}
                        errorCodes={errorCodes}
                      />
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
                    <FormFieldWithHelp
                      label="Återkoppling via e-post"
                      helpText="Fyll i din e-postadress om du vill ha återkoppling om ärendet."
                    />
                    <FormControl>
                      <ClearableInput
                        type="email"
                        placeholder="Fyll i e-post om du vill ha återkoppling"
                        value={field.value || ''}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                        onClear={() => field.onChange('')}
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
                    <FormFieldWithHelp
                      label="Kontakt, telefonnummer"
                      helpText="Fyll i ditt telefonnummer om du vill bli kontaktad."
                    />
                    <FormControl>
                      <ClearableInput
                        type="tel"
                        placeholder="Fyll i telefonnummer om du vill bli kontaktad"
                        value={field.value || ''}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                        onClear={() => field.onChange('')}
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
                  onPhotoDataChange={setPhotoData}
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
              {isSubmitting && (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              )}
              Skicka
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
};

export default MobileFaultReport;
