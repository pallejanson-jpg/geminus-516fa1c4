import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useTenant } from '@/context/TenantContext';
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
import { Plus, Edit2, Trash2, Save, Loader2, Eye, EyeOff, X, KeyRound, Building2 } from 'lucide-react';

interface TenantRow {
  id: string;
  name: string;
}

interface CredentialsForm {
  geminus_plus_api_url: string;
  geminus_plus_api_key: string;
  geminus_plus_keycloak_url: string;
  geminus_plus_client_id: string;
  geminus_plus_client_secret: string;
  geminus_plus_username: string;
  geminus_plus_password: string;
  geminus_plus_audience: string;
  geminus_premium_api_url: string;
  geminus_premium_email: string;
  geminus_premium_password: string;
}

const EMPTY_CREDENTIALS: CredentialsForm = {
  geminus_plus_api_url: '', geminus_plus_api_key: '', geminus_plus_keycloak_url: '',
  geminus_plus_client_id: '', geminus_plus_client_secret: '',
  geminus_plus_username: '', geminus_plus_password: '', geminus_plus_audience: '',
  geminus_premium_api_url: '', geminus_premium_email: '', geminus_premium_password: '',
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

/**
 * Admin panel for managing customers (tenants). Each tenant gets its own
 * Asset+/Senslinc credential set (an api_profiles row keyed by tenant_id)
 * that automatically covers every building assigned to that tenant —
 * see CreatePropertyDialog / CreateBuildingPanel for where buildings get tagged.
 */
export default function TenantsManager() {
  const { tenants, refreshTenants, isLoadingTenants } = useTenant();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [credentialsTenantId, setCredentialsTenantId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => { refreshTenants(); }, [refreshTenants]);

  async function handleCreate() {
    if (!newName.trim()) {
      toast({ title: 'Customer name is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('tenants').insert({ name: newName.trim() });
      if (error) throw error;
      toast({ title: 'Customer created' });
      setCreating(false);
      setNewName('');
      refreshTenants();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handleRename(id: string) {
    if (!renameValue.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('tenants').update({ name: renameValue.trim() }).eq('id', id);
      if (error) throw error;
      setRenamingId(null);
      refreshTenants();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const { error } = await supabase.from('tenants').delete().eq('id', deleteId);
      if (error) throw error;
      toast({ title: 'Customer deleted' });
      refreshTenants();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setDeleteId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Customers (tenants)</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Each customer gets its own buildings and its own Asset+/Senslinc credentials, shared across all of that customer's buildings.
          </p>
        </div>
        {!creating && (
          <Button size="sm" onClick={() => setCreating(true)} className="gap-1">
            <Plus className="h-3.5 w-3.5" />
            New Customer
          </Button>
        )}
      </div>

      {creating && (
        <Card className="p-3 space-y-3">
          <Label className="text-xs text-muted-foreground">Customer name</Label>
          <Input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="e.g. Locum, TU Dublin"
            className="text-sm"
            autoFocus
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleCreate} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
              Create
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setCreating(false); setNewName(''); }}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {isLoadingTenants ? (
        <div className="text-sm text-muted-foreground py-4">Loading...</div>
      ) : tenants.length === 0 ? (
        <div className="text-sm text-muted-foreground py-4">No customers yet.</div>
      ) : (
        <div className="space-y-2">
          {tenants.map((tenant: TenantRow) => (
            <Card key={tenant.id} className="p-3">
              {renamingId === tenant.id ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    className="text-sm h-8"
                    autoFocus
                  />
                  <Button size="sm" onClick={() => handleRename(tenant.id)} disabled={saving}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setRenamingId(null)}>Cancel</Button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium">{tenant.name}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 text-xs"
                      onClick={() => setCredentialsTenantId(credentialsTenantId === tenant.id ? null : tenant.id)}
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      Credentials
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => { setRenamingId(tenant.id); setRenameValue(tenant.name); }}
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => setDeleteId(tenant.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}

              {credentialsTenantId === tenant.id && (
                <div className="mt-3 pt-3 border-t border-border">
                  <TenantCredentialsEditor tenantId={tenant.id} />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete customer?</AlertDialogTitle>
            <AlertDialogDescription>
              Buildings assigned to this customer will become unassigned (they'll need a new customer before they show up again). Its credential profile will be deleted.
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

/** Inline editor for a single tenant's api_profiles row (Asset+/Senslinc credentials). */
function TenantCredentialsEditor({ tenantId }: { tenantId: string }) {
  const [profileId, setProfileId] = useState<string | null>(null);
  const [form, setForm] = useState<CredentialsForm>(EMPTY_CREDENTIALS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('api_profiles')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        const row = data;
        setProfileId(row.id);
        setForm({
          geminus_plus_api_url: row.geminus_plus_api_url || '',
          geminus_plus_api_key: row.geminus_plus_api_key || '',
          geminus_plus_keycloak_url: row.geminus_plus_keycloak_url || '',
          geminus_plus_client_id: row.geminus_plus_client_id || '',
          geminus_plus_client_secret: row.geminus_plus_client_secret || '',
          geminus_plus_username: row.geminus_plus_username || '',
          geminus_plus_password: row.geminus_plus_password || '',
          geminus_plus_audience: row.geminus_plus_audience || '',
          geminus_premium_api_url: row.geminus_premium_api_url || '',
          geminus_premium_email: row.geminus_premium_email || '',
          geminus_premium_password: row.geminus_premium_password || '',
        });
      } else {
        setProfileId(null);
        setForm(EMPTY_CREDENTIALS);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  function set(field: keyof CredentialsForm, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function toggleSecret(field: string) {
    setShowSecrets(prev => ({ ...prev, [field]: !prev[field] }));
  }

  function renderSecretField(label: string, field: keyof CredentialsForm, placeholder?: string) {
    const isSecret = field.includes('password') || field.includes('secret') || field.includes('api_key');
    return (
      <SecretInput
        key={field}
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

  async function handleSave() {
    setSaving(true);
    try {
      const payload: Record<string, any> = { ...form, tenant_id: tenantId };
      for (const key of Object.keys(payload)) {
        if (payload[key] === '') payload[key] = null;
      }

      if (profileId) {
        const { error } = await supabase.from('api_profiles').update(payload).eq('id', profileId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('api_profiles')
          .insert({ ...payload, name: `Tenant credentials (${tenantId.slice(0, 8)})` })
          .select('id')
          .single();
        if (error) throw error;
        setProfileId(data.id);
      }
      toast({ title: 'Credentials saved' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-xs text-muted-foreground py-2">Loading credentials...</div>;
  }

  return (
    <div className="space-y-3">
      <Accordion type="multiple" className="w-full min-w-0">
        <AccordionItem value="geminus-plus">
          <AccordionTrigger className="text-xs font-semibold">Geminus Plus (Asset+) Credentials</AccordionTrigger>
          <AccordionContent className="space-y-3 pt-2">
            {renderSecretField('API URL', 'geminus_plus_api_url', 'https://...')}
            {renderSecretField('API Key', 'geminus_plus_api_key')}
            {renderSecretField('Keycloak URL (incl. realm)', 'geminus_plus_keycloak_url', 'https://sso.example.com/realms/AssetDB')}
            {renderSecretField('Client ID', 'geminus_plus_client_id')}
            {renderSecretField('Client Secret', 'geminus_plus_client_secret')}
            {renderSecretField('Username', 'geminus_plus_username')}
            {renderSecretField('Password', 'geminus_plus_password')}
            {renderSecretField('Audience', 'geminus_plus_audience', 'asset-api')}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="geminus-premium">
          <AccordionTrigger className="text-xs font-semibold">Geminus Premium (Senslinc) Credentials</AccordionTrigger>
          <AccordionContent className="space-y-3 pt-2">
            {renderSecretField('API URL', 'geminus_premium_api_url', 'https://...')}
            {renderSecretField('Email', 'geminus_premium_email')}
            {renderSecretField('Password', 'geminus_premium_password')}
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <Button size="sm" onClick={handleSave} disabled={saving}>
        {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
        Save credentials
      </Button>
    </div>
  );
}
