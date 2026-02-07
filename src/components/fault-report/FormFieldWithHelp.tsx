import React from 'react';
import { HelpCircle } from 'lucide-react';
import { FormLabel } from '@/components/ui/form';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface FormFieldWithHelpProps {
  label: string;
  required?: boolean;
  helpText?: string;
}

const FormFieldWithHelp: React.FC<FormFieldWithHelpProps> = ({
  label,
  required,
  helpText,
}) => {
  return (
    <div className="flex items-center gap-1.5">
      <FormLabel className="mb-0">
        {label}
        {required && ' *'}
      </FormLabel>
      {helpText && (
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center justify-center text-primary hover:text-primary/80 focus:outline-none"
                tabIndex={-1}
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[260px] text-sm">
              {helpText}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
};

export default FormFieldWithHelp;
