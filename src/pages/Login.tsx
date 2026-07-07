import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import chicagoHero from '@/assets/chicago-skyline-hero.jpg';

type Mode = 'signin' | 'signup';
type Lang = 'en' | 'sv';

const t = {
  en: {
    tagline: 'Your digital twin for real estate — building data, 3D, sensors and Geminus AI.',
    signin: 'Sign in',
    signup: 'Create account',
    signinDesc: 'Sign in with your email and password.',
    signupDesc: 'Register with email and a password (at least 6 characters).',
    name: 'Name',
    namePlaceholder: 'Your name',
    email: 'Email',
    emailPlaceholder: 'name@company.com',
    password: 'Password',
    noAccount: "Don't have an account?",
    register: 'Register',
    haveAccount: 'Already have an account?',
    createdOk: 'Account created — welcome!',
    createdConfirm: 'Account created. Check your email to confirm before signing in.',
    wrongCredentials: 'Incorrect email or password.',
    alreadyRegistered: 'Email already registered — sign in instead.',
    error: 'Something went wrong',
  },
  sv: {
    tagline: 'Din digitala tvilling för fastigheter — byggnadsdata, 3D, sensorer och Geminus AI.',
    signin: 'Logga in',
    signup: 'Skapa konto',
    signinDesc: 'Logga in med din e-post och ditt lösenord.',
    signupDesc: 'Registrera dig med e-post och valfritt lösenord (minst 6 tecken).',
    name: 'Namn',
    namePlaceholder: 'Ditt namn',
    email: 'E-post',
    emailPlaceholder: 'namn@foretag.se',
    password: 'Lösenord',
    noAccount: 'Har du inget konto?',
    register: 'Registrera dig',
    haveAccount: 'Har du redan ett konto?',
    createdOk: 'Kontot är skapat — välkommen!',
    createdConfirm: 'Kontot är skapat. Kolla din e-post för att bekräfta innan du loggar in.',
    wrongCredentials: 'Fel e-post eller lösenord.',
    alreadyRegistered: 'E-postadressen är redan registrerad — logga in i stället.',
    error: 'Något gick fel',
  },
};

const Login: React.FC = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('signin');
  const [lang, setLang] = useState<Lang>('en');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const i = t[lang];

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
          toast.success(i.createdOk);
          navigate('/', { replace: true });
        } else {
          toast.info(i.createdConfirm);
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
      const msg = err?.message || '';
      if (/invalid login credentials/i.test(msg)) {
        toast.error(i.wrongCredentials);
      } else if (/already registered/i.test(msg)) {
        toast.error(i.alreadyRegistered);
        setMode('signin');
      } else {
        toast.error(msg || i.error);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-background to-muted">
      {/* Language switch — top right */}
      <div className="absolute top-4 right-4 z-20">
        <button
          onClick={() => setLang(lang === 'en' ? 'sv' : 'en')}
          className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-sm border border-white/20 transition-colors"
        >
          <Globe className="h-3.5 w-3.5" />
          {lang === 'en' ? 'SV' : 'EN'}
        </button>
      </div>

      {/* Hero panel */}
      <div className="hidden md:flex md:w-1/2 lg:w-3/5 relative items-end p-8">
        <img
          src={chicagoHero}
          alt="Building overview"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/60 to-transparent" />
        <div className="relative z-10 max-w-md text-white space-y-3">
          <h2 className="text-2xl lg:text-3xl font-bold">Geminus</h2>
          <p className="text-sm lg:text-base text-white/80 leading-relaxed">{i.tagline}</p>
        </div>
      </div>

      {/* Login form */}
      <div className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-xl sm:text-2xl">
              {mode === 'signin' ? i.signin : i.signup}
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              {mode === 'signin' ? i.signinDesc : i.signupDesc}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'signup' && (
                <div className="space-y-2">
                  <Label htmlFor="displayName">{i.name}</Label>
                  <Input
                    id="displayName"
                    type="text"
                    placeholder={i.namePlaceholder}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    autoComplete="name"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">{i.email}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={i.emailPlaceholder}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{i.password}</Label>
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
                {mode === 'signin' ? i.signin : i.signup}
              </Button>
            </form>

            <div className="mt-4 text-center text-sm text-muted-foreground">
              {mode === 'signin' ? (
                <>
                  {i.noAccount}{' '}
                  <button
                    type="button"
                    className="text-primary hover:underline font-medium"
                    onClick={() => setMode('signup')}
                  >
                    {i.register}
                  </button>
                </>
              ) : (
                <>
                  {i.haveAccount}{' '}
                  <button
                    type="button"
                    className="text-primary hover:underline font-medium"
                    onClick={() => setMode('signin')}
                  >
                    {i.signin}
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
