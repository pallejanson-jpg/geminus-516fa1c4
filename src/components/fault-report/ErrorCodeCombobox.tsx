import React, { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

export interface ErrorCode {
  guid: number;
  id: string;
  title: string;
  description: string;
  context: string | null;
}

interface ErrorCodeComboboxProps {
  value: ErrorCode | null;
  onChange: (value: ErrorCode | null) => void;
  errorCodes?: ErrorCode[];
}

// Fallback error codes when none are provided from API
const FALLBACK_ERROR_CODES: ErrorCode[] = [
  { guid: 0, id: 'EL001', title: 'EL001 – Elektriskt fel', description: '', context: null },
  { guid: 0, id: 'VVS001', title: 'VVS001 – VVS-fel', description: '', context: null },
  { guid: 0, id: 'VENT001', title: 'VENT001 – Ventilationsfel', description: '', context: null },
  { guid: 0, id: 'HISS001', title: 'HISS001 – Hissfel', description: '', context: null },
  { guid: 0, id: 'BRAND001', title: 'BRAND001 – Brandskyddsfel', description: '', context: null },
];

const ErrorCodeCombobox: React.FC<ErrorCodeComboboxProps> = ({ value, onChange, errorCodes }) => {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const codes = errorCodes && errorCodes.length > 0 ? errorCodes : FALLBACK_ERROR_CODES;

  const selectedLabel = value?.title || null;

  const handleSelect = (code: ErrorCode) => {
    // Toggle off if same code selected
    if (value && value.id === code.id && value.guid === code.guid) {
      onChange(null);
    } else {
      onChange(code);
    }
    setOpen(false);
  };

  const handleFreeText = () => {
    if (searchQuery.trim()) {
      onChange({
        guid: 0,
        id: searchQuery.trim(),
        title: searchQuery.trim(),
        description: '',
        context: null,
      });
      setOpen(false);
      setSearchQuery('');
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal h-10"
        >
          <span className={cn('truncate', !value && 'text-muted-foreground')}>
            {selectedLabel || 'Enter a matching error code'}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={true}>
          <CommandInput
            placeholder="Search or enter error code..."
            value={searchQuery}
            onValueChange={setSearchQuery}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleFreeText();
              }
            }}
          />
          <CommandList>
            <CommandEmpty>
              {searchQuery.trim() ? (
                <button
                  type="button"
                  className="w-full px-2 py-1.5 text-sm text-left hover:bg-accent rounded-sm"
                  onClick={handleFreeText}
                >
                  Använd "{searchQuery.trim()}"
                </button>
              ) : (
                <span className="text-sm text-muted-foreground">Inga matchningar</span>
              )}
            </CommandEmpty>
            <CommandGroup>
              {codes.map((code) => (
                <CommandItem
                  key={`${code.guid}-${code.id}`}
                  value={code.title}
                  onSelect={() => handleSelect(code)}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value && value.id === code.id && value.guid === code.guid
                        ? 'opacity-100'
                        : 'opacity-0'
                    )}
                  />
                  {code.title}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default ErrorCodeCombobox;
