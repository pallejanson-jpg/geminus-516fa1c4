import React from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface ClearableInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  value?: string;
  onClear: () => void;
}

const ClearableInput = React.forwardRef<HTMLInputElement, ClearableInputProps>(
  ({ value, onClear, className, ...props }, ref) => {
    return (
      <div className="relative">
        <Input ref={ref} value={value} className={className} {...props} />
        {value && value.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded-sm"
            tabIndex={-1}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }
);

ClearableInput.displayName = 'ClearableInput';

export default ClearableInput;
