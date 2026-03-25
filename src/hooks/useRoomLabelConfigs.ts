import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

export interface RoomLabelConfig {
  id: string;
  name: string;
  fields: string[];
  height_offset: number;
  font_size: number;
  scale_with_distance: boolean;
  click_action: 'none' | 'flyto' | 'roomcard';
  is_default: boolean;
  occlusion_enabled: boolean;
  flat_on_floor: boolean;
  created_at?: string;
  updated_at?: string;
}

// Available fields that can be shown on labels
export const AVAILABLE_LABEL_FIELDS = [
  { key: 'commonName', label: 'Rumsnamn', description: 'Rummets namn' },
  { key: 'designation', label: 'Rumsnummer', description: 'Beteckning/nummer' },
  { key: 'longName', label: 'Långt namn', description: 'Fullständigt namn' },
  { key: 'nta', label: 'Nettoyta (NTA)', description: 'Nettoyta i m²' },
  { key: 'bta', label: 'Bruttoyta (BTA)', description: 'Bruttoyta i m²' },
  { key: 'function', label: 'Funktion', description: 'Rummets funktion' },
  { key: 'department', label: 'Avdelning', description: 'Tillhörande avdelning' },
];

export function useRoomLabelConfigs() {
  const [configs, setConfigs] = useState<RoomLabelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeConfigId, setActiveConfigId] = useState<string | null>(null);

  // Fetch all configs
  const fetchConfigs = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('room_label_configs')
        .select('*')
        .order('name');

      if (error) throw error;

      const mappedConfigs: RoomLabelConfig[] = (data || []).map((row: any) => ({
        id: row.id,
        name: row.name,
        fields: Array.isArray(row.fields) ? row.fields : JSON.parse(row.fields || '[]'),
        height_offset: row.height_offset,
        font_size: row.font_size,
        scale_with_distance: row.scale_with_distance,
        click_action: row.click_action,
        is_default: row.is_default,
        occlusion_enabled: row.occlusion_enabled ?? true,
        flat_on_floor: row.flat_on_floor ?? false,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }));

      setConfigs(mappedConfigs);

      // Set default active config
      const defaultConfig = mappedConfigs.find(c => c.is_default);
      if (defaultConfig && !activeConfigId) {
        setActiveConfigId(defaultConfig.id);
      }
    } catch (error: any) {
      console.debug('Failed to fetch room label configs:', error?.message);
      // Silently fail — don't show toast for this non-critical feature
    } finally {
      setLoading(false);
    }
  }, [activeConfigId]);

  // Create new config
  const createConfig = useCallback(async (config: Omit<RoomLabelConfig, 'id' | 'created_at' | 'updated_at'>) => {
    try {
      const { data, error } = await supabase
        .from('room_label_configs')
        .insert({
          name: config.name,
          fields: config.fields,
          height_offset: config.height_offset,
          font_size: config.font_size,
          scale_with_distance: config.scale_with_distance,
          click_action: config.click_action,
          is_default: config.is_default,
          occlusion_enabled: config.occlusion_enabled,
          flat_on_floor: config.flat_on_floor,
        })
        .select()
        .single();

      if (error) throw error;

      await fetchConfigs();
      toast({
        title: 'Etikettkonfiguration skapad',
        description: `"${config.name}" har sparats.`,
      });

      return data;
    } catch (error: any) {
      console.error('Failed to create room label config:', error);
      toast({
        variant: 'destructive',
        title: 'Could not create configuration',
        description: error.message,
      });
      return null;
    }
  }, [fetchConfigs]);

  // Update config
  const updateConfig = useCallback(async (id: string, updates: Partial<RoomLabelConfig>) => {
    try {
      const { error } = await supabase
        .from('room_label_configs')
        .update({
          name: updates.name,
          fields: updates.fields,
          height_offset: updates.height_offset,
          font_size: updates.font_size,
          scale_with_distance: updates.scale_with_distance,
          click_action: updates.click_action,
          is_default: updates.is_default,
          occlusion_enabled: updates.occlusion_enabled,
          flat_on_floor: updates.flat_on_floor,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) throw error;

      await fetchConfigs();
      toast({
        title: 'Configuration updated',
        description: 'Changes have been saved.',
      });
    } catch (error: any) {
      console.error('Failed to update room label config:', error);
      toast({
        variant: 'destructive',
        title: 'Could not update',
        description: error.message,
      });
    }
  }, [fetchConfigs]);

  // Delete config
  const deleteConfig = useCallback(async (id: string) => {
    try {
      const { error } = await supabase
        .from('room_label_configs')
        .delete()
        .eq('id', id);

      if (error) throw error;

      await fetchConfigs();
      
      if (activeConfigId === id) {
        setActiveConfigId(null);
      }

      toast({
        title: 'Konfiguration borttagen',
      });
    } catch (error: any) {
      console.error('Failed to delete room label config:', error);
      toast({
        variant: 'destructive',
        title: 'Kunde inte ta bort',
        description: error.message,
      });
    }
  }, [fetchConfigs, activeConfigId]);

  // Get active config
  const getActiveConfig = useCallback((): RoomLabelConfig | null => {
    if (!activeConfigId) return null;
    return configs.find(c => c.id === activeConfigId) || null;
  }, [configs, activeConfigId]);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  return {
    configs,
    loading,
    activeConfigId,
    setActiveConfigId,
    getActiveConfig,
    createConfig,
    updateConfig,
    deleteConfig,
    refetch: fetchConfigs,
  };
}

export default useRoomLabelConfigs;
