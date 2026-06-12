import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import chicagoHero from '@/assets/chicago-skyline-hero.jpg';

type Mode = 'signin' | 'signup';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Already signed in? Go straight to the app.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate('/', { replace: true });
    });
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setIsSubmitting(true);

    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: displayName.trim() ? { display_name: displayName.trim() } : undefined,
          },
        });
        if (error) throw error;
        if (data.session) {
          toast.success('Kontot är skapat — välkommen!');
          navigate('/', { replace: true });
        } else {
          // Email confirmation is enabled on the project
          toast.info('Kontot är skapat. Kolla din e-post för att bekräfta innan du loggar in.');
          setMode('signin');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        navigate('/', { replace: true });
      }
    } catch (err: any) {
      const msg = err?.message || 'Något gick fel';
      if (/invalid login credentials/i.test(msg)) {
        toast.error('Fel e-post eller lösenord.');
      } else if (/already registered/i.test(msg)) {
        toast.error('E-postadressen är redan registrerad — logga in i stället.');
        setMode('signin');
      } else {
        toast.error(msg);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

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
            Din digitala tvilling för fastigheter — byggnadsdata, 3D, sensorer och Geminus AI.
          </p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-xl sm:text-2xl">
              {mode === 'signin' ? 'Logga in' : 'Skapa konto'}
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              {mode === 'signin'
                ? 'Logga in med din e-post och ditt lösenord.'
                : 'Registrera dig med e-post och valfritt lösenord (minst 6 tecken).'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'signup' && (
                <div className="space-y-2">
                  <Label htmlFor="displayName">Namn</Label>
                  <Input
                    id="displayName"
                    type="text"
                    placeholder="Ditt namn"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    autoComplete="name"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">E-post</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="namn@foretag.se"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Lösenord</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  required
                  minLength={6}
                />
              </div>
              <Button type="submit" className="w-full h-11" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {mode === 'signin' ? 'Logga in' : 'Skapa konto'}
              </Button>
            </form>

            <div className="mt-4 text-center text-sm text-muted-foreground">
              {mode === 'signin' ? (
                <>
                  Har du inget konto?{' '}
                  <button
                    type="button"
                    className="text-primary hover:underline font-medium"
                    onClick={() => setMode('signup')}
                  >
                    Registrera dig
                  </button>
                </>
              ) : (
                <>
                  Har du redan ett konto?{' '}
                  <button
                    type="button"
                    className="text-primary hover:underline font-medium"
                    onClick={() => setMode('signin')}
                  >
                    Logga in
                  </button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Login;
