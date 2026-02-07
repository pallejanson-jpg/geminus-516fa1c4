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

interface ErrorCodeComboboxProps {
  value: string;
  onChange: (value: string) => void;
}

// Placeholder error codes – can be extended or fetched dynamically
const ERROR_CODES = [
  { value: 'EL001', label: 'EL001 – Elektriskt fel' },
  { value: 'VVS001', label: 'VVS001 – VVS-fel' },
  { value: 'VENT001', label: 'VENT001 – Ventilationsfel' },
  { value: 'HISS001', label: 'HISS001 – Hissfel' },
  { value: 'BRAND001', label: 'BRAND001 – Brandskyddsfel' },
];

const ErrorCodeCombobox: React.FC<ErrorCodeComboboxProps> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const selectedLabel = ERROR_CODES.find((c) => c.value === value)?.label;

  const handleSelect = (selectedValue: string) => {
    onChange(selectedValue === value ? '' : selectedValue);
    setOpen(false);
  };

  const handleFreeText = () => {
    if (searchQuery.trim()) {
      onChange(searchQuery.trim());
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
            {value ? (selectedLabel || value) : 'Ange en matchande felkod'}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={true}>
          <CommandInput
            placeholder="Sök eller skriv felkod..."
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
              {ERROR_CODES.map((code) => (
                <CommandItem
                  key={code.value}
                  value={code.label}
                  onSelect={() => handleSelect(code.value)}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === code.value ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {code.label}
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
