import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface BuildingSettings {
    fmGuid: string;
    isFavorite: boolean;
    ivionSiteId: string | null;
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
                });
            } else {
                // No settings yet, use defaults
                setSettings({
                    fmGuid,
                    isFavorite: false,
                    ivionSiteId: null,
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
                }, { 
                    onConflict: 'fm_guid' 
                });

            if (error) throw error;

            // Update local state
            setSettings(prev => prev ? { ...prev, ...updates } : null);
            
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

    return {
        settings,
        isLoading,
        isSaving,
        toggleFavorite,
        updateIvionSiteId,
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
