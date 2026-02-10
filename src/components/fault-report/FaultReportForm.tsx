import React, { useState, useId } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormField, FormItem, FormControl, FormMessage } from '@/components/ui/form';
import PhotoCapture, { type PhotoData } from './PhotoCapture';
import FormFieldWithHelp from './FormFieldWithHelp';
import ClearableInput from './ClearableInput';
import ErrorCodeCombobox, { type ErrorCode } from './ErrorCodeCombobox';

const faultReportSchema = z.object({
  description: z.string().trim().min(1, 'Beskrivning krävs').max(2000, 'Max 2000 tecken'),
  errorCode: z.any().optional(),
  email: z.string().trim().max(255).optional().or(z.literal('')).refine(
    (val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
    { message: 'Ogiltig e-postadress' }
  ),
  phone: z.string().trim().max(20, 'Max 20 tecken').optional().or(z.literal('')),
});

export type FaultReportFormData = z.infer<typeof faultReportSchema>;

interface FaultReportFormProps {
  buildingName?: string;
  spaceName?: string;
  installationNumber?: string;
  assetName?: string;
  errorCodes?: ErrorCode[];
  onSubmit: (data: FaultReportFormData, photos: string[], photoData: PhotoData[]) => Promise<void>;
  isSubmitting: boolean;
}

const FaultReportForm: React.FC<FaultReportFormProps> = ({
  buildingName,
  spaceName,
  installationNumber,
  assetName,
  errorCodes,
  onSubmit,
  isSubmitting,
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
    <Card className="max-w-lg w-full mx-auto">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Anmäl fel</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Installation info */}
        {(installationNumber || assetName) && (
          <div className="rounded-md bg-muted/40 border border-border px-3 py-2 mb-5">
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

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
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
          </form>
        </Form>
      </CardContent>
    </Card>
  );
};

export default FaultReportForm;
