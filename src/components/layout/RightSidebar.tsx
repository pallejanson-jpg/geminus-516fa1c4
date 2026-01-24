import React, { useContext } from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { LifeBuoy, BookOpen, MessageSquare, X, HelpCircle } from 'lucide-react';
import { THEMES } from '@/lib/constants';
import { AppContext } from '@/context/AppContext';
import { AppButton } from '@/components/common/AppButton';

const RightSidebar: React.FC = () => {
    const { theme, isRightSidebarVisible, toggleRightSidebar, activeApp, viewer3dFmGuid, viewerDiagnostics } = useContext(AppContext);
    const t = THEMES[theme];

    if (!isRightSidebarVisible) {
        return null;
    }

    return (
        <aside className={`fixed top-0 bottom-0 right-0 z-40 w-80 animate-in slide-in-from-right duration-300 border-l ${t.border} ${t.bgSec} flex flex-col overflow-hidden`}>
            <div className={`p-4 ${t.bg} flex justify-between items-center border-b ${t.border}`}>
                <h2 className="font-bold text-lg">Hjälpcenter</h2>
                <AppButton variant="ghost" className="h-8 w-8 p-0" onClick={toggleRightSidebar}>
                    <X size={18}/>
                </AppButton>
            </div>
            
            <Accordion type="single" collapsible className="w-full" defaultValue="">
                {(activeApp === 'assetplus_viewer' || activeApp === 'viewer') && viewer3dFmGuid && (
                  <AccordionItem value="item-0">
                      <AccordionTrigger className="p-4 font-bold text-sm">
                          <div className="flex items-center gap-3">
                              <HelpCircle className="text-primary" size={18}/>
                              3D-diagnostik
                          </div>
                      </AccordionTrigger>
                      <AccordionContent className={`p-4 ${t.textSec} text-xs`}>
                          {!viewerDiagnostics ? (
                            <div className="space-y-1">
                              <div>Ingen diagnostik ännu (öppna en modell i 3D-viewern).</div>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <div className="space-y-1">
                                <div><span className="font-medium">FMGUID:</span> <span className="break-all">{viewerDiagnostics.fmGuid}</span></div>
                                <div><span className="font-medium">Steg:</span> {viewerDiagnostics.initStep}</div>
                                <div><span className="font-medium">Modeller:</span> {viewerDiagnostics.modelCount ?? '—'}</div>
                                <div><span className="font-medium">XKT (försök/ok/fel):</span> {viewerDiagnostics.xkt.attempted}/{viewerDiagnostics.xkt.ok}/{viewerDiagnostics.xkt.fail}</div>
                                <div>
                                  <span className="font-medium">Senaste fel:</span>{" "}
                                  {viewerDiagnostics.lastError?.timedOut
                                    ? 'timeout'
                                    : viewerDiagnostics.lastError?.status === 401
                                      ? '401 unauthorized'
                                      : viewerDiagnostics.lastError?.status === 404
                                        ? '404 not_found'
                                        : (viewerDiagnostics.lastError?.message || (viewerDiagnostics.lastError?.status ? String(viewerDiagnostics.lastError.status) : '—'))}
                                </div>
                              </div>

                              <div className={`pt-3 border-t ${t.border}`}>
                                <div className="font-medium mb-2">Senaste Asset+/-anrop</div>
                                {viewerDiagnostics.lastRequests.length === 0 ? (
                                  <div>Inga anrop fångade.</div>
                                ) : (
                                  <div className="space-y-2">
                                    {viewerDiagnostics.lastRequests.slice(0, 8).map((r, idx) => (
                                      <div key={`${r.url}-${idx}`} className="space-y-0.5">
                                        <div className="flex items-center justify-between gap-2">
                                          <span className="font-medium truncate">{r.tag.toUpperCase()} · {r.method}</span>
                                          <span className="text-muted-foreground">
                                            {r.timedOut ? 'timeout' : r.error ? r.error : (r.status ?? '—')}
                                            {typeof r.durationMs === 'number' ? ` · ${r.durationMs}ms` : ''}
                                          </span>
                                        </div>
                                        <div className="text-muted-foreground truncate" title={r.url}>{r.url}</div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                      </AccordionContent>
                  </AccordionItem>
                )}
                <AccordionItem value="item-1">
                    <AccordionTrigger className="p-4 font-bold text-sm">
                        <div className="flex items-center gap-3">
                            <LifeBuoy className="text-blue-500" size={18}/>
                            Support
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className={`p-4 text-center ${t.textSec} text-xs`}>
                        Support-funktionalitet kommer snart.
                    </AccordionContent>
                </AccordionItem>
                
                <AccordionItem value="item-2">
                    <AccordionTrigger className="p-4 font-bold text-sm">
                        <div className="flex items-center gap-3">
                            <BookOpen className="text-cyan-500" size={18}/>
                            Dokumentation
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="p-4 text-center text-muted-foreground text-xs">
                        API-dokumentation kommer snart.
                    </AccordionContent>
                </AccordionItem>
                
                <AccordionItem value="item-3">
                    <AccordionTrigger className="p-4 font-bold text-sm">
                        <div className="flex items-center gap-3">
                            <MessageSquare className="text-purple-500" size={18}/>
                            Chat
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="p-4 text-center text-muted-foreground text-xs">
                        Chat-funktionalitet kommer snart.
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </aside>
    );
};

export default RightSidebar;
