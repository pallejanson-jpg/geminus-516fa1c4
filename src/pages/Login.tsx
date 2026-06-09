import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import chicagoHero from '@/assets/chicago-skyline-hero.jpg';

const Login: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    navigate('/', { replace: true });
  }, [navigate]);

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-background to-muted">
      <div className="hidden md:flex md:w-1/2 lg:w-3/5 relative items-end p-8">
        <img
          src={chicagoHero}
          alt="Building overview"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/60 to-transparent" />
        <div className="relative z-10 max-w-md text-white space-y-3">
          <h2 className="text-2xl lg:text-3xl font-bold">Geminus</h2>
          <p className="text-sm lg:text-base text-white/80 leading-relaxed">
            Authentication is temporarily disabled while we continue development.
          </p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-xl sm:text-2xl">Authentication Disabled</CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              The app is currently running without login. Continue to the application below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              variant="outline"
              className="w-full h-12 text-sm sm:text-base"
              onClick={() => navigate('/', { replace: true })}
            >
              Continue to App
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Login;
