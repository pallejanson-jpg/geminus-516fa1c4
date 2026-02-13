import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { MapPin, ChevronDown, Save, Loader2, RotateCw } from 'lucide-react';

interface GeoreferencingSettingsProps {
    buildingFmGuid: string;
    buildingName?: string;
}

interface GeoSettings {
    latitude: number | null;
    longitude: number | null;
    rotation: number | null;
    fmAccessBuildingGuid: string | null;
}

const GeoreferencingSettings: React.FC<GeoreferencingSettingsProps> = ({ 
    buildingFmGuid,
    buildingName 
}) => {
    const { toast } = useToast();
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [settings, setSettings] = useState<GeoSettings>({
        latitude: null,
        longitude: null,
        rotation: null,
        fmAccessBuildingGuid: null,
    });
    const [latInput, setLatInput] = useState('');
    const [lngInput, setLngInput] = useState('');
    const [rotationValue, setRotationValue] = useState(0);
    const [fmAccessGuidInput, setFmAccessGuidInput] = useState('');

    // Fetch current settings
    useEffect(() => {
        if (!buildingFmGuid) return;
        
        const fetchSettings = async () => {
            setIsLoading(true);
            try {
                const { data, error } = await supabase
                    .from('building_settings')
                    .select('latitude, longitude, rotation, fm_access_building_guid')
                    .eq('fm_guid', buildingFmGuid)
                    .maybeSingle();

                if (error) throw error;

                if (data) {
                    setSettings({
                        latitude: data.latitude,
                        longitude: data.longitude,
                        rotation: data.rotation ?? 0,
                        fmAccessBuildingGuid: (data as any).fm_access_building_guid ?? null,
                    });
                    setLatInput(data.latitude?.toString() || '');
                    setLngInput(data.longitude?.toString() || '');
                    setRotationValue(data.rotation ?? 0);
                    setFmAccessGuidInput((data as any).fm_access_building_guid || '');
                }
            } catch (error) {
                console.error('Failed to fetch georeferencing settings:', error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchSettings();
    }, [buildingFmGuid]);

    const handleSave = async () => {
        const lat = latInput ? parseFloat(latInput) : null;
        const lng = lngInput ? parseFloat(lngInput) : null;

        // Validate coordinates
        if (lat !== null && (isNaN(lat) || lat < -90 || lat > 90)) {
            toast({
                variant: "destructive",
                title: "Ogiltig latitud",
                description: "Latitud måste vara mellan -90 och 90.",
            });
            return;
        }

        if (lng !== null && (isNaN(lng) || lng < -180 || lng > 180)) {
            toast({
                variant: "destructive",
                title: "Ogiltig longitud",
                description: "Longitud måste vara mellan -180 och 180.",
            });
            return;
        }

        setIsSaving(true);
        try {
            const { error } = await supabase
                .from('building_settings')
                .upsert({
                    fm_guid: buildingFmGuid,
                    latitude: lat,
                    longitude: lng,
                    rotation: rotationValue,
                    fm_access_building_guid: fmAccessGuidInput.trim() || null,
                } as any, { onConflict: 'fm_guid' });

            if (error) throw error;

            setSettings({ latitude: lat, longitude: lng, rotation: rotationValue, fmAccessBuildingGuid: fmAccessGuidInput.trim() || null });
            
            // Dispatch event to notify other components
            window.dispatchEvent(new Event('building-settings-changed'));

            toast({
                title: "Koordinater sparade",
                description: "Byggnadens georeferering har uppdaterats.",
            });
        } catch (error: any) {
            console.error('Failed to save georeferencing settings:', error);
            toast({
                variant: "destructive",
                title: "Kunde inte spara",
                description: error.message,
            });
        } finally {
            setIsSaving(false);
        }
    };

    const hasCoordinates = settings.latitude !== null && settings.longitude !== null;

    return (
        <Collapsible open={isOpen} onOpenChange={setIsOpen} className="border rounded-lg p-3">
            <CollapsibleTrigger className="flex items-center justify-between w-full text-left">
                <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-sm">Georeferering</span>
                    {hasCoordinates && (
                        <span className="text-xs text-muted-foreground">
                            ({settings.latitude?.toFixed(4)}, {settings.longitude?.toFixed(4)})
                        </span>
                    )}
                </div>
                <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </CollapsibleTrigger>
            
            <CollapsibleContent className="pt-4 space-y-4">
                <p className="text-xs text-muted-foreground">
                    Koordinater krävs för synkronisering mellan 3D-vy och 360°-vy i Split View.
                </p>

                {isLoading ? (
                    <div className="flex items-center justify-center py-4">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label htmlFor="latitude" className="text-xs">
                                    Latitud
                                </Label>
                                <Input
                                    id="latitude"
                                    type="text"
                                    inputMode="decimal"
                                    placeholder="59.330364"
                                    value={latInput}
                                    onChange={(e) => setLatInput(e.target.value)}
                                    className="h-9"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="longitude" className="text-xs">
                                    Longitud
                                </Label>
                                <Input
                                    id="longitude"
                                    type="text"
                                    inputMode="decimal"
                                    placeholder="18.060124"
                                    value={lngInput}
                                    onChange={(e) => setLngInput(e.target.value)}
                                    className="h-9"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label className="text-xs flex items-center gap-1.5">
                                    <RotateCw className="h-3 w-3" />
                                    Rotation (grader relativt norr)
                                </Label>
                                <span className="text-xs font-mono text-muted-foreground">
                                    {rotationValue}°
                                </span>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="fmAccessGuid" className="text-xs">
                                FM Access Building GUID
                            </Label>
                            <Input
                                id="fmAccessGuid"
                                type="text"
                                placeholder="755950d9-f235-4d64-a38d-..."
                                value={fmAccessGuidInput}
                                onChange={(e) => setFmAccessGuidInput(e.target.value)}
                                className="h-9 font-mono text-xs"
                            />
                            <p className="text-[10px] text-muted-foreground">
                                GUID för byggnaden i FM Access (krävs för 2D-ritningar)
                            </p>
                        </div>
                            <Slider
                                value={[rotationValue]}
                                onValueChange={(values) => setRotationValue(values[0])}
                                min={0}
                                max={360}
                                step={1}
                                className="py-2"
                            />
                        </div>

                        <Button 
                            onClick={handleSave} 
                            disabled={isSaving}
                            size="sm"
                            className="w-full"
                        >
                            {isSaving ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Sparar...
                                </>
                            ) : (
                                <>
                                    <Save className="h-4 w-4 mr-2" />
                                    Spara koordinater
                                </>
                            )}
                        </Button>
                    </>
                )}
            </CollapsibleContent>
        </Collapsible>
    );
};

export default GeoreferencingSettings;
