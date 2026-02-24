import { Building2, FileText, Users, TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const stats = [
  {
    title: "Totalt fastigheter",
    value: "24",
    description: "+2 denna månad",
    icon: Building2,
    trend: "up",
  },
  {
    title: "Aktiva dokument",
    value: "156",
    description: "12 väntar på godkännande",
    icon: FileText,
    trend: "up",
  },
  {
    title: "Användare",
    value: "18",
    description: "3 inbjudna",
    icon: Users,
    trend: "neutral",
  },
  {
    title: "Portföljvärde",
    value: "847 MSEK",
    description: "+12% ÅöÅ",
    icon: TrendingUp,
    trend: "up",
  },
];

const recentActivities = [
  { id: 1, action: "Dokument uppladdat", property: "Kontorshus Centrum", time: "2 min sedan" },
  { id: 2, action: "3D-modell uppdaterad", property: "Lagerlokaler Syd", time: "15 min sedan" },
  { id: 3, action: "Ny användare tillagd", property: "System", time: "1 timme sedan" },
  { id: 4, action: "Rapport genererad", property: "Kv. Björken", time: "2 timmar sedan" },
];

export default function Dashboard() {
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Översikt</h1>
        <p className="text-muted-foreground">
          Överblick av din fastighetsportfölj
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Content Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Senaste aktivitet</CardTitle>
            <CardDescription>
              Aktivitet i dina fastigheter och projekt
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentActivities.map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0"
                >
                  <div>
                    <p className="text-sm font-medium">{activity.action}</p>
                    <p className="text-xs text-muted-foreground">
                      {activity.property}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {activity.time}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Snabbåtgärder</CardTitle>
            <CardDescription>
              Vanliga uppgifter och genvägar
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3">
              <button className="flex items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted">
                <Building2 className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-medium">Lägg till fastighet</p>
                  <p className="text-xs text-muted-foreground">
                    Registrera en ny fastighet
                  </p>
                </div>
              </button>
              <button className="flex items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted">
                <FileText className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-medium">Ladda upp dokument</p>
                  <p className="text-xs text-muted-foreground">
                    Lägg till ritningar eller dokument
                  </p>
                </div>
              </button>
              <button className="flex items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted">
                <Users className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-medium">Bjud in användare</p>
                  <p className="text-xs text-muted-foreground">
                    Lägg till teammedlemmar
                  </p>
                </div>
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
