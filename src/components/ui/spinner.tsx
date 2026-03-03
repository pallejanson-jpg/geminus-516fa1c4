import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  label?: string;
}

const sizeClasses = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
  xl: 'h-12 w-12',
};

export function Spinner({ size = 'md', className, label }: SpinnerProps) {
  return (
    <div className="flex flex-col items-center gap-2">
      <Loader2
        className={cn(
          'animate-spin',
          sizeClasses[size],
          className
        )}
        style={{
          animation: 'spin 1s linear infinite, colorShift 3s ease-in-out infinite',
        }}
      />
      {label && <span className="text-sm text-muted-foreground">{label}</span>}
      <style>{`
        @keyframes colorShift {
          0%, 100% { color: hsl(262, 83%, 58%); }
          33% { color: hsl(230, 80%, 60%); }
          66% { color: hsl(190, 85%, 50%); }
        }
      `}</style>
    </div>
  );
}
