import React from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type PlaceholderViewProps = {
  title: string;
  icon: React.ReactNode;
  description: string;
};

export default function PlaceholderView({ title, icon, description }: PlaceholderViewProps) {
  return (
    <div className="h-full flex items-center justify-center p-4 sm:p-8">
      <Card className="max-w-md w-full text-center">
        <CardHeader>
          <div className="mx-auto mb-4 h-14 w-14 sm:h-16 sm:w-16 rounded-full bg-primary/10 flex items-center justify-center">
            {icon}
          </div>
          <CardTitle className="text-lg sm:text-xl">{title}</CardTitle>
          <CardDescription className="text-sm">{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs sm:text-sm text-muted-foreground">This feature is coming soon.</p>
        </CardContent>
      </Card>
    </div>
  );
}
