import React, { useState, useId } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, ArrowRight, MapPin, Loader2, Send, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import PhotoCapture from './PhotoCapture';

const CATEGORIES = [
  { value: 'el', label: 'El' },
  { value: 'vvs', label: 'VVS' },
  { value: 'hiss', label: 'Hiss' },
  { value: 'bygg', label: 'Bygg' },
  { value: 'ventilation', label: 'Ventilation' },
  { value: 'stad', label: 'Städ/Rent' },
  { value: 'ovrigt', label: 'Övrigt' },
];

const PRIORITIES = [
  { value: 'low', label: 'Låg' },
  { value: 'medium', label: 'Medel' },
  { value: 'high', label: 'Hög' },
  { value: 'critical', label: 'Kritisk' },
];

const faultReportSchema = z.object({
  title: z.string().trim().min(1, 'Rubrik krävs').max(200, 'Max 200 tecken'),
  description: z.string().trim().min(1, 'Beskrivning krävs').max(2000, 'Max 2000 tecken'),
  category: z.string().min(1, 'Välj en kategori'),
  priority: z.string().default('medium'),
  reporterName: z.string().trim().min(1, 'Namn krävs').max(100, 'Max 100 tecken'),
  reporterEmail: z.string().trim().email('Ogiltig e-postadress').max(255),
  reporterPhone: z.string().trim().max(20).optional().or(z.literal('')),
});

type FaultReportFormData = z.infer<typeof faultReportSchema>;

interface MobileFaultReportProps {
  buildingName?: string;
  spaceName?: string;
  onSubmit: (data: FaultReportFormData, photos: string[]) => Promise<void>;
  isSubmitting: boolean;
  onBack?: () => void;
}

const STEPS = ['Felinformation', 'Foto', 'Kontakt'];

const MobileFaultReport: React.FC<MobileFaultReportProps> = ({
  buildingName,
  spaceName,
  onSubmit,
  isSubmitting,
  onBack,
}) => {
  const [step, setStep] = useState(0);
  const [photos, setPhotos] = useState<string[]>([]);
  const workOrderId = useId().replace(/:/g, '');

  const form = useForm<FaultReportFormData>({
    resolver: zodResolver(faultReportSchema),
    defaultValues: {
      title: '',
      description: '',
      category: '',
      priority: 'medium',
      reporterName: '',
      reporterEmail: '',
      reporterPhone: '',
    },
  });

  const canProceedStep0 = () => {
    const { category, title, description } = form.getValues();
    return category.length > 0 && title.trim().length > 0 && description.trim().length > 0;
  };

  const canProceedStep2 = () => {
    const { reporterName, reporterEmail } = form.getValues();
    return reporterName.trim().length > 0 && reporterEmail.trim().length > 0;
  };

  const handleNext = async () => {
    if (step === 0) {
      const valid = await form.trigger(['category', 'title', 'description', 'priority']);
      if (valid) setStep(1);
    } else if (step === 1) {
      setStep(2);
    }
  };

  const handleSubmit = (data: FaultReportFormData) => {
    onSubmit(data, photos);
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-border">
        <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold">Felanmälan</h1>
          {(buildingName || spaceName) && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground truncate">
              <MapPin className="h-3 w-3 text-primary shrink-0" />
              <span className="truncate">
                {buildingName}
                {spaceName && ` — ${spaceName}`}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1 px-4 py-3">
        {STEPS.map((label, i) => (
          <div key={label} className="flex-1 flex flex-col items-center gap-1">
            <div
              className={`h-1.5 w-full rounded-full transition-colors ${
                i <= step ? 'bg-primary' : 'bg-muted'
              }`}
            />
            <span className={`text-[10px] ${i <= step ? 'text-foreground' : 'text-muted-foreground'}`}>
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* Form content */}
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(handleSubmit)}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {/* Step 0: Fault information */}
            {step === 0 && (
              <div className="space-y-4 pt-2">
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Kategori *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Välj kategori..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {CATEGORIES.map((cat) => (
                            <SelectItem key={cat.value} value={cat.value}>
                              {cat.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Rubrik *</FormLabel>
                      <FormControl>
                        <Input placeholder="Kort beskrivning av felet..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Beskrivning *</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Beskriv felet i detalj..."
                          rows={4}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Prioritet</FormLabel>
                      <div className="flex gap-1.5">
                        {PRIORITIES.map((p) => (
                          <Button
                            key={p.value}
                            type="button"
                            variant={field.value === p.value ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => field.onChange(p.value)}
                            className="flex-1 text-xs"
                          >
                            {p.label}
                          </Button>
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {/* Step 1: Photos */}
            {step === 1 && (
              <div className="space-y-4 pt-2">
                <div>
                  <Label className="text-base font-medium">Ta foto av felet</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Lägg till upp till 3 foton (valfritt)
                  </p>
                </div>
                <PhotoCapture
                  photos={photos}
                  onPhotosChange={setPhotos}
                  workOrderId={workOrderId}
                />
              </div>
            )}

            {/* Step 2: Contact info */}
            {step === 2 && (
              <div className="space-y-4 pt-2">
                <FormField
                  control={form.control}
                  name="reporterName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ditt namn *</FormLabel>
                      <FormControl>
                        <Input placeholder="Förnamn Efternamn" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="reporterEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>E-post *</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="din@epost.se" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="reporterPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Telefon</FormLabel>
                      <FormControl>
                        <Input type="tel" placeholder="070-123 45 67" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}
          </div>

          {/* Bottom navigation */}
          <div className="p-4 border-t border-border flex gap-2">
            {step > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(step - 1)}
                className="flex-1"
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Tillbaka
              </Button>
            )}

            {step === 0 && (
              <Button
                type="button"
                onClick={handleNext}
                disabled={!canProceedStep0()}
                className="flex-1"
              >
                Nästa
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            )}

            {step === 1 && (
              <Button type="button" onClick={handleNext} className="flex-1">
                {photos.length === 0 ? (
                  <>
                    Hoppa över
                    <SkipForward className="h-4 w-4 ml-1" />
                  </>
                ) : (
                  <>
                    Nästa
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </>
                )}
              </Button>
            )}

            {step === 2 && (
              <Button
                type="submit"
                disabled={isSubmitting}
                className="flex-1"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Skicka felanmälan
              </Button>
            )}
          </div>
        </form>
      </Form>
    </div>
  );
};

export default MobileFaultReport;
