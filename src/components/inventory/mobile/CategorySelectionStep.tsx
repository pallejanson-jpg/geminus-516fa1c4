import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { INVENTORY_CATEGORIES, type InventoryCategory } from '@/components/inventory/InventoryForm';
import type { WizardFormData } from './MobileInventoryWizard';
import { CheckSquare, Square } from 'lucide-react';

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
  // Initialize with all categories selected by default
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(() => {
    // If formData already has a category, use just that one
    if (formData.category) {
      return new Set([formData.category]);
    }
    // Otherwise select all by default
    return new Set(INVENTORY_CATEGORIES.map(c => c.value));
  });

  const allSelected = selectedCategories.size === INVENTORY_CATEGORIES.length;
  const noneSelected = selectedCategories.size === 0;

  const handleCategoryToggle = (category: InventoryCategory) => {
    setSelectedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category.value)) {
        next.delete(category.value);
      } else {
        next.add(category.value);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedCategories(new Set(INVENTORY_CATEGORIES.map(c => c.value)));
  };

  const handleDeselectAll = () => {
    setSelectedCategories(new Set());
  };

  const handleContinue = () => {
    // If exactly one category is selected, use it directly
    if (selectedCategories.size === 1) {
      const value = Array.from(selectedCategories)[0];
      const cat = INVENTORY_CATEGORIES.find(c => c.value === value);
      if (cat) {
        updateFormData({
          category: cat.value,
          categoryLabel: cat.label,
        });
      }
    } else if (selectedCategories.size > 1) {
      // Multiple categories - use first one for now (could be extended to multi-select flow)
      const value = Array.from(selectedCategories)[0];
      const cat = INVENTORY_CATEGORIES.find(c => c.value === value);
      if (cat) {
        updateFormData({
          category: cat.value,
          categoryLabel: cat.label,
        });
      }
    }
    onComplete();
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        <div className="text-center mb-2">
          <h2 className="text-lg font-semibold">Select category</h2>
          <p className="text-sm text-muted-foreground">
            {formData.buildingName}
            {formData.levelName && ` → ${formData.levelName}`}
            {formData.roomName && ` → ${formData.roomName}`}
          </p>
        </div>

        {/* Select all / Deselect all buttons */}
        <div className="flex justify-center gap-2 pb-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleSelectAll}
            disabled={allSelected}
            className="gap-1.5"
          >
            <CheckSquare className="h-4 w-4" />
            Select all
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDeselectAll}
            disabled={noneSelected}
            className="gap-1.5"
          >
            <Square className="h-4 w-4" />
            Deselect all
          </Button>
        </div>

        {/* Category grid - large touch targets with checkboxes */}
        <div className="grid grid-cols-3 gap-2">
          {INVENTORY_CATEGORIES.map((cat) => {
            const isSelected = selectedCategories.has(cat.value);
            const CategoryIcon = cat.Icon;

            return (
              <button
                key={cat.value}
                type="button"
                className={cn(
                  'h-20 flex flex-col items-center justify-center gap-1.5 p-2 rounded-md border-2 transition-colors',
                  isSelected 
                    ? 'border-primary bg-primary/10' 
                    : 'border-muted hover:border-muted-foreground/30'
                )}
                onClick={() => handleCategoryToggle(cat)}
              >
                <div className="relative">
                  <CategoryIcon className={cn('h-7 w-7', isSelected ? 'text-primary' : cat.color)} />
                  {isSelected && (
                    <div className="absolute -top-1 -right-1 h-3.5 w-3.5 bg-primary rounded-full flex items-center justify-center">
                      <CheckSquare className="h-2.5 w-2.5 text-primary-foreground" />
                    </div>
                  )}
                </div>
                <span className={cn(
                  'text-xs text-center leading-tight',
                  isSelected && 'font-medium'
                )}>
                  {cat.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Selected count */}
        <div className="text-center text-sm text-muted-foreground">
          {selectedCategories.size} av {INVENTORY_CATEGORIES.length} kategorier valda
        </div>

        {/* Continue button */}
        <Button
          type="button"
          className="w-full"
          disabled={noneSelected}
          onClick={handleContinue}
        >
          Fortsätt
        </Button>
      </div>
    </ScrollArea>
  );
};

export default CategorySelectionStep;
