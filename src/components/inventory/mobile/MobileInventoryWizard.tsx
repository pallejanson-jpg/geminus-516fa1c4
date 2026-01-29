import React, { useState, useCallback } from 'react';
import { ClipboardList, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import LocationDetectionStep from './LocationDetectionStep';
import LocationSelectionStep from './LocationSelectionStep';
import CategorySelectionStep from './CategorySelectionStep';
import QuickRegistrationStep from './QuickRegistrationStep';

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
}

interface MobileInventoryWizardProps {
  onItemSaved: () => void;
}

type WizardStep = 'detection' | 'location' | 'category' | 'registration';

const STEP_ORDER: WizardStep[] = ['detection', 'location', 'category', 'registration'];

const MobileInventoryWizard: React.FC<MobileInventoryWizardProps> = ({ onItemSaved }) => {
  const [currentStep, setCurrentStep] = useState<WizardStep>('detection');
  const [savedCount, setSavedCount] = useState(0);
  
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

  const handleCategoryComplete = useCallback(() => {
    goNext();
  }, [goNext]);

  const handleRegistrationComplete = useCallback((registerAnother: boolean) => {
    setSavedCount((prev) => prev + 1);
    onItemSaved();

    if (registerAnother && quickLoopEnabled) {
      // Keep location and category, clear name and image
      updateFormData({
        name: '',
        imageUrl: null,
        description: '',
        coordinates: null,
      });
      // Stay on registration step
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

  // Step progress indicator
  const renderStepIndicator = () => {
    const steps = [
      { key: 'detection', label: '📍' },
      { key: 'location', label: '🏢' },
      { key: 'category', label: '📋' },
      { key: 'registration', label: '✏️' },
    ];

    return (
      <div className="flex items-center justify-center gap-2 py-2">
        {steps.map((step, index) => {
          const isActive = step.key === currentStep;
          const isPast = STEP_ORDER.indexOf(step.key as WizardStep) < currentStepIndex;

          return (
            <div
              key={step.key}
              className={`
                w-8 h-8 rounded-full flex items-center justify-center text-sm
                transition-all duration-200
                ${isActive ? 'bg-primary text-primary-foreground scale-110' : ''}
                ${isPast ? 'bg-primary/30 text-primary' : ''}
                ${!isActive && !isPast ? 'bg-muted text-muted-foreground' : ''}
              `}
            >
              {step.label}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-3">
          {currentStep !== 'detection' && (
            <Button variant="ghost" size="icon" onClick={goBack} className="h-10 w-10">
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )}
          <ClipboardList className="h-6 w-6 text-primary" />
          <h1 className="text-lg font-semibold text-foreground">Inventering</h1>
        </div>
        {savedCount > 0 && (
          <Badge variant="secondary" className="text-sm">
            {savedCount} sparade
          </Badge>
        )}
      </div>

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

        {currentStep === 'category' && (
          <CategorySelectionStep
            formData={formData}
            updateFormData={updateFormData}
            onComplete={handleCategoryComplete}
          />
        )}

        {currentStep === 'registration' && (
          <QuickRegistrationStep
            formData={formData}
            updateFormData={updateFormData}
            onComplete={handleRegistrationComplete}
            quickLoopEnabled={quickLoopEnabled}
          />
        )}
      </div>
    </div>
  );
};

export default MobileInventoryWizard;
