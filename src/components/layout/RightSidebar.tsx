import React, { useContext, useState } from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { 
  LifeBuoy, BookOpen, MessageSquare, X, HelpCircle, Search, 
  ExternalLink, Bot, FileText, Code, ChevronRight, Loader2,
  Send
} from 'lucide-react';
import { THEMES } from '@/lib/constants';
import { AppContext } from '@/context/AppContext';
import { AppButton } from '@/components/common/AppButton';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

// Help article structure
interface HelpArticle {
  id: string;
  title: string;
  category: string;
  app: string;
  content: string;
  keywords: string[];
}

// Sample help articles (to be expanded with real content)
const HELP_ARTICLES: HelpArticle[] = [
  {
    id: 'getting-started',
    title: 'Kom igång med Geminus',
    category: 'Grundläggande',
    app: 'Geminus',
    content: 'Geminus är en plattform för fastighetsförvaltning som samlar alla dina FM-verktyg på ett ställe.',
    keywords: ['start', 'introduktion', 'översikt'],
  },
  {
    id: 'navigator',
    title: 'Använda Navigator',
    category: 'Navigation',
    app: 'Geminus',
    content: 'Navigator visar en hierarkisk vy av alla dina fastigheter, våningar och rum.',
    keywords: ['navigator', 'träd', 'hierarki', 'sök'],
  },
  {
    id: '3d-viewer',
    title: '3D-visaren',
    category: '3D',
    app: 'Asset+',
    content: 'Använd 3D-visaren för att utforska byggnadsmodeller, mäta avstånd och visa rumsdata.',
    keywords: ['3d', 'viewer', 'modell', 'bim'],
  },
  {
    id: 'fma-plus',
    title: 'FM Access Plus',
    category: 'Integration',
    app: 'FM Access',
    content: 'FM Access Plus ger dig tillgång till underhållsplanering och arbetsordrar.',
    keywords: ['fma', 'underhåll', 'arbetsorder'],
  },
  {
    id: 'ivion',
    title: 'Ivion 360',
    category: 'Integration',
    app: 'Ivion',
    content: 'Ivion möjliggör 360-graders visning av byggnader och utrymmen.',
    keywords: ['ivion', '360', 'panorama'],
  },
  {
    id: 'senslink',
    title: 'Senslink IoT',
    category: 'Integration',
    app: 'Senslink',
    content: 'Senslink samlar in och visualiserar data från IoT-sensorer i dina fastigheter.',
    keywords: ['senslink', 'iot', 'sensorer', 'data'],
  },
];

// API Documentation categories
const API_CATEGORIES = [
  {
    name: 'Objekthantering',
    endpoints: [
      { method: 'POST', path: '/AddObject', description: 'Skapa nytt objekt' },
      { method: 'PUT', path: '/EditObject', description: 'Redigera befintligt objekt' },
      { method: 'DELETE', path: '/DeleteObject', description: 'Ta bort objekt' },
      { method: 'POST', path: '/AddObjectList', description: 'Skapa flera objekt' },
    ],
  },
  {
    name: 'Datainhämtning',
    endpoints: [
      { method: 'GET', path: '/GetObjectsByPage', description: 'Hämta objekt paginerat' },
      { method: 'POST', path: '/GetObjectByFmGuid', description: 'Hämta objekt via FMGUID' },
      { method: 'POST', path: '/PublishDataServiceGetMerged', description: 'Hämta sammanslagen data' },
    ],
  },
  {
    name: 'Revisioner',
    endpoints: [
      { method: 'POST', path: '/PublishRevision', description: 'Publicera revision' },
      { method: 'POST', path: '/RestoreRevisionAndXktData', description: 'Återställ revision' },
    ],
  },
  {
    name: '3D Viewer',
    endpoints: [
      { method: '-', path: 'cutOutFloorByFmGuid', description: 'Klipp ut våningsplan' },
      { method: '-', path: 'selectFmGuidAndViewFit', description: 'Välj och zooma till objekt' },
      { method: '-', path: 'useTool', description: 'Aktivera verktyg (measure, slicer)' },
    ],
  },
];

const RightSidebar: React.FC = () => {
  const { theme, isRightSidebarVisible, toggleRightSidebar, activeApp, viewer3dFmGuid, viewerDiagnostics } = useContext(AppContext);
  const t = THEMES[theme];
  
  const [helpSearch, setHelpSearch] = useState('');
  const [chatMessage, setChatMessage] = useState('');
  const [chatMessages, setChatMessages] = useState<Array<{role: 'user' | 'assistant', content: string}>>([
    { role: 'assistant', content: 'Hej! Jag är din hjälpassistent. Ställ gärna frågor om plattformen, API:er eller integrationer.' }
  ]);
  const [isChatLoading, setIsChatLoading] = useState(false);

  // Filter help articles based on search
  const filteredArticles = HELP_ARTICLES.filter(article => {
    if (!helpSearch.trim()) return true;
    const searchLower = helpSearch.toLowerCase();
    return (
      article.title.toLowerCase().includes(searchLower) ||
      article.content.toLowerCase().includes(searchLower) ||
      article.keywords.some(k => k.includes(searchLower)) ||
      article.app.toLowerCase().includes(searchLower)
    );
  });

  const handleSendChat = async () => {
    if (!chatMessage.trim()) return;
    
    const userMsg = chatMessage.trim();
    setChatMessage('');
    setChatMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsChatLoading(true);

    // Simulate AI response (replace with actual Lovable AI call)
    setTimeout(() => {
      setChatMessages(prev => [...prev, { 
        role: 'assistant', 
        content: 'Tack för din fråga! Chat-funktionen är under utveckling. Snart kommer du kunna prata med våra supporttekniker och AI-assistenter här.' 
      }]);
      setIsChatLoading(false);
    }, 1000);
  };

  if (!isRightSidebarVisible) {
    return null;
  }

  return (
    <aside className={`fixed top-0 bottom-0 right-0 z-50 w-80 sm:w-96 animate-in slide-in-from-right duration-300 border-l ${t.border} ${t.bgSec} flex flex-col overflow-hidden`}>
      {/* Header */}
      <div className={`p-3 sm:p-4 ${t.bg} flex justify-between items-center border-b ${t.border} shrink-0`}>
        <h2 className="font-bold text-base sm:text-lg flex items-center gap-2">
          <HelpCircle size={18} className="text-primary" />
          Hjälpcenter
        </h2>
        <AppButton variant="ghost" className="h-8 w-8 p-0" onClick={toggleRightSidebar}>
          <X size={18}/>
        </AppButton>
      </div>

      {/* Main Content with Tabs */}
      <Tabs defaultValue="support" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="w-full justify-start rounded-none border-b px-2 h-auto py-1 bg-transparent shrink-0">
          <TabsTrigger value="support" className="text-xs gap-1 data-[state=active]:bg-muted">
            <LifeBuoy size={14} />
            Support
          </TabsTrigger>
          <TabsTrigger value="docs" className="text-xs gap-1 data-[state=active]:bg-muted">
            <BookOpen size={14} />
            Dokumentation
          </TabsTrigger>
          <TabsTrigger value="api" className="text-xs gap-1 data-[state=active]:bg-muted">
            <Code size={14} />
            API
          </TabsTrigger>
          <TabsTrigger value="chat" className="text-xs gap-1 data-[state=active]:bg-muted">
            <MessageSquare size={14} />
            Chatt
          </TabsTrigger>
        </TabsList>

        {/* Support Tab */}
        <TabsContent value="support" className="flex-1 flex flex-col overflow-hidden mt-0">
          <div className="p-3 border-b">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Sök i hjälptexter..."
                value={helpSearch}
                onChange={(e) => setHelpSearch(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
          </div>
          
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-2">
              {filteredArticles.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Inga artiklar hittades</p>
                </div>
              ) : (
                filteredArticles.map(article => (
                  <div 
                    key={article.id}
                    className="p-3 border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-sm truncate">{article.title}</h4>
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                          {article.content}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {article.app}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1 mt-2">
                      <Badge variant="secondary" className="text-[10px]">
                        {article.category}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>

          {/* Quick Actions */}
          <div className="p-3 border-t space-y-2 shrink-0">
            <Button variant="outline" size="sm" className="w-full justify-start gap-2">
              <Bot size={14} />
              Fråga AI-assistenten
            </Button>
            <Button variant="outline" size="sm" className="w-full justify-start gap-2">
              <ExternalLink size={14} />
              Öppna fullständig dokumentation
            </Button>
          </div>
        </TabsContent>

        {/* Documentation Tab */}
        <TabsContent value="docs" className="flex-1 flex flex-col overflow-hidden mt-0">
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-4">
              {/* App-specific documentation sections */}
              {['Geminus', 'Asset+', 'FM Access', 'Ivion', 'Senslink'].map(app => (
                <div key={app} className="border rounded-lg overflow-hidden">
                  <div className="p-3 bg-muted/50 flex items-center justify-between">
                    <span className="font-medium text-sm">{app}</span>
                    <ChevronRight size={14} />
                  </div>
                  <div className="p-3 space-y-2">
                    {HELP_ARTICLES.filter(a => a.app === app).map(article => (
                      <div key={article.id} className="text-sm text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-2">
                        <FileText size={12} />
                        {article.title}
                      </div>
                    ))}
                    {HELP_ARTICLES.filter(a => a.app === app).length === 0 && (
                      <p className="text-xs text-muted-foreground italic">Dokumentation kommer snart...</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* API Documentation Tab */}
        <TabsContent value="api" className="flex-1 flex flex-col overflow-hidden mt-0">
          <div className="p-3 border-b shrink-0">
            <p className="text-xs text-muted-foreground">
              Asset+ API v1.0 - RESTful endpoints för integration och utveckling
            </p>
          </div>
          <ScrollArea className="flex-1">
            <Accordion type="multiple" className="w-full">
              {API_CATEGORIES.map((category, idx) => (
                <AccordionItem key={idx} value={`api-${idx}`}>
                  <AccordionTrigger className="px-3 py-2 text-sm font-medium hover:no-underline">
                    <div className="flex items-center gap-2">
                      <Code size={14} className="text-primary" />
                      {category.name}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-3 pb-3">
                    <div className="space-y-2">
                      {category.endpoints.map((endpoint, eIdx) => (
                        <div 
                          key={eIdx}
                          className="p-2 bg-muted/50 rounded text-xs font-mono flex items-center gap-2 hover:bg-muted cursor-pointer"
                        >
                          {endpoint.method !== '-' && (
                            <Badge 
                              variant={
                                endpoint.method === 'GET' ? 'default' :
                                endpoint.method === 'POST' ? 'secondary' :
                                endpoint.method === 'PUT' ? 'outline' :
                                'destructive'
                              }
                              className="text-[10px] px-1.5"
                            >
                              {endpoint.method}
                            </Badge>
                          )}
                          <span className="flex-1 truncate">{endpoint.path}</span>
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </ScrollArea>
        </TabsContent>

        {/* Chat Tab */}
        <TabsContent value="chat" className="flex-1 flex flex-col overflow-hidden mt-0">
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-3">
              {chatMessages.map((msg, idx) => (
                <div 
                  key={idx}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div 
                    className={`max-w-[85%] p-3 rounded-lg text-sm ${
                      msg.role === 'user' 
                        ? 'bg-primary text-primary-foreground' 
                        : 'bg-muted'
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              {isChatLoading && (
                <div className="flex justify-start">
                  <div className="bg-muted p-3 rounded-lg">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
          
          {/* Chat input */}
          <div className="p-3 border-t shrink-0">
            <div className="flex gap-2">
              <Textarea
                placeholder="Skriv ditt meddelande..."
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendChat();
                  }
                }}
                className="min-h-[60px] max-h-[100px] text-sm resize-none"
              />
              <Button 
                size="icon" 
                onClick={handleSendChat}
                disabled={!chatMessage.trim() || isChatLoading}
              >
                <Send size={16} />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              Tryck Enter för att skicka, Shift+Enter för ny rad
            </p>
          </div>
        </TabsContent>
      </Tabs>

      {/* 3D Diagnostics (shown when in viewer) */}
      {(activeApp === 'assetplus_viewer' || activeApp === 'viewer') && viewer3dFmGuid && viewerDiagnostics && (
        <div className={`border-t ${t.border} shrink-0`}>
          <Accordion type="single" collapsible>
            <AccordionItem value="diagnostics" className="border-0">
              <AccordionTrigger className="px-3 py-2 text-xs hover:no-underline">
                <div className="flex items-center gap-2">
                  <HelpCircle size={14} className="text-primary" />
                  3D Diagnostik
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3 text-xs">
                <div className="space-y-1">
                  <div><span className="font-medium">FMGUID:</span> <span className="break-all text-muted-foreground">{viewerDiagnostics.fmGuid}</span></div>
                  <div><span className="font-medium">Steg:</span> {viewerDiagnostics.initStep}</div>
                  <div><span className="font-medium">Modeller:</span> {viewerDiagnostics.modelCount ?? '—'}</div>
                  <div><span className="font-medium">XKT:</span> {viewerDiagnostics.xkt.attempted}/{viewerDiagnostics.xkt.ok}/{viewerDiagnostics.xkt.fail}</div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      )}
    </aside>
  );
};

export default RightSidebar;
