import React, { useState, useEffect, useContext } from 'react';
import { User, Camera, Sun, Moon, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { AppContext, ThemeType } from '@/context/AppContext';
import { THEME_OPTIONS } from '@/lib/constants';

interface UserProfile {
  displayName: string;
  email: string;
  avatarUrl: string | null;
}

const ProfileSettings: React.FC = () => {
  const { toast } = useToast();
  const { theme, setTheme } = useContext(AppContext);
  
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
        <p className="text-sm text-muted-foreground">Click the camera to upload a photo</p>
      </div>

      {/* Name & Email */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="displayName">Name</Label>
          <Input
            id="displayName"
            value={profile.displayName}
            onChange={(e) => setProfile(prev => ({ ...prev, displayName: e.target.value }))}
            placeholder="Your name"
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
            Email is used for identification (authentication coming soon)
          </p>
        </div>
      </div>

      {/* Theme Section */}
      <div className="space-y-4 pt-4 border-t">
        <div className="flex items-center gap-2">
          <Palette size={18} />
          <Label className="text-base font-medium">Tema</Label>
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

      {/* Save Button */}
      <div className="pt-4 border-t">
        <Button onClick={handleSaveProfile} disabled={isSaving} className="w-full">
          {isSaving ? 'Sparar...' : 'Spara profil'}
        </Button>
      </div>
    </div>
  );
};

export default ProfileSettings;
