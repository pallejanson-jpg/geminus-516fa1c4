import React, { useCallback } from "react";
import { Database, FileQuestion, Sparkles } from "lucide-react";

import { DEFAULT_APP_CONFIGS } from "@/lib/constants";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import chicagoHero from "@/assets/chicago-skyline-hero.jpg";

type AssistantType = "gunnar" | "ilean" | "doris";

const ASSISTANTS: Array<{
  id: AssistantType;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "gunnar", title: "Gunnar", subtitle: "Data Assistant", icon: Database },
  { id: "ilean", title: "Ilean", subtitle: "Document Assistant", icon: FileQuestion },
  { id: "doris", title: "Doris", subtitle: "FM Access Assistant", icon: Sparkles },
];

export default function HomeLanding() {
  const { toast } = useToast();

  const openAssistant = useCallback(
    (type: AssistantType) => {
      // UI-only migration: assistant functionality is not implemented in Lovable yet.
      toast({
        title: "AI-assistent (kommer snart)",
        description: `Du klickade på ${type}. Jag kan koppla detta till en riktig assistent när du vill.`,
      });
    },
    [toast],
  );

  return (
    <div className="relative min-h-full">
      {/* Full-page background */}
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${chicagoHero})` }}
        aria-hidden="true"
      />
      {/* Overlay for readability (uses design tokens) */}
      <div className="pointer-events-none absolute inset-0 bg-background/70" aria-hidden="true" />

      <div className="relative z-10 px-6 py-6 space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Välkommen till My SWG</h1>
          <p className="text-muted-foreground">Din digitala ryggrad för digital twins och fastighetsdata</p>
        </header>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">AI Assistants</h2>
          <p className="text-sm text-muted-foreground">Snabb hjälp för data, dokument och integrationer</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ASSISTANTS.map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => openAssistant(a.id)}
                className="rounded-xl border border-border bg-card/60 p-4 text-left transition-colors hover:bg-muted"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold leading-none">{a.title}</div>
                    <div className="text-sm text-muted-foreground">{a.subtitle}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <Card className="bg-card/60">
          <CardHeader>
            <CardTitle className="text-lg">Mina favoriter</CardTitle>
            <CardDescription>Snabb åtkomst till dina mest använda byggnader</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-dashed border-border p-4">
              <p className="text-sm text-muted-foreground">
                Inga favoriter än. När vi kopplar in favoriter från Portfölj kan vi lista dem här.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>
      </div>
    </div>
  );
}
