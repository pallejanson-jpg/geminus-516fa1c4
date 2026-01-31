import React from 'react';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Wrench, Building, Users, HelpCircle, ChevronRight, ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

export type UserRole = 'fm_technician' | 'property_manager' | 'consultant' | 'other';

interface RoleSelectorProps {
  selectedRole: UserRole | null;
  onRoleChange: (role: UserRole) => void;
  onNext: () => void;
  onBack: () => void;
}

const roles: { id: UserRole; label: string; description: string; icon: React.ReactNode }[] = [
  {
    id: 'fm_technician',
    label: 'FM Technician',
    description: 'Maintain equipment, manage work orders, register inventory',
    icon: <Wrench className="w-5 h-5" />,
  },
  {
    id: 'property_manager',
    label: 'Property Manager',
    description: 'Oversee buildings, track performance, manage tenants',
    icon: <Building className="w-5 h-5" />,
  },
  {
    id: 'consultant',
    label: 'FM Consultant',
    description: 'Analyze data, optimize operations, advise clients',
    icon: <Users className="w-5 h-5" />,
  },
  {
    id: 'other',
    label: 'Other',
    description: 'Explorer, developer, or other professional',
    icon: <HelpCircle className="w-5 h-5" />,
  },
];

const RoleSelector: React.FC<RoleSelectorProps> = ({
  selectedRole,
  onRoleChange,
  onNext,
  onBack,
}) => {
  return (
    <div className="flex flex-col min-h-[60vh] px-6 py-4">
      {/* Header */}
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold mb-2">What's your role?</h2>
        <p className="text-muted-foreground">
          This helps us personalize your experience
        </p>
      </div>

      {/* Role options */}
      <RadioGroup
        value={selectedRole || ''}
        onValueChange={(value) => onRoleChange(value as UserRole)}
        className="space-y-3 flex-1"
      >
        {roles.map((role) => (
          <Label
            key={role.id}
            htmlFor={role.id}
            className={cn(
              "flex items-start gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all",
              selectedRole === role.id
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-muted/50"
            )}
          >
            <RadioGroupItem value={role.id} id={role.id} className="mt-0.5" />
            <div className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center",
              selectedRole === role.id ? "bg-primary text-primary-foreground" : "bg-muted"
            )}>
              {role.icon}
            </div>
            <div className="flex-1">
              <div className="font-medium">{role.label}</div>
              <div className="text-sm text-muted-foreground">{role.description}</div>
            </div>
          </Label>
        ))}
      </RadioGroup>

      {/* Navigation */}
      <div className="flex gap-3 mt-8">
        <Button variant="outline" onClick={onBack} className="flex-1">
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back
        </Button>
        <Button 
          onClick={onNext} 
          disabled={!selectedRole}
          className="flex-1"
        >
          Continue
          <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>
  );
};

export default RoleSelector;
