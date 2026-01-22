import React from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type PlaceholderViewProps = {
  title: string;
  icon: React.ReactNode;
  description: string;
};

export default function PlaceholderView({ title, icon, description }: PlaceholderViewProps) {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <Card className="max-w-md w-full text-center">
        <CardHeader>
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
            {icon}
          </div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Denna vy kommer att migreras från Firebase-projektet.</p>
        </CardContent>
      </Card>
    </div>
  );
}
