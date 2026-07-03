import React, { Suspense, lazy } from 'react';
import { Wrench } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useLanguage } from '@/context/LanguageContext';
import FormaToGeminusPlusPanel from './FormaToGeminusPlusPanel';
import IfcToGeminusPlusPanel from './IfcToGeminusPlusPanel';

const BlmFormaView = lazy(() => import('@/components/blm-forma/BlmFormaView'));

export default function GeminusToolsView() {
  const { t } = useLanguage();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b px-6 py-4 flex items-center gap-3 shrink-0">
        <Wrench className="h-5 w-5 text-blue-500" />
        <h1 className="text-lg font-semibold">Geminus Tools</h1>
      </div>

      {/* Tabs */}
      <div className="flex-1 overflow-y-auto">
        <Tabs defaultValue="forma_to_gp" className="h-full flex flex-col">
          <TabsList className="mx-6 mt-4 w-fit shrink-0">
            <TabsTrigger value="forma_to_gp">
              {t('Forma → Geminus Plus', 'Forma → Geminus Plus')}
            </TabsTrigger>
            <TabsTrigger value="ifc_to_gp">
              {t('IFC → Geminus Plus', 'IFC → Geminus Plus')}
            </TabsTrigger>
            <TabsTrigger value="blm_forma">
              {t('BLM ↔ Forma', 'BLM ↔ Forma')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="forma_to_gp" className="flex-1 px-6 py-4 overflow-y-auto">
            <p className="text-sm text-muted-foreground mb-4">
              {t(
                'Hämta data från Autodesk Forma och skicka direkt till Geminus Plus (Asset+). Välj projekt, målbyggnad och kör synkronisering.',
                'Fetch data from Autodesk Forma and push directly to Geminus Plus (Asset+). Select project, target building, and run sync.',
              )}
            </p>
            <FormaToGeminusPlusPanel />
          </TabsContent>

          <TabsContent value="ifc_to_gp" className="flex-1 px-6 py-4 overflow-y-auto">
            <p className="text-sm text-muted-foreground mb-4">
              {t(
                'Ladda upp en IFC-fil direkt till Geminus Plus. FMGuid genereras automatiskt om de saknas och återanvänds vid re-upload via IFC GlobalId.',
                'Upload an IFC file directly to Geminus Plus. FMGuid is generated automatically if missing and reused on re-upload via IFC GlobalId.',
              )}
            </p>
            <IfcToGeminusPlusPanel />
          </TabsContent>

          <TabsContent value="blm_forma" className="flex-1 overflow-hidden p-0">
            <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" /></div>}>
              <BlmFormaView />
            </Suspense>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
