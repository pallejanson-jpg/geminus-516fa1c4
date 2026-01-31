import React from 'react';
import { Button } from '@/components/ui/button';
import { Sparkles, Building2, BarChart3, Package } from 'lucide-react';

interface WelcomeStepProps {
  onNext: () => void;
}

const WelcomeStep: React.FC<WelcomeStepProps> = ({ onNext }) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      {/* Animated icon cluster */}
      <div className="relative mb-8">
        <div className="absolute -inset-8 bg-primary/10 rounded-full blur-2xl animate-pulse" />
        <div className="relative grid grid-cols-2 gap-3">
          <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center animate-bounce" style={{ animationDelay: '0ms' }}>
            <Building2 className="w-8 h-8 text-primary" />
          </div>
          <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center animate-bounce" style={{ animationDelay: '150ms' }}>
            <Package className="w-8 h-8 text-primary" />
          </div>
          <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center animate-bounce" style={{ animationDelay: '300ms' }}>
            <BarChart3 className="w-8 h-8 text-primary" />
          </div>
          <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center animate-bounce" style={{ animationDelay: '450ms' }}>
            <Sparkles className="w-8 h-8 text-primary" />
          </div>
        </div>
      </div>

      {/* Welcome text */}
      <h1 className="text-3xl sm:text-4xl font-bold mb-4">
        Welcome to Geminus
      </h1>
      
      <p className="text-lg text-muted-foreground mb-2 max-w-md">
        Your digital twin platform for smarter facility management
      </p>
      
      <p className="text-sm text-muted-foreground mb-8 max-w-sm">
        Let's personalize your experience with a quick setup
      </p>

      {/* Features preview */}
      <div className="grid grid-cols-3 gap-4 mb-10 max-w-sm w-full">
        <div className="text-center">
          <div className="text-2xl font-bold text-primary">3D</div>
          <div className="text-xs text-muted-foreground">Building Models</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-primary">IoT</div>
          <div className="text-xs text-muted-foreground">Live Sensors</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-primary">AI</div>
          <div className="text-xs text-muted-foreground">Insights</div>
        </div>
      </div>

      {/* CTA Button */}
      <Button 
        size="lg" 
        onClick={onNext}
        className="min-w-[200px] h-12 text-base font-medium"
      >
        Get Started
        <Sparkles className="w-4 h-4 ml-2" />
      </Button>
    </div>
  );
};

export default WelcomeStep;
