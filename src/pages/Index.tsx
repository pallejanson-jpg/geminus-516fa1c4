import { Building2 } from "lucide-react";

const Index = () => {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background">
      <div className="text-center space-y-6 animate-fade-in">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-primary/10 mb-2">
          <Building2 className="w-10 h-10 text-primary" />
        </div>
        <div className="space-y-2">
          <h1 className="text-4xl font-semibold tracking-tight text-foreground">
            Asset Management
          </h1>
          <p className="text-lg text-muted-foreground max-w-md">
            Fastighetshantering för professionella fastighetsägare
          </p>
        </div>
        <div className="pt-4">
          <p className="text-sm text-muted-foreground">
            Klistra in din Firebase-kod för att komma igång
          </p>
        </div>
      </div>
    </div>
  );
};

export default Index;
