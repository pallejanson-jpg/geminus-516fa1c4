import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';

interface ExcelTemplateDownloadProps {
  buildingFmGuid: string;
  buildingName: string;
}

const ExcelTemplateDownload: React.FC<ExcelTemplateDownloadProps> = ({
  buildingFmGuid,
  buildingName,
}) => {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);

  const handleDownload = async () => {
    setIsGenerating(true);
    try {
      // Fetch floors and rooms for this building
      const { data: assets } = await supabase
        .from('assets')
        .select('fm_guid, name, common_name, category, level_fm_guid')
        .eq('building_fm_guid', buildingFmGuid)
        .in('category', ['Building Storey', 'IfcBuildingStorey', 'Space', 'IfcSpace'])
        .order('common_name');

      const floors = (assets || []).filter(a =>
        a.category === 'Building Storey' || a.category === 'IfcBuildingStorey'
      );
      const rooms = (assets || []).filter(a =>
        a.category === 'Space' || a.category === 'IfcSpace'
      );

      const floorNames = floors.map(f => f.common_name || f.name || '').filter(Boolean);
      const roomNames = rooms.map(r => r.common_name || r.name || '').filter(Boolean);

      // Create workbook
      const wb = XLSX.utils.book_new();

      // Sheet 1: Import template
      const headers = ['Designation *', 'CommonName', 'Våning', 'Rum', 'Beskrivning'];
      const exampleRow = ['VS-001', 'Radiator', floorNames[0] || 'Plan 1', roomNames[0] || 'Entré', 'Radiator under fönster'];
      const templateData = [headers, exampleRow];

      const ws = XLSX.utils.aoa_to_sheet(templateData);

      // Set column widths
      ws['!cols'] = [
        { wch: 20 }, // Designation
        { wch: 25 }, // CommonName
        { wch: 20 }, // Våning
        { wch: 25 }, // Rum
        { wch: 35 }, // Beskrivning
      ];

      // Add data validation (dropdowns) for floor column (C) and room column (D)
      // XLSX library supports data validation via ws['!dataValidation']
      if (floorNames.length > 0 || roomNames.length > 0) {
        const validations: any[] = [];

        if (floorNames.length > 0) {
          validations.push({
            type: 'list',
            sqref: 'C3:C1000',
            formulas: [floorNames.join(',')],
            showDropDown: true,
          });
        }

        if (roomNames.length > 0) {
          validations.push({
            type: 'list',
            sqref: 'D3:D1000',
            formulas: [roomNames.join(',')],
            showDropDown: true,
          });
        }

        ws['!dataValidation'] = validations;
      }

      XLSX.utils.book_append_sheet(wb, ws, 'Import');

      // Sheet 2: Reference data
      const maxLen = Math.max(floorNames.length, roomNames.length, 1);
      const refData: (string | undefined)[][] = [['Våningar', 'Rum']];
      for (let i = 0; i < maxLen; i++) {
        refData.push([floorNames[i] || undefined, roomNames[i] || undefined]);
      }
      const wsRef = XLSX.utils.aoa_to_sheet(refData);
      wsRef['!cols'] = [{ wch: 25 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, wsRef, 'Hjälpdata');

      // Download
      const safeName = buildingName.replace(/[^a-zA-Z0-9åäöÅÄÖ_-]/g, '_');
      XLSX.writeFile(wb, `Inventering_${safeName}.xlsx`);

      toast({ title: 'Mall nedladdad', description: `Excel-mall för ${buildingName} har laddats ner.` });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Kunde inte skapa mall', description: err.message });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDownload}
      disabled={isGenerating || !buildingFmGuid}
      className="gap-1.5"
    >
      {isGenerating ? (
        <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Genererar...</>
      ) : (
        <><Download className="h-3.5 w-3.5" /> Ladda ner mall</>
      )}
    </Button>
  );
};

export default ExcelTemplateDownload;
