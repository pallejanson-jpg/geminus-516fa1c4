import React, { useState, useId } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, MapPin, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

export type FaultReportFormData = z.infer<typeof faultReportSchema>;

interface FaultReportFormProps {
  buildingName?: string;
  spaceName?: string;
  onSubmit: (data: FaultReportFormData, photos: string[]) => Promise<void>;
  isSubmitting: boolean;
}

const FaultReportForm: React.FC<FaultReportFormProps> = ({
  buildingName,
  spaceName,
  onSubmit,
  isSubmitting,
}) => {
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

  const handleSubmit = (data: FaultReportFormData) => {
    onSubmit(data, photos);
  };

  return (
    <Card className="max-w-lg w-full mx-auto">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Felanmälan</CardTitle>
        {(buildingName || spaceName) && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 text-primary" />
            <span>
              {buildingName}
              {spaceName && ` — ${spaceName}`}
            </span>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            {/* Category */}
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

            {/* Title */}
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

            {/* Description */}
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

            {/* Priority */}
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

            {/* Photos */}
            <div className="space-y-2">
              <Label>Foto (valfritt)</Label>
              <PhotoCapture
                photos={photos}
                onPhotosChange={setPhotos}
                workOrderId={workOrderId}
              />
            </div>

            {/* Reporter info */}
            <div className="border-t pt-4 space-y-4">
              <p className="text-sm font-medium">Kontaktuppgifter</p>

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
          </form>
        </Form>
      </CardContent>
    </Card>
  );
};

export default FaultReportForm;
