import React, { useState, useEffect, useContext } from 'react';
import { User, Camera, Sun, Moon, Palette, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { AppContext, ThemeType } from '@/context/AppContext';
import { THEME_OPTIONS } from '@/lib/constants';
import { useLanguage } from '@/context/LanguageContext';

interface UserProfile {
  displayName: string;
  email: string;
  avatarUrl: string | null;
}

const ProfileSettings: React.FC = () => {
  const { toast } = useToast();
  const { theme, setTheme } = useContext(AppContext);
  const { language, setLanguage, t } = useLanguage();
  
  const [profile, setProfile] = useState<UserProfile>({
    displayName: '',
    email: '',
    avatarUrl: null,
  });
  const [isSaving, setIsSaving] = useState(false);

  // Load profile from localStorage on mount
  useEffect(() => {
    const savedProfile = localStorage.getItem('userProfile');
    if (savedProfile) {
      try {
        const parsed = JSON.parse(savedProfile);
        setProfile(prev => ({
          ...prev,
          displayName: parsed.displayName || '',
          email: parsed.email || '',
          avatarUrl: parsed.avatarUrl || null,
        }));
      } catch (e) {
        console.error('Failed to parse saved profile:', e);
      }
    }
  }, []);

  const handleSaveProfile = async () => {
    setIsSaving(true);
    try {
      // Save to localStorage
      const profileData = {
        displayName: profile.displayName,
        email: profile.email,
        avatarUrl: profile.avatarUrl,
        theme: theme,
      };
      localStorage.setItem('userProfile', JSON.stringify(profileData));
      
      toast({
        title: 'Profile saved',
        description: 'Your profile settings have been saved.',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Could not save',
        description: error.message || 'An error occurred while saving.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAvatarUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Convert to base64 for localStorage storage
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      setProfile(prev => ({ ...prev, avatarUrl: base64 }));
    };
    reader.readAsDataURL(file);
  };

  const getInitials = () => {
    if (profile.displayName) {
      return profile.displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }
    return 'U';
  };

  return (
    <div className="space-y-6">
      {/* Avatar Section */}
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <Avatar className="h-24 w-24">
            <AvatarImage src={profile.avatarUrl || undefined} />
            <AvatarFallback className="bg-primary text-primary-foreground text-2xl">
              {getInitials()}
            </AvatarFallback>
          </Avatar>
          <label 
            htmlFor="avatar-upload" 
            className="absolute bottom-0 right-0 bg-primary text-primary-foreground p-2 rounded-full cursor-pointer hover:bg-primary/90 transition-colors"
          >
            <Camera size={16} />
            <input
              id="avatar-upload"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarUpload}
            />
          </label>
        </div>
        <p className="text-sm text-muted-foreground">{t('Klicka på kameran för att ladda upp ett foto', 'Click the camera to upload a photo')}</p>
      </div>

      {/* Name & Email */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="displayName">{t('Namn', 'Name')}</Label>
          <Input
            id="displayName"
            value={profile.displayName}
            onChange={(e) => setProfile(prev => ({ ...prev, displayName: e.target.value }))}
            placeholder={t('Ditt namn', 'Your name')}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={profile.email}
            onChange={(e) => setProfile(prev => ({ ...prev, email: e.target.value }))}
            placeholder="you@email.com"
          />
          <p className="text-xs text-muted-foreground">
            {t('E-post används för identifiering (autentisering kommer snart)', 'Email is used for identification (authentication coming soon)')}
          </p>
        </div>
      </div>

      {/* Theme Section */}
      <div className="space-y-4 pt-4 border-t">
        <div className="flex items-center gap-2">
          <Palette size={18} />
          <Label className="text-base font-medium">{t('Tema', 'Theme')}</Label>
        </div>
        
        <div className="grid grid-cols-3 gap-3">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setTheme(option.value as ThemeType)}
              className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all ${
                theme === option.value 
                  ? 'border-primary bg-primary/10' 
                  : 'border-border hover:border-primary/50 hover:bg-muted'
              }`}
            >
              <div className="flex gap-1">
                {option.colors.map((color, i) => (
                  <div 
                    key={i}
                    className="w-5 h-5 rounded-full border border-border"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <span className="text-sm font-medium">{option.label}</span>
              {option.value === 'dark' && <Moon size={14} className="text-muted-foreground" />}
              {option.value === 'light' && <Sun size={14} className="text-muted-foreground" />}
            </button>
          ))}
        </div>
      </div>

      {/* Language Section */}
      <div className="space-y-4 pt-4 border-t">
        <div className="flex items-center gap-2">
          <Globe size={18} />
          <Label className="text-base font-medium">{t('Språk', 'Language')}</Label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setLanguage('sv')}
            className={`flex items-center justify-center gap-2 p-3 rounded-lg border-2 transition-all ${
              language === 'sv'
                ? 'border-primary bg-primary/10'
                : 'border-border hover:border-primary/50 hover:bg-muted'
            }`}
          >
            <span>🇸🇪</span>
            <span className="text-sm font-medium">Svenska</span>
          </button>
          <button
            onClick={() => setLanguage('en')}
            className={`flex items-center justify-center gap-2 p-3 rounded-lg border-2 transition-all ${
              language === 'en'
                ? 'border-primary bg-primary/10'
                : 'border-border hover:border-primary/50 hover:bg-muted'
            }`}
          >
            <span>🇬🇧</span>
            <span className="text-sm font-medium">English</span>
          </button>
        </div>
      </div>

      {/* Save Button */}
      <div className="pt-4 border-t">
        <Button onClick={handleSaveProfile} disabled={isSaving} className="w-full">
          {isSaving ? t('Sparar...', 'Saving...') : t('Spara profil', 'Save Profile')}
        </Button>
      </div>
    </div>
  );
};

export default ProfileSettings;
