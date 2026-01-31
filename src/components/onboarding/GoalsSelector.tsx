import React from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Package, Box, BarChart3, Navigation, ChevronRight, ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

export type UserGoal = 'inventory' | 'viewer' | 'insights' | 'navigate';

interface GoalsSelectorProps {
  selectedGoals: UserGoal[];
  onGoalsChange: (goals: UserGoal[]) => void;
  onNext: () => void;
  onBack: () => void;
  isLoading?: boolean;
}

const goals: { id: UserGoal; label: string; description: string; icon: React.ReactNode }[] = [
  {
    id: 'inventory',
    label: 'Register Inventory',
    description: 'Track equipment, assets, and fire safety devices',
    icon: <Package className="w-5 h-5" />,
  },
  {
    id: 'viewer',
    label: 'Explore 3D Models',
    description: 'Navigate building models and visualize spaces',
    icon: <Box className="w-5 h-5" />,
  },
  {
    id: 'insights',
    label: 'View Insights',
    description: 'Analyze performance data and sensor readings',
    icon: <BarChart3 className="w-5 h-5" />,
  },
  {
    id: 'navigate',
    label: 'Navigate Portfolio',
    description: 'Browse buildings, floors, and rooms',
    icon: <Navigation className="w-5 h-5" />,
  },
];

const GoalsSelector: React.FC<GoalsSelectorProps> = ({
  selectedGoals,
  onGoalsChange,
  onNext,
  onBack,
  isLoading = false,
}) => {
  const toggleGoal = (goalId: UserGoal) => {
    if (selectedGoals.includes(goalId)) {
      onGoalsChange(selectedGoals.filter((g) => g !== goalId));
    } else {
      onGoalsChange([...selectedGoals, goalId]);
    }
  };

  return (
    <div className="flex flex-col min-h-[60vh] px-6 py-4">
      {/* Header */}
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold mb-2">What would you like to do?</h2>
        <p className="text-muted-foreground">
          Select all that apply — you can always explore more later
        </p>
      </div>

      {/* Goal options */}
      <div className="space-y-3 flex-1">
        {goals.map((goal) => {
          const isSelected = selectedGoals.includes(goal.id);
          return (
            <Label
              key={goal.id}
              htmlFor={goal.id}
              className={cn(
                "flex items-start gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all",
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 hover:bg-muted/50"
              )}
            >
              <Checkbox
                id={goal.id}
                checked={isSelected}
                onCheckedChange={() => toggleGoal(goal.id)}
                className="mt-0.5"
              />
              <div className={cn(
                "w-10 h-10 rounded-lg flex items-center justify-center",
                isSelected ? "bg-primary text-primary-foreground" : "bg-muted"
              )}>
                {goal.icon}
              </div>
              <div className="flex-1">
                <div className="font-medium">{goal.label}</div>
                <div className="text-sm text-muted-foreground">{goal.description}</div>
              </div>
            </Label>
          );
        })}
      </div>

      {/* Navigation */}
      <div className="flex gap-3 mt-8">
        <Button variant="outline" onClick={onBack} className="flex-1" disabled={isLoading}>
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back
        </Button>
        <Button 
          onClick={onNext} 
          disabled={selectedGoals.length === 0 || isLoading}
          className="flex-1"
        >
          {isLoading ? (
            <>
              <span className="animate-pulse">Generating...</span>
            </>
          ) : (
            <>
              Finish
              <ChevronRight className="w-4 h-4 ml-1" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
};

export default GoalsSelector;
