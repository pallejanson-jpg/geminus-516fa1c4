import React, { useState, useEffect, useContext } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MapPin, Loader2, CheckCircle2, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { INVENTORY_CATEGORIES } from '@/components/inventory/InventoryForm';

interface AnnotationSymbol {
  id: string;
  name: string;
  category: string;
  color: string;
  icon_url: string | null;
}

interface Building {
  fm_guid: string;
  common_name: string | null;
  name: string | null;
}

const IvionCreate: React.FC = () => {
  const [searchParams] = useSearchParams();
  
  // URL parameters from Ivion
  const siteId = searchParams.get('siteId') || '';
  const imageId = searchParams.get('imageId') || '';
  const x = parseFloat(searchParams.get('x') || '0');
  const y = parseFloat(searchParams.get('y') || '0');
  const z = parseFloat(searchParams.get('z') || '0');
  const poiId = searchParams.get('poiId') || '';
  const poiName = searchParams.get('name') || '';
  
  // Form state
  const [isLoading, setIsLoading] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [symbols, setSymbols] = useState<AnnotationSymbol[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [matchedBuilding, setMatchedBuilding] = useState<Building | null>(null);
  
  const [name, setName] = useState(poiName);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [symbolId, setSymbolId] = useState('');
  const [buildingFmGuid, setBuildingFmGuid] = useState('');

  // Fetch symbols and buildings on mount
  useEffect(() => {
    const fetchData = async () => {
      const [symbolsRes, buildingsRes] = await Promise.all([
        supabase
          .from('annotation_symbols')
          .select('id, name, category, color, icon_url')
          .order('category, name'),
        supabase
          .from('assets')
          .select('fm_guid, common_name, name')
          .eq('category', 'Building'),
      ]);

      if (symbolsRes.data) setSymbols(symbolsRes.data);
      if (buildingsRes.data) setBuildings(buildingsRes.data);
      
      // Try to find building matching the Ivion site
      if (siteId && buildingsRes.data) {
        const { data: settingsData } = await supabase
          .from('building_settings')
          .select('fm_guid')
          .eq('ivion_site_id', siteId)
          .maybeSingle();
        
        if (settingsData) {
          const matched = buildingsRes.data.find(b => b.fm_guid === settingsData.fm_guid);
          if (matched) {
            setMatchedBuilding(matched);
            setBuildingFmGuid(matched.fm_guid);
          }
        }
      }
    };
    
    fetchData();
  }, [siteId]);

  const handleSubmit = async () => {
    // Validation
    if (!name.trim()) {
      toast.error('Namn är obligatoriskt');
      return;
    }
    if (!category) {
      toast.error('Välj en kategori');
      return;
    }
    if (!symbolId) {
      toast.error('Välj en symbol');
      return;
    }
    if (!buildingFmGuid) {
      toast.error('Välj en byggnad');
      return;
    }

    setIsLoading(true);

    try {
      const inventoryDate = new Date().toISOString();
      const newFmGuid = crypto.randomUUID();
      
      const newAsset = {
        fm_guid: newFmGuid,
        name: name.trim(),
        common_name: name.trim(),
        category: 'Instance',
        asset_type: category,
        symbol_id: symbolId,
        building_fm_guid: buildingFmGuid,
        coordinate_x: x,
        coordinate_y: y,
        coordinate_z: z,
        ivion_poi_id: poiId ? parseInt(poiId, 10) : null,
        ivion_site_id: siteId || null,
        ivion_image_id: imageId ? parseInt(imageId, 10) : null,
        ivion_synced_at: new Date().toISOString(),
        created_in_model: false,
        is_local: true,
        annotation_placed: true,
        attributes: {
          objectType: 4,
          designation: name.trim(),
          commonName: name.trim(),
          buildingFmGuid: buildingFmGuid,
          assetCategory: category,
          description: description.trim() || null,
          inventoryDate: inventoryDate,
          ivionSource: true,
          ivionImageId: imageId ? parseInt(imageId, 10) : null,
        },
      };

      const { error } = await supabase.from('assets').insert([newAsset]);
      if (error) throw error;

      setIsSaved(true);
      toast.success('Tillgång skapad!');
      
      // Notify parent window if embedded in iframe
      if (window.parent !== window) {
        window.parent.postMessage({
          type: 'geminus-asset-created',
          assetFmGuid: newFmGuid,
          name: name.trim(),
        }, '*');
      }
    } catch (error: any) {
      toast.error('Kunde inte spara', {
        description: error.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'geminus-close' }, '*');
    } else {
      window.close();
    }
  };

  // Group symbols by category
  const groupedSymbols = symbols.reduce((acc, sym) => {
    if (!acc[sym.category]) acc[sym.category] = [];
    acc[sym.category].push(sym);
    return acc;
  }, {} as Record<string, AnnotationSymbol[]>);

  if (isSaved) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Tillgång skapad!</h2>
            <p className="text-muted-foreground mb-6">
              {name} har sparats och kan nu ses i Geminus.
            </p>
            <Button onClick={handleClose} className="w-full">
              Stäng
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <Card className="w-full max-w-lg mx-auto">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Registrera tillgång från Ivion</CardTitle>
            <Button variant="ghost" size="icon" onClick={handleClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-5">
          {/* Position info from Ivion */}
          {(x !== 0 || y !== 0 || z !== 0) && (
            <div className="bg-muted/50 rounded-lg p-3 flex items-start gap-3">
              <MapPin className="h-5 w-5 text-primary mt-0.5" />
              <div className="text-sm">
                <div className="font-medium mb-1">Position från Ivion</div>
                <div className="text-muted-foreground font-mono text-xs">
                  X: {x.toFixed(2)} Y: {y.toFixed(2)} Z: {z.toFixed(2)}
                </div>
                {imageId && (
                  <div className="text-muted-foreground text-xs mt-1">
                    Panorama: #{imageId}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Name input */}
          <div className="space-y-2">
            <Label>Namn / Beteckning *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="t.ex. Brandsläckare BS-001"
              className="h-12"
              autoFocus
              maxLength={100}
            />
          </div>

          {/* Category dropdown */}
          <div className="space-y-2">
            <Label>Kategori *</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-12">
                <SelectValue placeholder="Välj kategori..." />
              </SelectTrigger>
              <SelectContent className="bg-popover z-50">
                {INVENTORY_CATEGORIES.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    <span className="flex items-center gap-2">
                      <span>{cat.icon}</span>
                      <span>{cat.label}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Symbol dropdown */}
          <div className="space-y-2">
            <Label>Symbol *</Label>
            <Select value={symbolId} onValueChange={setSymbolId}>
              <SelectTrigger className="h-12">
                <SelectValue placeholder="Välj symbol..." />
              </SelectTrigger>
              <SelectContent className="bg-popover z-50 max-h-60">
                {Object.entries(groupedSymbols).map(([cat, syms]) => (
                  <div key={cat}>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                      {cat}
                    </div>
                    {syms.map((sym) => (
                      <SelectItem key={sym.id} value={sym.id}>
                        <span className="flex items-center gap-2">
                          {sym.icon_url ? (
                            <img
                              src={sym.icon_url}
                              alt=""
                              className="w-5 h-5 object-contain"
                            />
                          ) : (
                            <div
                              className="w-5 h-5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: sym.color }}
                            />
                          )}
                          <span>{sym.name}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </div>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Building dropdown */}
          <div className="space-y-2">
            <Label>
              Byggnad *
              {matchedBuilding && (
                <span className="text-muted-foreground text-xs ml-2">
                  (matchad från Ivion site)
                </span>
              )}
            </Label>
            <Select value={buildingFmGuid} onValueChange={setBuildingFmGuid}>
              <SelectTrigger className="h-12">
                <SelectValue placeholder="Välj byggnad..." />
              </SelectTrigger>
              <SelectContent className="bg-popover z-50">
                {buildings.map((b) => (
                  <SelectItem key={b.fm_guid} value={b.fm_guid}>
                    {b.common_name || b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label>Beskrivning (valfritt)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Fritext beskrivning..."
              className="min-h-[80px]"
              maxLength={1000}
            />
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              className="flex-1 h-12"
              disabled={isLoading}
            >
              Avbryt
            </Button>
            <Button
              onClick={handleSubmit}
              className="flex-1 h-12"
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                'Spara'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default IvionCreate;
