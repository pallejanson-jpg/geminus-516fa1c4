import React from 'react';
import { Card, CardContent } from '@/components/ui/card';

interface KpiCardProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
  onClick?: () => void;
}

// Format number to use proper locale formatting without excessive decimals
const formatValue = (value: string | number): string => {
  if (typeof value === 'number') {
    return value.toLocaleString('sv-SE', { maximumFractionDigits: 2 });
  }
  const numMatch = value.match(/^([\d\s,.]+)\s*(m²|kWh.*|%)?$/);
  if (numMatch) {
    const numPart = numMatch[1].replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(numPart);
    if (!isNaN(num)) {
      const unit = numMatch[2] || '';
      const formatted = num.toLocaleString('sv-SE', { maximumFractionDigits: 1 });
      return unit ? `${formatted} ${unit}` : formatted;
    }
  }
  return value;
};

const KpiCard: React.FC<KpiCardProps> = ({ title, value, icon: Icon, onClick }) => {
  const baseClasses = "h-full transition-all";
  const interactiveClasses = onClick ? "cursor-pointer hover:border-primary/50 hover:bg-muted" : "";
  
  const displayValue = formatValue(value);
  
  const content = (
    <CardContent className="p-3 sm:p-4 flex flex-col justify-between h-full">
      <div className="flex items-center gap-2 text-muted-foreground text-[11px] sm:text-xs uppercase font-bold">
        <Icon size={14} className="sm:w-4 sm:h-4 flex-shrink-0" />
        <span className="truncate">{title}</span>
      </div>
      <p className="text-lg sm:text-2xl font-bold text-foreground mt-1 truncate">{displayValue}</p>
    </CardContent>
  );

  if (onClick) {
    return (
      <Card className={`${baseClasses} ${interactiveClasses}`} onClick={onClick}>
        {content}
      </Card>
    );
  }

  return (
    <Card className={baseClasses}>
      {content}
    </Card>
  );
};

export default KpiCard;
