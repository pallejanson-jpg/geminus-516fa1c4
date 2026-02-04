import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface BuildingSettings {
    fmGuid: string;
    isFavorite: boolean;
    ivionSiteId: string | null;
    latitude: number | null;
    longitude: number | null;
    heroImageUrl: string | null;
    startViewId: string | null;
    rotation: number | null;
    // Token fields (managed by edge functions, read-only in frontend)
    ivionAccessToken: string | null;
    ivionRefreshToken: string | null;
    ivionTokenExpiresAt: string | null;
}

export function useBuildingSettings(fmGuid: string | null) {
    const [settings, setSettings] = useState<BuildingSettings | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const { toast } = useToast();

    // Fetch settings for building
    const fetchSettings = useCallback(async () => {
        if (!fmGuid) return;
        
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('building_settings')
                .select('*')
                .eq('fm_guid', fmGuid)
                .maybeSingle();

            if (error) throw error;

            if (data) {
                setSettings({
                    fmGuid: data.fm_guid,
                    isFavorite: data.is_favorite,
                    ivionSiteId: data.ivion_site_id,
                    latitude: data.latitude ?? null,
                    longitude: data.longitude ?? null,
                    heroImageUrl: data.hero_image_url ?? null,
                    startViewId: data.start_view_id ?? null,
                    rotation: (data as any).rotation ?? null,
                    ivionAccessToken: (data as any).ivion_access_token ?? null,
                    ivionRefreshToken: (data as any).ivion_refresh_token ?? null,
                    ivionTokenExpiresAt: (data as any).ivion_token_expires_at ?? null,
                });
            } else {
                // No settings yet, use defaults
                setSettings({
                    fmGuid,
                    isFavorite: false,
                    ivionSiteId: null,
                    latitude: null,
                    longitude: null,
                    heroImageUrl: null,
                    startViewId: null,
                    rotation: null,
                    ivionAccessToken: null,
                    ivionRefreshToken: null,
                    ivionTokenExpiresAt: null,
                });
            }
        } catch (error) {
            console.error('Failed to fetch building settings:', error);
        } finally {
            setIsLoading(false);
        }
    }, [fmGuid]);

    useEffect(() => {
        fetchSettings();
    }, [fetchSettings]);

    // Upsert settings
    const saveSettings = useCallback(async (updates: Partial<Omit<BuildingSettings, 'fmGuid'>>) => {
        if (!fmGuid) return;
        
        setIsSaving(true);
        try {
            const { error } = await supabase
                .from('building_settings')
                .upsert({
                    fm_guid: fmGuid,
                    is_favorite: updates.isFavorite ?? settings?.isFavorite ?? false,
                    ivion_site_id: updates.ivionSiteId !== undefined 
                        ? updates.ivionSiteId 
                        : settings?.ivionSiteId ?? null,
                    latitude: updates.latitude !== undefined
                        ? updates.latitude
                        : settings?.latitude ?? null,
                    longitude: updates.longitude !== undefined
                        ? updates.longitude
                        : settings?.longitude ?? null,
                    hero_image_url: updates.heroImageUrl !== undefined
                        ? updates.heroImageUrl
                        : settings?.heroImageUrl ?? null,
                    start_view_id: updates.startViewId !== undefined
                        ? updates.startViewId
                        : settings?.startViewId ?? null,
                    rotation: updates.rotation !== undefined
                        ? updates.rotation
                        : settings?.rotation ?? null,
                } as any, { 
                    onConflict: 'fm_guid' 
                });

            if (error) throw error;

            // Update local state
            setSettings(prev => prev ? { ...prev, ...updates } : null);
            
            // Dispatch global event to notify other components
            window.dispatchEvent(new Event('building-settings-changed'));
            
            toast({
                title: 'Settings saved',
                description: 'Building settings have been updated.',
            });
        } catch (error: any) {
            console.error('Failed to save building settings:', error);
            toast({
                variant: 'destructive',
                title: 'Save failed',
                description: error.message,
            });
        } finally {
            setIsSaving(false);
        }
    }, [fmGuid, settings, toast]);

    // Toggle favorite
    const toggleFavorite = useCallback(async () => {
        const newValue = !settings?.isFavorite;
        await saveSettings({ isFavorite: newValue });
    }, [settings?.isFavorite, saveSettings]);

    // Update Ivion site ID
    const updateIvionSiteId = useCallback(async (siteId: string | null) => {
        await saveSettings({ ivionSiteId: siteId });
    }, [saveSettings]);

    // Update map position
    const updateMapPosition = useCallback(async (lat: number | null, lng: number | null) => {
        await saveSettings({ latitude: lat, longitude: lng });
    }, [saveSettings]);

    // Update hero image
    const updateHeroImage = useCallback(async (url: string | null) => {
        await saveSettings({ heroImageUrl: url });
    }, [saveSettings]);

    // Update start view
    const updateStartView = useCallback(async (viewId: string | null) => {
        await saveSettings({ startViewId: viewId });
    }, [saveSettings]);

    // Update rotation
    const updateRotation = useCallback(async (rotation: number | null) => {
        await saveSettings({ rotation: rotation });
    }, [saveSettings]);

    return {
        settings,
        isLoading,
        isSaving,
        toggleFavorite,
        updateIvionSiteId,
        updateMapPosition,
        updateHeroImage,
        updateStartView,
        updateRotation,
        refetch: fetchSettings,
    };
}

// Hook to fetch all favorite buildings
export function useFavoriteBuildings() {
    const [favorites, setFavorites] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchFavorites = async () => {
            try {
                const { data, error } = await supabase
                    .from('building_settings')
                    .select('fm_guid')
                    .eq('is_favorite', true);

                if (error) throw error;
                setFavorites(data?.map(d => d.fm_guid) || []);
            } catch (error) {
                console.error('Failed to fetch favorites:', error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchFavorites();
    }, []);

    return { favorites, isLoading };
}
