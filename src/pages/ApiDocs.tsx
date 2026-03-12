import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, Code, ChevronRight, ExternalLink, Copy, Check, Shield, Database, Globe, Camera, Thermometer, Building2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface Endpoint {
  method: string;
  path: string;
  description: string;
  params?: string;
}

interface ApiSystem {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  color: string;
  authFlow: string;
  baseUrl: string;
  categories: { name: string; endpoints: Endpoint[] }[];
}

const API_SYSTEMS: ApiSystem[] = [
  {
    id: 'assetplus',
    name: 'Asset+',
    description: 'BIM-baserat objekthanteringssystem — central datakälla för byggnadsdata',
    icon: Database,
    color: 'text-blue-500',
    authFlow: 'OAuth2 via Keycloak (password grant) + API Key i payload',
    baseUrl: '{ASSET_PLUS_API_URL}',
    categories: [
      {
        name: 'Object Management',
        endpoints: [
          { method: 'POST', path: '/AddObject', description: 'Skapa nytt objekt', params: 'objectType, designation, commonName, inRoomFmGuid' },
          { method: 'POST', path: '/AddObjectList', description: 'Skapa flera objekt', params: 'Array av objekt' },
          { method: 'PUT', path: '/EditObject', description: 'Redigera befintligt objekt' },
          { method: 'DELETE', path: '/DeleteObject', description: 'Ta bort objekt' },
          { method: 'POST', path: '/ExpireObject', description: 'Mjukradera via utgångsdatum', params: 'FmGuid, ExpireDate' },
        ],
      },
      {
        name: 'Data Retrieval',
        endpoints: [
          { method: 'POST', path: '/PublishDataServiceGetMerged', description: 'Hämta objekt med properties (huvudendpoint)', params: 'outputType, apiKey, filter' },
          { method: 'GET', path: '/GetObjectsByPage', description: 'Hämta objekt paginerat', params: 'skip, take, objectType' },
          { method: 'POST', path: '/GetObjectByFmGuid', description: 'Hämta objekt via FMGUID' },
        ],
      },
      {
        name: 'Properties & Relationships',
        endpoints: [
          { method: 'POST', path: '/UpdateBimObjectsPropertiesData', description: 'Uppdatera properties på objekt', params: 'FmGuid, UpdateProperties[]' },
          { method: 'POST', path: '/UpsertRelationships', description: 'Flytta objekt till ny förälder', params: 'FmGuid1 (parent), FmGuid2 (child)' },
        ],
      },
      {
        name: 'Revisions',
        endpoints: [
          { method: 'POST', path: '/PublishRevision', description: 'Publicera revision' },
          { method: 'POST', path: '/RestoreRevisionAndXktData', description: 'Återställ revision' },
        ],
      },
      {
        name: '3D Viewer SDK',
        endpoints: [
          { method: '-', path: 'cutOutFloorByFmGuid', description: 'Skär ut ett våningsplan i 3D' },
          { method: '-', path: 'selectFmGuidAndViewFit', description: 'Markera och zooma till objekt' },
          { method: '-', path: 'useTool', description: 'Aktivera verktyg (mätning, sektion)' },
        ],
      },
    ],
  },
  {
    id: 'fmaccess',
    name: 'FM Access',
    description: 'Tessel HDC — 2D-planritningar, ritningshantering och dokumentarkiv',
    icon: Building2,
    color: 'text-emerald-500',
    authFlow: 'OAuth2 via Keycloak + X-Authorization header + X-Hdc-Version-Id',
    baseUrl: '{FM_ACCESS_API_URL}',
    categories: [
      {
        name: 'Authentication',
        endpoints: [
          { method: 'POST', path: '/auth/realms/{realm}/protocol/openid-connect/token', description: 'Hämta access token', params: 'grant_type, client_id, username, password' },
          { method: 'GET', path: '/api/systeminfo/json', description: 'Hämta versionID (krävs för alla anrop)' },
          { method: 'GET', path: '/api/version', description: 'Hämta API-version' },
        ],
      },
      {
        name: 'Drawings',
        endpoints: [
          { method: 'GET', path: '/api/drawings', description: 'Lista ritningar för byggnad', params: 'buildingId' },
          { method: 'GET', path: '/api/drawings/{id}/pdf', description: 'Hämta ritning som PDF' },
          { method: 'GET', path: '/api/drawings/{id}/dwg', description: 'Hämta ritning som DWG' },
        ],
      },
      {
        name: 'Documents',
        endpoints: [
          { method: 'GET', path: '/api/documents', description: 'Lista dokument för byggnad' },
          { method: 'GET', path: '/api/documents/{id}', description: 'Hämta specifikt dokument' },
          { method: 'POST', path: '/api/documents', description: 'Ladda upp dokument' },
        ],
      },
      {
        name: 'Objects & Hierarchy',
        endpoints: [
          { method: 'GET', path: '/api/objects/{guid}', description: 'Hämta objekt via GUID' },
          { method: 'GET', path: '/api/hierarchy/{guid}', description: 'Hämta fullständigt underträd' },
          { method: 'GET', path: '/api/search', description: 'Sök objekt', params: 'query' },
          { method: 'POST', path: '/api/objects', description: 'Skapa objekt', params: 'parentGuid, name, classId' },
          { method: 'PUT', path: '/api/objects/{guid}', description: 'Uppdatera objekt' },
          { method: 'DELETE', path: '/api/objects/{guid}', description: 'Ta bort objekt' },
        ],
      },
    ],
  },
  {
    id: 'faciliate',
    name: 'Faciliate (SWG)',
    description: 'Fastighetsförvaltningssystem — arbetsordrar, hyreskontrakt, byggnader',
    icon: Globe,
    color: 'text-orange-500',
    authFlow: 'JWT Bearer Token via SWG REST v2 API',
    baseUrl: '{SWG_SUPPORT_URL}/api/v2',
    categories: [
      {
        name: 'Work Orders',
        endpoints: [
          { method: 'GET', path: '/workorder', description: 'Lista arbetsordrar', params: 'filter, take, skip, loadlevel' },
          { method: 'GET', path: '/workorder/{guid}', description: 'Hämta arbetsorder via GUID' },
          { method: 'POST', path: '/workorder', description: 'Skapa arbetsorder' },
          { method: 'PUT', path: '/workorder/{guid}', description: 'Uppdatera arbetsorder' },
        ],
      },
      {
        name: 'Buildings & Spaces',
        endpoints: [
          { method: 'GET', path: '/building', description: 'Lista byggnader', params: 'loadlevel, take' },
          { method: 'GET', path: '/space', description: 'Lista utrymmen', params: 'filter' },
          { method: 'GET', path: '/equipment', description: 'Lista utrustning' },
        ],
      },
      {
        name: 'Contracts',
        endpoints: [
          { method: 'GET', path: '/contract', description: 'Lista hyreskontrakt' },
          { method: 'GET', path: '/customer', description: 'Lista hyresgäster' },
        ],
      },
      {
        name: 'Load Levels',
        endpoints: [
          { method: '-', path: 'guid', description: 'Bara GUID' },
          { method: '-', path: 'basic', description: 'GUID + namn' },
          { method: '-', path: 'simple', description: 'Grundläggande fält' },
          { method: '-', path: 'fullprimary', description: 'Alla primära fält' },
          { method: '-', path: 'loadmax', description: 'Alla fält inklusive relationer' },
        ],
      },
    ],
  },
  {
    id: 'senslinc',
    name: 'Senslinc',
    description: 'IoT-plattform — sensorer, mätdata, larm och övervakning',
    icon: Thermometer,
    color: 'text-purple-500',
    authFlow: 'Basic Auth (email + password) till Senslinc REST API',
    baseUrl: '{SENSLINC_API_URL}',
    categories: [
      {
        name: 'Sites & Equipment',
        endpoints: [
          { method: 'GET', path: '/api/sites', description: 'Lista alla övervakade platser' },
          { method: 'GET', path: '/api/sites/{code}/equipment', description: 'Utrustning för en plats' },
          { method: 'GET', path: '/api/equipment/{fmGuid}', description: 'Sensorer kopplade till FM GUID' },
        ],
      },
      {
        name: 'Sensor Data (Elasticsearch)',
        endpoints: [
          { method: 'GET', path: '/api/indices', description: 'Lista tillgängliga datakällor/index' },
          { method: 'POST', path: '/api/search/{workspace_key}', description: 'Sök tidsseriedata', params: 'time_range, property_name, machine_code, size' },
        ],
      },
      {
        name: 'Measurements',
        endpoints: [
          { method: '-', path: 'temperature', description: 'Temperaturmätning (°C)' },
          { method: '-', path: 'co2', description: 'CO₂-halt (ppm)' },
          { method: '-', path: 'humidity', description: 'Luftfuktighet (%)' },
          { method: '-', path: 'energy', description: 'Energiförbrukning (kWh)' },
        ],
      },
    ],
  },
  {
    id: 'ivion',
    name: 'Ivion',
    description: '360°-panoramabilder och POI-hantering för inomhusnavigering',
    icon: Camera,
    color: 'text-cyan-500',
    authFlow: 'JWT (login → accessToken + refreshToken, 15 min expiry)',
    baseUrl: '{IVION_API_URL}',
    categories: [
      {
        name: 'Sites & Datasets',
        endpoints: [
          { method: 'GET', path: '/sites', description: 'Lista alla platser' },
          { method: 'GET', path: '/sites/{siteId}', description: 'Hämta plats' },
          { method: 'GET', path: '/sites/{siteId}/datasets', description: 'Lista datasets (per-våningsscanningar)' },
        ],
      },
      {
        name: 'Images',
        endpoints: [
          { method: 'GET', path: '/datasets/{datasetId}/images', description: 'Lista 360°-bilder i dataset' },
          { method: 'GET', path: '/images/{imageId}', description: 'Hämta specifik bild' },
        ],
      },
      {
        name: 'Points of Interest',
        endpoints: [
          { method: 'GET', path: '/sites/{siteId}/pois', description: 'Lista POI:er för plats' },
          { method: 'POST', path: '/pois', description: 'Skapa POI', params: 'name, siteId, imageId, position, metadata' },
          { method: 'PUT', path: '/pois/{poiId}', description: 'Uppdatera POI' },
          { method: 'DELETE', path: '/pois/{poiId}', description: 'Ta bort POI' },
        ],
      },
    ],
  },
];

const methodColor = (method: string) => {
  switch (method) {
    case 'GET': return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
    case 'POST': return 'bg-blue-500/15 text-blue-600 dark:text-blue-400';
    case 'PUT': return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
    case 'DELETE': return 'bg-red-500/15 text-red-600 dark:text-red-400';
    default: return 'bg-muted text-muted-foreground';
  }
};

const ApiDocs: React.FC = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const filteredSystems = useMemo(() => {
    if (!search.trim()) return API_SYSTEMS;
    const q = search.toLowerCase();
    return API_SYSTEMS.map(sys => ({
      ...sys,
      categories: sys.categories.map(cat => ({
        ...cat,
        endpoints: cat.endpoints.filter(
          ep => ep.path.toLowerCase().includes(q) || ep.description.toLowerCase().includes(q) || ep.method.toLowerCase().includes(q)
        ),
      })).filter(cat => cat.endpoints.length > 0 || cat.name.toLowerCase().includes(q)),
    })).filter(sys => sys.categories.length > 0 || sys.name.toLowerCase().includes(q) || sys.description.toLowerCase().includes(q));
  }, [search]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPath(text);
    setTimeout(() => setCopiedPath(null), 2000);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-lg font-bold">API Documentation</h1>
            <p className="text-xs text-muted-foreground">Geminus Integration Reference</p>
          </div>
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Sök endpoints..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* System Cards */}
        {filteredSystems.map(sys => {
          const Icon = sys.icon;
          const totalEndpoints = sys.categories.reduce((sum, cat) => sum + cat.endpoints.length, 0);

          return (
            <div key={sys.id} className="border rounded-xl overflow-hidden">
              {/* System Header */}
              <div className="p-4 bg-muted/30 border-b">
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg bg-background border ${sys.color}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="font-bold text-base">{sys.name}</h2>
                      <Badge variant="outline" className="text-[10px]">{totalEndpoints} endpoints</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{sys.description}</p>
                    <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Shield className="h-3 w-3" />
                        {sys.authFlow}
                      </span>
                      <span className="flex items-center gap-1 font-mono text-[11px]">
                        <Globe className="h-3 w-3" />
                        {sys.baseUrl}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Categories */}
              <Accordion type="multiple" className="w-full">
                {sys.categories.map((cat, idx) => (
                  <AccordionItem key={idx} value={`${sys.id}-${idx}`} className="border-0 border-b last:border-0">
                    <AccordionTrigger className="px-4 py-2.5 text-sm font-medium hover:no-underline hover:bg-muted/30">
                      <div className="flex items-center gap-2">
                        <Code size={14} className="text-primary" />
                        {cat.name}
                        <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{cat.endpoints.length}</Badge>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-3">
                      <div className="space-y-1.5">
                        {cat.endpoints.map((ep, eIdx) => (
                          <div
                            key={eIdx}
                            className="group p-2.5 bg-muted/30 rounded-lg text-xs font-mono flex items-start gap-2 hover:bg-muted/60 transition-colors"
                          >
                            {ep.method !== '-' ? (
                              <Badge className={`text-[10px] px-1.5 py-0 font-bold shrink-0 ${methodColor(ep.method)}`} variant="secondary">
                                {ep.method}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">SDK</Badge>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1">
                                <span className="truncate font-semibold">{ep.path}</span>
                                <button
                                  onClick={() => handleCopy(ep.path)}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                >
                                  {copiedPath === ep.path ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
                                </button>
                              </div>
                              <p className="text-muted-foreground font-sans mt-0.5">{ep.description}</p>
                              {ep.params && (
                                <p className="text-primary/70 font-sans mt-0.5 text-[11px]">Params: {ep.params}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          );
        })}

        {filteredSystems.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Code className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Inga endpoints matchar sökningen</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ApiDocs;
