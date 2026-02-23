import { Building2, MapPin, MoreVertical, Plus, Search } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const properties = [
  {
    id: 1,
    name: "Kontorshus Centrum",
    address: "Storgatan 15, Stockholm",
    type: "Kontor",
    area: "4 500 m²",
    status: "active",
  },
  {
    id: 2,
    name: "Lagerlokaler Syd",
    address: "Industrivägen 42, Malmö",
    type: "Lager",
    area: "12 000 m²",
    status: "active",
  },
  {
    id: 3,
    name: "Kv. Björken",
    address: "Björkgatan 8-12, Göteborg",
    type: "Bostäder",
    area: "8 200 m²",
    status: "maintenance",
  },
  {
    id: 4,
    name: "Handelsfastigheten",
    address: "Köpcentrum 1, Uppsala",
    type: "Handel",
    area: "15 800 m²",
    status: "active",
  },
  {
    id: 5,
    name: "Teknikparken",
    address: "Innovationsvägen 5, Lund",
    type: "Kontor",
    area: "6 300 m²",
    status: "pending",
  },
];

const statusConfig = {
  active: { label: "Active", variant: "default" as const },
  maintenance: { label: "Maintenance", variant: "secondary" as const },
  pending: { label: "Pending", variant: "outline" as const },
};

export default function Properties() {
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Properties</h1>
          <p className="text-muted-foreground">
            Manage your property portfolio
          </p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add property
        </Button>
      </div>

      {/* Search and Filters */}
      <div className="flex gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search properties..."
            className="pl-9"
          />
        </div>
      </div>

      {/* Properties Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {properties.map((property) => (
          <Card key={property.id} className="group hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-start justify-between pb-2">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">{property.name}</CardTitle>
                  <CardDescription className="flex items-center gap-1 text-xs">
                    <MapPin className="h-3 w-3" />
                    {property.address}
                  </CardDescription>
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem>View details</DropdownMenuItem>
                  <DropdownMenuItem>Edit</DropdownMenuItem>
                  <DropdownMenuItem>3D View</DropdownMenuItem>
                  <DropdownMenuItem>Documents</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Type</p>
                  <p className="text-sm font-medium">{property.type}</p>
                </div>
                <div className="space-y-1 text-right">
                  <p className="text-xs text-muted-foreground">Area</p>
                  <p className="text-sm font-medium">{property.area}</p>
                </div>
              </div>
              <div className="mt-4">
                <Badge variant={statusConfig[property.status as keyof typeof statusConfig].variant}>
                  {statusConfig[property.status as keyof typeof statusConfig].label}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
