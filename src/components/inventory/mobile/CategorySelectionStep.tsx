import React from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { INVENTORY_CATEGORIES } from '@/components/inventory/InventoryForm';
import type { WizardFormData } from './MobileInventoryWizard';

interface CategorySelectionStepProps {
  formData: WizardFormData;
  updateFormData: (updates: Partial<WizardFormData>) => void;
  onComplete: () => void;
}

const CategorySelectionStep: React.FC<CategorySelectionStepProps> = ({
  formData,
  updateFormData,
  onComplete,
}) => {
  const handleCategorySelect = (category: { value: string; label: string }) => {
    updateFormData({
      category: category.value,
      categoryLabel: category.label,
    });
    // Auto-advance after selection
    setTimeout(() => onComplete(), 150);
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        <div className="text-center mb-4">
          <h2 className="text-lg font-semibold">Välj kategori</h2>
          <p className="text-sm text-muted-foreground">
            {formData.buildingName}
            {formData.levelName && ` → ${formData.levelName}`}
            {formData.roomName && ` → ${formData.roomName}`}
          </p>
        </div>

        {/* Category grid - large touch targets */}
        <div className="grid grid-cols-3 gap-3">
          {INVENTORY_CATEGORIES.map((cat) => {
            const isSelected = formData.category === cat.value;

            return (
              <Button
                key={cat.value}
                type="button"
                variant={isSelected ? 'default' : 'outline'}
                className={`
                  h-24 flex flex-col items-center justify-center gap-2 p-2
                  ${isSelected ? '' : 'border-2'}
                `}
                onClick={() => handleCategorySelect(cat)}
              >
                <span className="text-3xl">{cat.icon}</span>
                <span className="text-xs text-center leading-tight">{cat.label}</span>
              </Button>
            );
          })}
        </div>

        {/* Selected indicator */}
        {formData.category && (
          <div className="text-center mt-4 p-3 bg-primary/10 rounded-lg">
            <p className="text-sm font-medium">
              Vald kategori:{' '}
              <span className="text-primary">
                {INVENTORY_CATEGORIES.find((c) => c.value === formData.category)?.icon}{' '}
                {formData.categoryLabel}
              </span>
            </p>
          </div>
        )}
      </div>
    </ScrollArea>
  );
};

export default CategorySelectionStep;
