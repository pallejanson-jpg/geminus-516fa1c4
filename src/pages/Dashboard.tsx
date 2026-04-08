import { Building2, FileText, Users, TrendingUp, FolderOpen } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const stats = [
  {
    title: "Total Properties",
    value: "24",
    description: "+2 this month",
    icon: Building2,
    trend: "up",
  },
  {
    title: "Active Documents",
    value: "156",
    description: "12 pending approval",
    icon: FileText,
    trend: "up",
  },
  {
    title: "Users",
    value: "18",
    description: "3 invited",
    icon: Users,
    trend: "neutral",
  },
  {
    title: "Portfolio Value",
    value: "847 MSEK",
    description: "+12% YoY",
    icon: TrendingUp,
    trend: "up",
  },
];

const recentActivities = [
  { id: 1, action: "Document uploaded", property: "Office Center", time: "2 min ago" },
  { id: 2, action: "3D model updated", property: "Warehouse South", time: "15 min ago" },
  { id: 3, action: "New user added", property: "System", time: "1 hour ago" },
  { id: 4, action: "Report generated", property: "Block Birch", time: "2 hours ago" },
];

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <PageHeader title="Overview" description="Overview of your property portfolio" />

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
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>
              Activity in your properties and projects
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
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>
              Common tasks and shortcuts
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              <button className="flex min-h-[44px] min-w-0 flex-col items-start gap-1 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted sm:flex-row sm:items-center sm:gap-3">
                <Building2 className="h-5 w-5 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">Add property</p>
                  <p className="text-xs text-muted-foreground">
                    Register a new property
                  </p>
                </div>
              </button>
              <button className="flex min-h-[44px] min-w-0 flex-col items-start gap-1 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted sm:flex-row sm:items-center sm:gap-3">
                <FileText className="h-5 w-5 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">Upload document</p>
                  <p className="text-xs text-muted-foreground">
                    Add drawings or documents
                  </p>
                </div>
              </button>
              <button className="flex min-h-[44px] min-w-0 flex-col items-start gap-1 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted sm:flex-row sm:items-center sm:gap-3">
                <Users className="h-5 w-5 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">Invite user</p>
                  <p className="text-xs text-muted-foreground">
                    Add team members
                  </p>
                </div>
              </button>
              <button className="flex min-h-[44px] min-w-0 flex-col items-start gap-1 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted sm:flex-row sm:items-center sm:gap-3">
                <FolderOpen className="h-5 w-5 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">Docs+</p>
                  <p className="text-xs text-muted-foreground">
                    Manage documents
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
