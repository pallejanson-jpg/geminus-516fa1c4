import React, { useState, useEffect, useContext } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { User } from 'lucide-react';
import { AppContext } from '@/context/AppContext';
import ProfileSettings from './ProfileSettings';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Dedicated modal for user profile settings.
 * Separated from system settings (ApiSettingsModal) for clearer UX.
 */
const ProfileModal: React.FC<ProfileModalProps> = ({ isOpen, onClose }) => {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="pr-8">
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Profil
          </DialogTitle>
          <DialogDescription>
            Dina personliga inställningar och tema.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          <ProfileSettings />
        </div>

        <div className="flex justify-end mt-6">
          <Button onClick={onClose}>Stäng</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ProfileModal;
