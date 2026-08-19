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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useTenant } from '@/context/TenantContext';
import { Loader2, Save, Star } from 'lucide-react';

interface CreatePropertyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editFmGuid?: string | null;
  onSaved: () => void;
}

interface ProfileOption {
  id: string;
  name: string;
  is_default: boolean;
}

interface FormData {
  fm_guid: string;
  name: string;
  latitude: string;
  longitude: string;
  api_profile_id: string; // '' means default / none
  tenant_id: string; // '' means unassigned
}

const EMPTY_FORM: FormData = {
  fm_guid: '',
  name: '',
  latitude: '',
  longitude: '',
  api_profile_id: '',
  tenant_id: '',
};

export default function CreatePropertyDialog({
  open,
  onOpenChange,
  editFmGuid,
  onSaved,
}: CreatePropertyDialogProps) {
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const { tenants, selectedTenantId } = useTenant();
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    fetchProfiles();
    if (editFmGuid) {
      loadExisting(editFmGuid);
    } else {
      // New buildings default to whichever customer is currently active.
      setForm({ ...EMPTY_FORM, tenant_id: selectedTenantId || '' });
    }
  }, [open, editFmGuid, selectedTenantId]);

  async function fetchProfiles() {
    const { data, error } = await supabase
      .from('api_profiles')
      .select('id, name, is_default')
      .order('is_default', { ascending: false })
      .order('name');
    if (error) {
      console.error('Failed to fetch API profiles:', error);
      toast({ title: 'Failed to load API profiles', description: error.message, variant: 'destructive' });
      return;
    }
    if (data) setProfiles(data);
  }

  async function loadExisting(fmGuid: string) {
    const { data, error } = await supabase
      .from('building_settings')
      .select('fm_guid, latitude, longitude, api_profile_id, tenant_id')
      .eq('fm_guid', fmGuid)
      .maybeSingle();

    if (error) {
      console.error('Failed to load property settings:', error);
      toast({ title: 'Failed to load property', description: error.message, variant: 'destructive' });
      return;
    }

    if (!data) return;

    const { data: asset, error: assetError } = await supabase
      .from('assets')
      .select('name')
      .eq('fm_guid', fmGuid)
      .eq('category', 'Building')
      .maybeSingle();

    if (assetError) {
      console.error('Failed to load property name:', assetError);
      toast({ title: 'Failed to load property name', description: assetError.message, variant: 'destructive' });
    }

    setForm({
      fm_guid: data.fm_guid,
      name: asset?.name || '',
      latitude: data.latitude?.toString() || '',
      longitude: data.longitude?.toString() || '',
      api_profile_id: data.api_profile_id || '',
      tenant_id: data.tenant_id || '',
    });
  }

  function set(field: keyof FormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
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
        api_profile_id: form.api_profile_id || null,
        tenant_id: form.tenant_id || null,
      };

      const { data: existing } = await supabase
        .from('building_settings')
        .select('id')
        .eq('fm_guid', form.fm_guid.trim())
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('building_settings')
          .update(settingsPayload)
          .eq('fm_guid', form.fm_guid.trim());
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('building_settings')
          .insert(settingsPayload);
        if (error) throw error;
      }

      if (form.name.trim()) {
        const { error: assetError } = await supabase.from('assets').upsert(
          {
            fm_guid: form.fm_guid.trim(),
            category: 'Building',
            name: form.name.trim(),
            building_fm_guid: form.fm_guid.trim(),
            synced_at: new Date().toISOString(),
          },
          { onConflict: 'fm_guid' }
        );
        if (assetError) throw assetError;
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

  const selectedProfile = profiles.find(p => p.id === form.api_profile_id);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{editFmGuid ? 'Edit Property' : 'Add Property'}</SheetTitle>
          <SheetDescription>
            Enter FM GUID and select an API Profile for credentials.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 mt-6">
          {/* Building Identity */}
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

          {/* Tenant (customer) Selector */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">Customer</h3>
            <p className="text-xs text-muted-foreground">
              Which customer this building belongs to. Determines what's visible when that customer is selected, and which Asset+/Senslinc credentials it uses by default.
            </p>
            <Select
              value={form.tenant_id || 'none'}
              onValueChange={(val) => set('tenant_id', val === 'none' ? '' : val)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a customer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {tenants.map(tn => (
                  <SelectItem key={tn.id} value={tn.id}>{tn.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* API Profile Selector */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">API Profile</h3>
            <p className="text-xs text-muted-foreground">
              Select which credential set this building uses for Geminus Plus, Geminus Premium, Geminus Base, and Ivion.
            </p>
            <Select
              value={form.api_profile_id || 'default'}
              onValueChange={(val) => set('api_profile_id', val === 'default' ? '' : val)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a profile" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="flex items-center gap-2">
                      {p.is_default && <Star className="h-3 w-3 text-amber-500 fill-amber-500" />}
                      {p.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              Manage profiles in Settings → API Profiles tab.
            </p>
          </div>

          {/* Save */}
          <div className="flex gap-3 pt-2">
            <Button onClick={handleSave} disabled={saving} className="flex-1">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
