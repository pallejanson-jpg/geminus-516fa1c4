import React, { useState, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Eye, EyeOff, Save, TestTube } from 'lucide-react';

interface CreatePropertyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editFmGuid?: string | null;
  onSaved: () => void;
}

interface FormData {
  fm_guid: string;
  name: string;
  latitude: string;
  longitude: string;
  // Asset+ overrides
  assetplus_api_url: string;
  assetplus_api_key: string;
  assetplus_keycloak_url: string;
  assetplus_client_id: string;
  assetplus_client_secret: string;
  assetplus_username: string;
  assetplus_password: string;
  // Senslinc overrides
  senslinc_api_url: string;
  senslinc_email: string;
  senslinc_password: string;
}

const EMPTY_FORM: FormData = {
  fm_guid: '',
  name: '',
  latitude: '',
  longitude: '',
  assetplus_api_url: '',
  assetplus_api_key: '',
  assetplus_keycloak_url: '',
  assetplus_client_id: '',
  assetplus_client_secret: '',
  assetplus_username: '',
  assetplus_password: '',
  senslinc_api_url: '',
  senslinc_email: '',
  senslinc_password: '',
};

export default function CreatePropertyDialog({
  open,
  onOpenChange,
  editFmGuid,
  onSaved,
}: CreatePropertyDialogProps) {
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [testingAp, setTestingAp] = useState(false);
  const [testingSl, setTestingSl] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    if (editFmGuid) {
      loadExisting(editFmGuid);
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, editFmGuid]);

  async function loadExisting(fmGuid: string) {
    const { data } = await supabase
      .from('building_settings')
      .select('*')
      .eq('fm_guid', fmGuid)
      .maybeSingle();

    if (!data) return;

    // Get building name from assets table
    const { data: asset } = await supabase
      .from('assets')
      .select('name')
      .eq('fm_guid', fmGuid)
      .eq('category', 'Building')
      .maybeSingle();

    setForm({
      fm_guid: data.fm_guid,
      name: asset?.name || '',
      latitude: data.latitude?.toString() || '',
      longitude: data.longitude?.toString() || '',
      assetplus_api_url: (data as any).assetplus_api_url || '',
      assetplus_api_key: (data as any).assetplus_api_key || '',
      assetplus_keycloak_url: (data as any).assetplus_keycloak_url || '',
      assetplus_client_id: (data as any).assetplus_client_id || '',
      assetplus_client_secret: (data as any).assetplus_client_secret || '',
      assetplus_username: (data as any).assetplus_username || '',
      assetplus_password: (data as any).assetplus_password || '',
      senslinc_api_url: (data as any).senslinc_api_url || '',
      senslinc_email: (data as any).senslinc_email || '',
      senslinc_password: (data as any).senslinc_password || '',
    });
  }

  function set(field: keyof FormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function toggleSecret(field: string) {
    setShowSecrets((prev) => ({ ...prev, [field]: !prev[field] }));
  }

  async function handleSave() {
    if (!form.fm_guid.trim()) {
      toast({ title: 'FM GUID is required', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const settingsPayload: Record<string, any> = {
        fm_guid: form.fm_guid.trim(),
        latitude: form.latitude ? parseFloat(form.latitude) : null,
        longitude: form.longitude ? parseFloat(form.longitude) : null,
        assetplus_api_url: form.assetplus_api_url || null,
        assetplus_api_key: form.assetplus_api_key || null,
        assetplus_keycloak_url: form.assetplus_keycloak_url || null,
        assetplus_client_id: form.assetplus_client_id || null,
        assetplus_client_secret: form.assetplus_client_secret || null,
        assetplus_username: form.assetplus_username || null,
        assetplus_password: form.assetplus_password || null,
        senslinc_api_url: form.senslinc_api_url || null,
        senslinc_email: form.senslinc_email || null,
        senslinc_password: form.senslinc_password || null,
      };

      // Check if row exists
      const { data: existing } = await supabase
        .from('building_settings')
        .select('id')
        .eq('fm_guid', form.fm_guid.trim())
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('building_settings')
          .update(settingsPayload as any)
          .eq('fm_guid', form.fm_guid.trim());
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('building_settings')
          .insert(settingsPayload as any);
        if (error) throw error;
      }

      // Also upsert a Building asset row if name is provided
      if (form.name.trim()) {
        await supabase.from('assets').upsert(
          {
            fm_guid: form.fm_guid.trim(),
            category: 'Building',
            name: form.name.trim(),
            building_fm_guid: form.fm_guid.trim(),
            synced_at: new Date().toISOString(),
          },
          { onConflict: 'fm_guid' }
        );
      }

      toast({ title: 'Property saved' });
      window.dispatchEvent(new Event('building-settings-changed'));
      onSaved();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Error saving', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function testAssetPlus() {
    setTestingAp(true);
    try {
      const { data, error } = await supabase.functions.invoke('asset-plus-query', {
        body: { action: 'getToken', buildingFmGuid: form.fm_guid || undefined },
      });
      if (error) throw error;
      if (data?.accessToken) {
        toast({ title: 'Asset+ connection OK ✓' });
      } else {
        toast({ title: 'Asset+ auth failed', variant: 'destructive' });
      }
    } catch (err: any) {
      toast({ title: 'Asset+ test failed', description: err.message, variant: 'destructive' });
    } finally {
      setTestingAp(false);
    }
  }

  async function testSenslinc() {
    setTestingSl(true);
    try {
      const { data, error } = await supabase.functions.invoke('senslinc-query', {
        body: { action: 'test-connection', buildingFmGuid: form.fm_guid || undefined },
      });
      if (error) throw error;
      if (data?.success) {
        toast({ title: 'Senslinc connection OK ✓' });
      } else {
        toast({ title: 'Senslinc failed', description: data?.error, variant: 'destructive' });
      }
    } catch (err: any) {
      toast({ title: 'Senslinc test failed', description: err.message, variant: 'destructive' });
    } finally {
      setTestingSl(false);
    }
  }

  function SecretInput({
    label,
    field,
    placeholder,
  }: {
    label: string;
    field: keyof FormData;
    placeholder?: string;
  }) {
    const isSecret = field.includes('password') || field.includes('secret') || field.includes('api_key');
    const shown = showSecrets[field] || !isSecret;
    return (
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <div className="relative">
          <Input
            type={shown ? 'text' : 'password'}
            value={form[field]}
            onChange={(e) => set(field, e.target.value)}
            placeholder={placeholder}
            className="pr-8 text-sm"
          />
          {isSecret && (
            <button
              type="button"
              onClick={() => toggleSecret(field)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{editFmGuid ? 'Edit Property' : 'Add Property'}</SheetTitle>
          <SheetDescription>
            Enter FM GUID and optional API credentials to fetch data from other instances.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 mt-6">
          {/* Section 1: Building Identity */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Building Identity</h3>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">FM GUID *</Label>
              <Input
                value={form.fm_guid}
                onChange={(e) => set('fm_guid', e.target.value)}
                placeholder="a8fe5835-e293-4ba3-..."
                disabled={!!editFmGuid}
                className="text-sm font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Kontorshus Centrum"
                className="text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Latitude</Label>
                <Input
                  type="number"
                  step="any"
                  value={form.latitude}
                  onChange={(e) => set('latitude', e.target.value)}
                  placeholder="59.3293"
                  className="text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Longitude</Label>
                <Input
                  type="number"
                  step="any"
                  value={form.longitude}
                  onChange={(e) => set('longitude', e.target.value)}
                  placeholder="18.0686"
                  className="text-sm"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Custom API Credentials */}
          <Accordion type="multiple" className="w-full">
            <AccordionItem value="assetplus">
              <AccordionTrigger className="text-sm font-semibold">
                Asset+ — Custom Credentials
              </AccordionTrigger>
              <AccordionContent className="space-y-3 pt-2">
                <p className="text-xs text-muted-foreground">
                  Leave empty to use global settings.
                </p>
                <SecretInput label="API URL" field="assetplus_api_url" placeholder="https://..." />
                <SecretInput label="API Key" field="assetplus_api_key" />
                <SecretInput label="Keycloak URL" field="assetplus_keycloak_url" placeholder="https://..." />
                <SecretInput label="Client ID" field="assetplus_client_id" />
                <SecretInput label="Client Secret" field="assetplus_client_secret" />
                <SecretInput label="Username" field="assetplus_username" />
                <SecretInput label="Password" field="assetplus_password" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={testAssetPlus}
                  disabled={testingAp || !form.fm_guid}
                >
                  {testingAp ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <TestTube className="mr-2 h-3 w-3" />}
                  Testa anslutning
                </Button>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="senslinc">
              <AccordionTrigger className="text-sm font-semibold">
                Senslinc — Egna credentials
              </AccordionTrigger>
              <AccordionContent className="space-y-3 pt-2">
                <p className="text-xs text-muted-foreground">
                  Lämna tomt för att använda globala inställningar.
                </p>
                <SecretInput label="API URL" field="senslinc_api_url" placeholder="https://..." />
                <SecretInput label="E-post" field="senslinc_email" />
                <SecretInput label="Lösenord" field="senslinc_password" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={testSenslinc}
                  disabled={testingSl || !form.fm_guid}
                >
                  {testingSl ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <TestTube className="mr-2 h-3 w-3" />}
                  Testa anslutning
                </Button>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {/* Save */}
          <div className="flex gap-3 pt-2">
            <Button onClick={handleSave} disabled={saving} className="flex-1">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Spara
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Avbryt
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
