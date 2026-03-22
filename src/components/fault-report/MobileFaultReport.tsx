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
import chicagoHero from '@/assets/chicago-skyline-hero.jpg';

const faultReportSchema = z.object({
  description: z.string().trim().min(1, 'Description is required').max(2000, 'Max 2000 characters'),
  errorCode: z.any().optional(),
  email: z.string().trim().max(255).optional().or(z.literal('')).refine(
    (val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
    { message: 'Invalid email address' }
  ),
  phone: z.string().trim().max(20, 'Max 20 characters').optional().or(z.literal('')),
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
    <div
      className="min-h-[100dvh] flex flex-col"
      style={{
        backgroundImage: `url(${chicagoHero})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center top',
      }}
    >
      {/* Gradient overlay + header area */}
      <div className="relative pt-[env(safe-area-inset-top)] bg-gradient-to-b from-black/50 via-black/30 to-transparent">
        <div className="flex items-center gap-3 px-4 py-4">
          {onBack && (
            <button
              onClick={onBack}
              className="h-9 w-9 flex items-center justify-center rounded-full bg-white/20 backdrop-blur-sm text-white"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold text-white drop-shadow-md">Report Fault</h1>
            {buildingName && (
              <p className="text-sm text-white/80 drop-shadow-sm truncate">{buildingName}{spaceName ? ` · ${spaceName}` : ''}</p>
            )}
          </div>
        </div>
      </div>

      {/* Spacer to push card down and show background */}
      <div className="flex-shrink-0 h-16" />

      {/* Form card with glassmorphism */}
      <div className="flex-1 flex flex-col bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-t-3xl shadow-2xl overflow-hidden">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="flex-1 flex flex-col overflow-hidden"
          >
            <div className="flex-1 overflow-y-auto px-5 pt-6 pb-4">
              {/* Installation badge */}
              {(installationNumber || assetName) && (
                <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 mb-5">
                  {installationNumber && (
                    <span className="text-xs font-mono font-semibold text-primary">{installationNumber}</span>
                  )}
                  {assetName && (
                    <span className="text-xs font-medium text-primary">{assetName}</span>
                  )}
                </div>
              )}

              <div className="space-y-5">
                {/* Description */}
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormFieldWithHelp
                        label="Description"
                        required
                        helpText="Describe the fault as clearly as possible to help all involved parties."
                      />
                      <FormControl>
                        <Textarea
                          placeholder="Describe the fault as clearly as possible..."
                          rows={4}
                          className="rounded-xl bg-muted/50 border-0 focus-visible:ring-1 text-base"
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
                        label="Error Code"
                        helpText="Enter a matching error code if one is specified on the installation."
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
                        label="Email for follow-up"
                        helpText="Enter your email if you want to receive updates on the case."
                      />
                      <FormControl>
                        <ClearableInput
                          type="email"
                          placeholder="Enter email for follow-up"
                          className="h-12 rounded-xl bg-muted/50 border-0 focus-visible:ring-1 text-base"
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
                          placeholder="Fyll i telefonnummer"
                          className="h-12 rounded-xl bg-muted/50 border-0 focus-visible:ring-1 text-base"
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

            {/* Sticky submit */}
            <div
              className="sticky bottom-0 p-4 bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl border-t border-border/50"
              style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
            >
              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-12 rounded-xl text-base font-semibold bg-gradient-to-r from-primary to-primary/80 shadow-lg"
                size="lg"
              >
                {isSubmitting && (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                )}
                Skicka felanmälan
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
};

export default MobileFaultReport;
