import React from 'react';
import { cn } from '@/lib/utils';

interface AudioVisualizerProps {
  isActive: boolean;
  className?: string;
  barCount?: number;
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ 
  isActive, 
  className,
  barCount = 5 
}) => {
  return (
    <div className={cn("flex items-center justify-center gap-1 h-8", className)}>
      {[...Array(barCount)].map((_, i) => (
        <div 
          key={i}
          className={cn(
            "w-1 bg-primary rounded-full transition-all duration-150",
            isActive ? "animate-sound-wave" : "h-1"
          )}
          style={{ 
            animationDelay: `${i * 0.1}s`,
            animationDuration: `${0.4 + (i % 3) * 0.1}s`
          }}
        />
      ))}
    </div>
  );
};

export default AudioVisualizer;
