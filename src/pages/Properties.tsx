import { useState, useEffect, useCallback } from 'react';
import { Building2, MapPin, MoreVertical, Plus, Search, KeyRound, RefreshCw, Network } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import CreatePropertyDialog from '@/components/properties/CreatePropertyDialog';

interface PropertyRow {
  fmGuid: string;
  name: string | null;
  latitude: number | null;
  longitude: number | null;
  isFavorite: boolean;
  profileName: string | null;
  hasCustomAssetPlus: boolean;
  hasCustomSenslinc: boolean;
}

export default function Properties() {
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editFmGuid, setEditFmGuid] = useState<string | null>(null);

  const fetchProperties = useCallback(async () => {
    setLoading(true);
    try {
      const { data: settings, error } = await supabase
        .from('building_settings')
        .select('fm_guid, latitude, longitude, is_favorite, assetplus_api_url, senslinc_api_url, api_profile_id');

      if (error) throw error;

      // Fetch building names
      const fmGuids = (settings || []).map((s: any) => s.fm_guid);
      let nameMap: Record<string, string> = {};
      if (fmGuids.length > 0) {
        const { data: buildings } = await supabase
          .from('assets')
          .select('fm_guid, name')
          .eq('category', 'Building')
          .in('fm_guid', fmGuids);
        (buildings || []).forEach((b: any) => {
          nameMap[b.fm_guid] = b.name;
        });
      }

      // Fetch profile names
      const profileIds = [...new Set((settings || []).map((s: any) => s.api_profile_id).filter(Boolean))];
      let profileMap: Record<string, string> = {};
      if (profileIds.length > 0) {
        const { data: profiles } = await supabase
          .from('api_profiles' as any)
          .select('id, name')
          .in('id', profileIds);
        (profiles || []).forEach((p: any) => {
          profileMap[p.id] = p.name;
        });
      }

      const rows: PropertyRow[] = (settings || []).map((s: any) => ({
        fmGuid: s.fm_guid,
        name: nameMap[s.fm_guid] || null,
        latitude: s.latitude,
        longitude: s.longitude,
        isFavorite: s.is_favorite,
        profileName: s.api_profile_id ? (profileMap[s.api_profile_id] || null) : null,
        hasCustomAssetPlus: !!s.assetplus_api_url,
        hasCustomSenslinc: !!s.senslinc_api_url,
      }));

      setProperties(rows);
    } catch (err) {
      console.error('Failed to fetch properties:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProperties();
    const handler = () => fetchProperties();
    window.addEventListener('building-settings-changed', handler);
    return () => window.removeEventListener('building-settings-changed', handler);
  }, [fetchProperties]);

  const filtered = properties.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      p.fmGuid.toLowerCase().includes(q) ||
      (p.name && p.name.toLowerCase().includes(q))
    );
  });

  function openEdit(fmGuid: string) {
    setEditFmGuid(fmGuid);
    setDialogOpen(true);
  }

  function openCreate() {
    setEditFmGuid(null);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Properties</h1>
          <p className="text-muted-foreground">
            Manage your property portfolio and API connections
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={fetchProperties} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Add Property
          </Button>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search properties..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {properties.length === 0
            ? 'No properties configured. Click "Add Property" to get started.'
            : 'No results match your search.'}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((property) => (
            <Card
              key={property.fmGuid}
              className="group hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => openEdit(property.fmGuid)}
            >
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Building2 className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <CardTitle className="text-base truncate">
                      {property.name || property.fmGuid.slice(0, 12) + '…'}
                    </CardTitle>
                    <CardDescription className="text-xs font-mono truncate">
                      {property.fmGuid}
                    </CardDescription>
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openEdit(property.fmGuid)}>
                      Edit
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardHeader>
              <CardContent>
                {property.latitude && property.longitude && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                    <MapPin className="h-3 w-3" />
                    {property.latitude.toFixed(4)}, {property.longitude.toFixed(4)}
                  </p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {property.isFavorite && (
                    <Badge variant="default" className="text-[10px]">Favorite</Badge>
                  )}
                  {property.profileName && (
                    <Badge variant="secondary" className="text-[10px]">
                      <Network className="h-2.5 w-2.5 mr-1" />
                      {property.profileName}
                    </Badge>
                  )}
                  {property.hasCustomAssetPlus && !property.profileName && (
                    <Badge variant="secondary" className="text-[10px]">
                      <KeyRound className="h-2.5 w-2.5 mr-1" />
                      Asset+
                    </Badge>
                  )}
                  {property.hasCustomSenslinc && !property.profileName && (
                    <Badge variant="secondary" className="text-[10px]">
                      <KeyRound className="h-2.5 w-2.5 mr-1" />
                      Senslinc
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CreatePropertyDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editFmGuid={editFmGuid}
        onSaved={fetchProperties}
      />
    </div>
  );
}
