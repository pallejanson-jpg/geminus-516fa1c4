import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Plus, Edit2, Trash2, Save, Star, Loader2, Eye, EyeOff,
  CheckCircle2, TestTube, X
} from 'lucide-react';

interface ApiProfile {
  id: string;
  name: string;
  is_default: boolean;
  assetplus_api_url: string | null;
  assetplus_api_key: string | null;
  assetplus_keycloak_url: string | null;
  assetplus_client_id: string | null;
  assetplus_client_secret: string | null;
  assetplus_username: string | null;
  assetplus_password: string | null;
  senslinc_api_url: string | null;
  senslinc_email: string | null;
  senslinc_password: string | null;
  fm_access_api_url: string | null;
  fm_access_username: string | null;
  fm_access_password: string | null;
  ivion_api_url: string | null;
  ivion_username: string | null;
  ivion_password: string | null;
}

type ProfileForm = Omit<ApiProfile, 'id' | 'is_default'>;

const EMPTY_FORM: ProfileForm = {
  name: '',
  assetplus_api_url: '', assetplus_api_key: '', assetplus_keycloak_url: '',
  assetplus_client_id: '', assetplus_client_secret: '',
  assetplus_username: '', assetplus_password: '',
  senslinc_api_url: '', senslinc_email: '', senslinc_password: '',
  fm_access_api_url: '', fm_access_username: '', fm_access_password: '',
  ivion_api_url: '', ivion_username: '', ivion_password: '',
};

function SecretInput({ label, value, onChange, placeholder, isSecret, shown, onToggleSecret }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
  isSecret: boolean; shown: boolean; onToggleSecret: () => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="relative">
        <Input
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="pr-8 text-sm"
        />
        {isSecret && (
          <button
            type="button"
            onClick={onToggleSecret}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

export default function ApiProfilesManager() {
  const [profiles, setProfiles] = useState<ApiProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [testingAp, setTestingAp] = useState(false);
  const [testingSl, setTestingSl] = useState(false);
  const { toast } = useToast();

  async function fetchProfiles() {
    setLoading(true);
    const { data, error } = await supabase
      .from('api_profiles' as any)
      .select('*')
      .order('is_default', { ascending: false })
      .order('name');
    if (!error && data) setProfiles(data as any[]);
    setLoading(false);
  }

  useEffect(() => { fetchProfiles(); }, []);

  function startCreate() {
    setCreating(true);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  function startEdit(profile: ApiProfile) {
    setEditingId(profile.id);
    setCreating(false);
    setForm({
      name: profile.name,
      assetplus_api_url: profile.assetplus_api_url || '',
      assetplus_api_key: profile.assetplus_api_key || '',
      assetplus_keycloak_url: profile.assetplus_keycloak_url || '',
      assetplus_client_id: profile.assetplus_client_id || '',
      assetplus_client_secret: profile.assetplus_client_secret || '',
      assetplus_username: profile.assetplus_username || '',
      assetplus_password: profile.assetplus_password || '',
      senslinc_api_url: profile.senslinc_api_url || '',
      senslinc_email: profile.senslinc_email || '',
      senslinc_password: profile.senslinc_password || '',
      fm_access_api_url: profile.fm_access_api_url || '',
      fm_access_username: profile.fm_access_username || '',
      fm_access_password: profile.fm_access_password || '',
      ivion_api_url: profile.ivion_api_url || '',
      ivion_username: profile.ivion_username || '',
      ivion_password: profile.ivion_password || '',
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setCreating(false);
    setForm(EMPTY_FORM);
  }

  function set(field: keyof ProfileForm, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function toggleSecret(field: string) {
    setShowSecrets(prev => ({ ...prev, [field]: !prev[field] }));
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast({ title: 'Profile name is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, any> = { ...form };
      // Convert empty strings to null
      for (const key of Object.keys(payload)) {
        if (payload[key] === '') payload[key] = null;
      }
      payload.name = form.name.trim();

      if (editingId) {
        const { error } = await supabase
          .from('api_profiles' as any)
          .update(payload)
          .eq('id', editingId);
        if (error) throw error;
        toast({ title: 'Profile updated' });
      } else {
        const { error } = await supabase
          .from('api_profiles' as any)
          .insert(payload);
        if (error) throw error;
        toast({ title: 'Profile created' });
      }
      cancelEdit();
      fetchProfiles();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const { error } = await supabase
        .from('api_profiles' as any)
        .delete()
        .eq('id', deleteId);
      if (error) throw error;
      toast({ title: 'Profile deleted' });
      fetchProfiles();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setDeleteId(null);
    }
  }

  async function testAssetPlus() {
    setTestingAp(true);
    try {
      // We test by invoking asset-plus-query with profile credentials
      // For now, just verify credentials are filled
      if (!form.assetplus_api_url || !form.assetplus_keycloak_url) {
        toast({ title: 'Fill in Asset+ URL and Keycloak URL first', variant: 'destructive' });
        return;
      }
      toast({ title: 'Asset+ credentials configured ✓', description: 'Save the profile and assign it to a building to test the full connection.' });
    } finally {
      setTestingAp(false);
    }
  }

  async function testSenslinc() {
    setTestingSl(true);
    try {
      if (!form.senslinc_api_url) {
        toast({ title: 'Fill in Senslinc API URL first', variant: 'destructive' });
        return;
      }
      toast({ title: 'Senslinc credentials configured ✓', description: 'Save the profile and assign it to a building to test the full connection.' });
    } finally {
      setTestingSl(false);
    }
  }

  function SI({ label, field, placeholder }: { label: string; field: keyof ProfileForm; placeholder?: string }) {
    const isSecret = field.includes('password') || field.includes('secret') || field.includes('api_key');
    return (
      <SecretInput
        label={label}
        value={form[field] || ''}
        onChange={v => set(field, v)}
        placeholder={placeholder}
        isSecret={isSecret}
        shown={showSecrets[field] || !isSecret}
        onToggleSecret={() => toggleSecret(field)}
      />
    );
  }

  const isEditing = !!editingId || creating;

  if (isEditing) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            {creating ? 'New API Profile' : 'Edit API Profile'}
          </h3>
          <Button variant="ghost" size="icon" onClick={cancelEdit}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Profile Name *</Label>
          <Input
            value={form.name}
            onChange={e => set('name', e.target.value)}
            placeholder="e.g. Customer X Production"
            className="text-sm"
          />
        </div>

        <Accordion type="multiple" className="w-full">
          <AccordionItem value="assetplus">
            <AccordionTrigger className="text-xs font-semibold">Asset+ Credentials</AccordionTrigger>
            <AccordionContent className="space-y-3 pt-2">
              <SecretInput label="API URL" field="assetplus_api_url" placeholder="https://..." />
              <SecretInput label="API Key" field="assetplus_api_key" />
              <SecretInput label="Keycloak URL" field="assetplus_keycloak_url" placeholder="https://..." />
              <SecretInput label="Client ID" field="assetplus_client_id" />
              <SecretInput label="Client Secret" field="assetplus_client_secret" />
              <SecretInput label="Username" field="assetplus_username" />
              <SecretInput label="Password" field="assetplus_password" />
              <Button variant="outline" size="sm" onClick={testAssetPlus} disabled={testingAp}>
                {testingAp ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <TestTube className="mr-2 h-3 w-3" />}
                Validate
              </Button>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="senslinc">
            <AccordionTrigger className="text-xs font-semibold">InUse/Senslinc Credentials</AccordionTrigger>
            <AccordionContent className="space-y-3 pt-2">
              <SecretInput label="API URL" field="senslinc_api_url" placeholder="https://..." />
              <SecretInput label="Email" field="senslinc_email" />
              <SecretInput label="Password" field="senslinc_password" />
              <Button variant="outline" size="sm" onClick={testSenslinc} disabled={testingSl}>
                {testingSl ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <TestTube className="mr-2 h-3 w-3" />}
                Validate
              </Button>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="fmaccess">
            <AccordionTrigger className="text-xs font-semibold">FM Access Credentials</AccordionTrigger>
            <AccordionContent className="space-y-3 pt-2">
              <SecretInput label="API URL" field="fm_access_api_url" placeholder="https://..." />
              <SecretInput label="Username" field="fm_access_username" />
              <SecretInput label="Password" field="fm_access_password" />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="ivion">
            <AccordionTrigger className="text-xs font-semibold">Ivion Credentials</AccordionTrigger>
            <AccordionContent className="space-y-3 pt-2">
              <SecretInput label="API URL" field="ivion_api_url" placeholder="https://..." />
              <SecretInput label="Username" field="ivion_username" />
              <SecretInput label="Password" field="ivion_password" />
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="flex gap-3 pt-2">
          <Button onClick={handleSave} disabled={saving} className="flex-1">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {creating ? 'Create Profile' : 'Save Changes'}
          </Button>
          <Button variant="outline" onClick={cancelEdit}>Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">API Profiles</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Named credential sets for different API environments. Assign a profile to each building.
          </p>
        </div>
        <Button size="sm" onClick={startCreate} className="gap-1">
          <Plus className="h-3.5 w-3.5" />
          New Profile
        </Button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground py-4">Loading...</div>
      ) : profiles.length === 0 ? (
        <div className="text-sm text-muted-foreground py-4">No profiles yet.</div>
      ) : (
        <div className="space-y-2">
          {profiles.map(profile => {
            const hasAp = !!profile.assetplus_api_url;
            const hasSl = !!profile.senslinc_api_url;
            const hasFma = !!profile.fm_access_api_url;
            const hasIv = !!profile.ivion_api_url;
            return (
              <Card key={profile.id} className="p-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      {profile.is_default && <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />}
                      <span className="text-sm font-medium">{profile.name}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {profile.is_default ? (
                        <Badge variant="outline" className="text-[9px]">Uses server env vars</Badge>
                      ) : (
                        <>
                          <Badge variant={hasAp ? 'default' : 'outline'} className="text-[9px]">
                            Asset+ {hasAp ? '✓' : '✗'}
                          </Badge>
                          <Badge variant={hasSl ? 'default' : 'outline'} className="text-[9px]">
                            Senslinc {hasSl ? '✓' : '✗'}
                          </Badge>
                          <Badge variant={hasFma ? 'default' : 'outline'} className="text-[9px]">
                            FM Access {hasFma ? '✓' : '✗'}
                          </Badge>
                          <Badge variant={hasIv ? 'default' : 'outline'} className="text-[9px]">
                            Ivion {hasIv ? '✓' : '✗'}
                          </Badge>
                        </>
                      )}
                    </div>
                  </div>
                  {!profile.is_default && (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(profile)}>
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteId(profile.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete API Profile?</AlertDialogTitle>
            <AlertDialogDescription>
              Buildings using this profile will fall back to default credentials.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
