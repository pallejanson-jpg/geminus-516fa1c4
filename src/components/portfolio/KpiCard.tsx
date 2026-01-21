import React from 'react';
import { Card, CardContent } from '@/components/ui/card';

interface KpiCardProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
  onClick?: () => void;
}

const KpiCard: React.FC<KpiCardProps> = ({ title, value, icon: Icon, onClick }) => {
  const baseClasses = "h-full transition-all";
  const interactiveClasses = onClick ? "cursor-pointer hover:border-primary/50 hover:bg-muted" : "";
  
  const content = (
    <CardContent className="p-4 flex flex-col justify-between h-full">
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase font-bold">
        <Icon size={14} />
        <span>{title}</span>
      </div>
      <p className="text-2xl font-bold text-foreground mt-1">{value}</p>
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
