import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, ChevronLeft, List, Plus, MapPin, Building2, LayoutGrid, Crosshair, FileEdit, Scan, Sparkles, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import LocationDetectionStep from './LocationDetectionStep';
import LocationSelectionStep from './LocationSelectionStep';
import CategorySelectionStep from './CategorySelectionStep';
import PositionPickerStep from './PositionPickerStep';
import QuickRegistrationStep from './QuickRegistrationStep';
import SavedItemsList from './SavedItemsList';
import PhotoScanStep from './PhotoScanStep';

export interface WizardFormData {
  buildingFmGuid: string;
  buildingName: string;
  levelFmGuid: string;
  levelName: string;
  roomFmGuid: string;
  roomName: string;
  category: string;
  categoryLabel: string;
  name: string;
  symbolId: string;
  imageUrl: string | null;
  description: string;
  coordinates: { x: number; y: number; z: number } | null;
  ivionPoiId?: number;
  ivionImageId?: number;
  fmGuid?: string;
  ivionSiteId?: string;
  aiSuggestionConfidence?: number;
  aiProperties?: {
    manufacturer?: string | null;
    model?: string | null;
    size?: string | null;
    color?: string | null;
    condition?: string | null;
    text_visible?: string | null;
    material?: string | null;
    installation_type?: string | null;
  } | null;
}

interface SavedItem {
  id: string;
  fm_guid: string;
  name: string | null;
  common_name: string | null;
  asset_type: string | null;
  building_fm_guid: string | null;
  level_fm_guid: string | null;
  in_room_fm_guid: string | null;
  symbol_id: string | null;
  created_at: string;
  annotation_placed: boolean | null;
  coordinate_x: number | null;
  coordinate_y: number | null;
  coordinate_z: number | null;
  symbol?: {
    name: string;
    icon_url: string | null;
    color: string;
  } | null;
}

interface MobileInventoryWizardProps {
  onItemSaved: () => void;
}

type WizardStep = 'detection' | 'location' | 'photo-scan' | 'category' | 'position' | 'registration';
type ViewMode = 'wizard' | 'list';

const STEP_ORDER: WizardStep[] = ['detection', 'location', 'photo-scan', 'category', 'position', 'registration'];

const MobileInventoryWizard: React.FC<MobileInventoryWizardProps> = ({ onItemSaved }) => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<WizardStep>('detection');
  const [savedCount, setSavedCount] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('wizard');
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [editingItem, setEditingItem] = useState<SavedItem | null>(null);
  
  // Form data state
  const [formData, setFormData] = useState<WizardFormData>({
    buildingFmGuid: '',
    buildingName: '',
    levelFmGuid: '',
    levelName: '',
    roomFmGuid: '',
    roomName: '',
    category: '',
    categoryLabel: '',
    name: '',
    symbolId: '',
    imageUrl: null,
    description: '',
    coordinates: null,
  });

  // For quick-loop: save position context between registrations
  const [quickLoopEnabled, setQuickLoopEnabled] = useState(false);

  const currentStepIndex = STEP_ORDER.indexOf(currentStep);

  // Load saved items
  const loadSavedItems = useCallback(async () => {
    setIsLoadingItems(true);
    try {
      const { data, error } = await supabase
        .from('assets')
        .select(`
          id,
          fm_guid,
          name,
          common_name,
          asset_type,
          building_fm_guid,
          level_fm_guid,
          in_room_fm_guid,
          symbol_id,
          created_at,
          annotation_placed,
          coordinate_x,
          coordinate_y,
          coordinate_z,
          annotation_symbols!assets_symbol_id_fkey (
            name,
            icon_url,
            color
          )
        `)
        .eq('is_local', true)
        .eq('category', 'Instance')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('Error loading saved items:', error);
        return;
      }

      // Transform data to include symbol info
      const items: SavedItem[] = (data || []).map((item: any) => ({
        ...item,
        symbol: item.annotation_symbols || null,
      }));

      setSavedItems(items);
    } catch (err) {
      console.error('Error loading saved items:', err);
    } finally {
      setIsLoadingItems(false);
    }
  }, []);

  // Load items on mount and when savedCount changes
  useEffect(() => {
    loadSavedItems();
  }, [loadSavedItems, savedCount]);

  const goToStep = useCallback((step: WizardStep) => {
    setCurrentStep(step);
  }, []);

  const goNext = useCallback(() => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < STEP_ORDER.length) {
      setCurrentStep(STEP_ORDER[nextIndex]);
    }
  }, [currentStepIndex]);

  const goBack = useCallback(() => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(STEP_ORDER[prevIndex]);
    }
  }, [currentStepIndex]);

  const updateFormData = useCallback((updates: Partial<WizardFormData>) => {
    setFormData((prev) => ({ ...prev, ...updates }));
  }, []);

  const handleDetectionComplete = useCallback((building: { fmGuid: string; name: string } | null) => {
    if (building) {
      updateFormData({
        buildingFmGuid: building.fmGuid,
        buildingName: building.name,
      });
    }
    goToStep('location');
  }, [updateFormData, goToStep]);

  const handleLocationComplete = useCallback(() => {
    goNext();
  }, [goNext]);

  const handlePhotoScanComplete = useCallback((highConfidence: boolean) => {
    if (highConfidence) {
      // Skip category step — AI is confident enough
      goToStep('position');
    } else {
      // Go to category so user can verify/correct the AI suggestion
      goToStep('category');
    }
  }, [goToStep]);

  const handlePhotoScanSkip = useCallback(() => {
    goToStep('category');
  }, [goToStep]);

  const handleCategoryComplete = useCallback(() => {
    goNext();
  }, [goNext]);

  const handlePositionComplete = useCallback(() => {
    goNext();
  }, [goNext]);

  const handlePositionSkip = useCallback(() => {
    goNext();
  }, [goNext]);

  const handleRegistrationComplete = useCallback((registerAnother: boolean) => {
    setEditingItem(null);
    setSavedCount((prev) => prev + 1);
    onItemSaved();

    if (registerAnother && quickLoopEnabled) {
      // Keep location and category, clear name and image
      updateFormData({
        name: '',
        imageUrl: null,
        description: '',
        coordinates: null,
        ivionPoiId: undefined,
        ivionImageId: undefined,
        fmGuid: undefined,
        ivionSiteId: undefined,
      });
      // Go back to position step for quick loop
      goToStep('position');
    } else if (registerAnother) {
      // Go back to category selection but keep location
      updateFormData({
        category: '',
        categoryLabel: '',
        name: '',
        symbolId: '',
        imageUrl: null,
        description: '',
        coordinates: null,
        ivionPoiId: undefined,
        ivionImageId: undefined,
        fmGuid: undefined,
        ivionSiteId: undefined,
      });
      goToStep('category');
    } else {
      // Full reset
      setFormData({
        buildingFmGuid: '',
        buildingName: '',
        levelFmGuid: '',
        levelName: '',
        roomFmGuid: '',
        roomName: '',
        category: '',
        categoryLabel: '',
        name: '',
        symbolId: '',
        imageUrl: null,
        description: '',
        coordinates: null,
      });
      goToStep('detection');
    }
  }, [onItemSaved, quickLoopEnabled, updateFormData, goToStep]);

  const handleEditItem = useCallback((item: SavedItem) => {
    // Track that we're editing an existing item
    setEditingItem(item);
    
    // Populate form with item data for editing
    setFormData({
      buildingFmGuid: item.building_fm_guid || '',
      buildingName: '', // Would need to fetch
      levelFmGuid: item.level_fm_guid || '',
      levelName: '',
      roomFmGuid: item.in_room_fm_guid || '',
      roomName: '',
      category: item.asset_type || '',
      categoryLabel: item.asset_type || '',
      name: item.name || item.common_name || '',
      symbolId: item.symbol_id || '',
      imageUrl: null,
      description: '',
      coordinates: item.coordinate_x !== null && item.coordinate_y !== null && item.coordinate_z !== null
        ? { x: item.coordinate_x, y: item.coordinate_y, z: item.coordinate_z }
        : null,
    });
    setCurrentStep('registration');
    setViewMode('wizard');
  }, []);

  // Step progress indicator
  const renderStepIndicator = () => {
    const steps: { key: WizardStep; Icon: LucideIcon }[] = [
      { key: 'detection', Icon: MapPin },
      { key: 'location', Icon: Building2 },
      { key: 'photo-scan', Icon: Sparkles },
      { key: 'category', Icon: LayoutGrid },
      { key: 'position', Icon: Crosshair },
      { key: 'registration', Icon: FileEdit },
    ];

    return (
      <div className="flex items-center justify-center gap-1.5 py-2">
        {steps.map((step) => {
          const isActive = step.key === currentStep;
          const isPast = STEP_ORDER.indexOf(step.key) < currentStepIndex;
          const StepIcon = step.Icon;

          return (
            <div
              key={step.key}
              className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200',
                isActive && 'bg-primary text-primary-foreground scale-110',
                isPast && 'bg-primary/30 text-primary',
                !isActive && !isPast && 'bg-muted text-muted-foreground'
              )}
            >
              <StepIcon className="h-3.5 w-3.5" />
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header - kompakt */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          {viewMode === 'wizard' && currentStep !== 'detection' && (
            <Button variant="ghost" size="icon" onClick={goBack} className="h-9 w-9">
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )}
          <ClipboardList className="h-5 w-5 text-primary" />
          <h1 className="text-base font-semibold text-foreground">Inventory</h1>
        </div>
        
        {/* View mode toggle - minimal buttons */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/inventory/ai-scan')}
            className="h-9 w-9"
          >
            <Scan className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setViewMode('wizard')}
            className={cn(
              'h-9 w-9',
              viewMode === 'wizard' && 'bg-primary/10 text-primary'
            )}
          >
            <Plus className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setViewMode('list')}
            className={cn(
              'h-9 w-9 relative',
              viewMode === 'list' && 'bg-primary/10 text-primary'
            )}
          >
            <List className="h-5 w-5" />
            {savedItems.length > 0 && (
              <Badge variant="secondary" className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px]">
                {savedItems.length}
              </Badge>
            )}
          </Button>
        </div>
      </div>

      {/* Content */}
      {viewMode === 'list' ? (
        <div className="flex-1 overflow-hidden">
          <SavedItemsList
            items={savedItems}
            isLoading={isLoadingItems}
            onEdit={handleEditItem}
          />
        </div>
      ) : (
        <>
          {/* Step indicator */}
          {renderStepIndicator()}

          {/* Step content */}
          <div className="flex-1 overflow-hidden">
            {currentStep === 'detection' && (
              <LocationDetectionStep onComplete={handleDetectionComplete} />
            )}

            {currentStep === 'location' && (
              <LocationSelectionStep
                formData={formData}
                updateFormData={updateFormData}
                onComplete={handleLocationComplete}
                quickLoopEnabled={quickLoopEnabled}
                setQuickLoopEnabled={setQuickLoopEnabled}
              />
            )}

            {currentStep === 'photo-scan' && (
              <PhotoScanStep
                formData={formData}
                updateFormData={updateFormData}
                onComplete={handlePhotoScanComplete}
                onSkip={handlePhotoScanSkip}
              />
            )}

            {currentStep === 'category' && (
              <CategorySelectionStep
                formData={formData}
                updateFormData={updateFormData}
                onComplete={handleCategoryComplete}
              />
            )}

            {currentStep === 'position' && (
              <PositionPickerStep
                formData={formData}
                updateFormData={updateFormData}
                onComplete={handlePositionComplete}
                onSkip={handlePositionSkip}
              />
            )}

            {currentStep === 'registration' && (
              <QuickRegistrationStep
                formData={formData}
                updateFormData={updateFormData}
                onComplete={handleRegistrationComplete}
                quickLoopEnabled={quickLoopEnabled}
                editingItem={editingItem}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default MobileInventoryWizard;
