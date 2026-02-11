import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { User, Bot } from 'lucide-react';
import ProfileSettings from './ProfileSettings';
import GunnarSettings from './GunnarSettings';
import IleanSettings from './IleanSettings';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Dedicated modal for user profile settings and AI assistant configuration.
 * Separated from system settings (ApiSettingsModal) for clearer UX.
 */
const ProfileModal: React.FC<ProfileModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState('profile');

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg w-[calc(100vw-1rem)] max-h-[calc(100dvh-2rem)] overflow-hidden flex flex-col">
        <DialogHeader className="pr-8">
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Profil & Assistenter
          </DialogTitle>
          <DialogDescription>
            Dina personliga inställningar, tema och AI-assistenter.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="profile" className="gap-2">
              <User className="h-4 w-4" />
              Profil
            </TabsTrigger>
            <TabsTrigger value="assistants" className="gap-2">
              <Bot className="h-4 w-4" />
              AI-assistenter
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto mt-4">
            <TabsContent value="profile" className="m-0">
              <ProfileSettings />
            </TabsContent>

            <TabsContent value="assistants" className="m-0 space-y-6">
              <GunnarSettings />
              <div className="border-t pt-6">
                <IleanSettings />
              </div>
            </TabsContent>
          </div>
        </Tabs>

        <div className="flex justify-end mt-4 pt-4 border-t">
          <Button onClick={onClose}>Stäng</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ProfileModal;
