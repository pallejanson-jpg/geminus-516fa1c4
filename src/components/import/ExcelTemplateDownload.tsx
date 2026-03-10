import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

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
      const headers = ['Designation *', 'CommonName', 'Floor', 'Room', 'Description'];
      const exampleRow = ['VS-001', 'Radiator', floorNames[0] || 'Floor 1', roomNames[0] || 'Lobby', 'Radiator under window'];
      const templateData = [headers, exampleRow];

      const ws = XLSX.utils.aoa_to_sheet(templateData);
      ws['!cols'] = [
        { wch: 20 },
        { wch: 25 },
        { wch: 20 },
        { wch: 25 },
        { wch: 35 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, 'Import');

      // Sheet 2: Reference data
      const maxLen = Math.max(floorNames.length, roomNames.length, 1);
      const refData: (string | undefined)[][] = [['Floors', 'Rooms']];
      for (let i = 0; i < maxLen; i++) {
        refData.push([floorNames[i] || undefined, roomNames[i] || undefined]);
      }
      const wsRef = XLSX.utils.aoa_to_sheet(refData);
      wsRef['!cols'] = [{ wch: 25 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, wsRef, 'Reference');

      // Generate as array buffer
      const wbOut = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

      // Post-process: inject data validation XML
      const zip = await JSZip.loadAsync(wbOut);
      const sheet1Path = 'xl/worksheets/sheet1.xml';
      const sheet1Xml = await zip.file(sheet1Path)!.async('string');

      const validations: string[] = [];
      if (floorNames.length > 0) {
        const lastRow = floorNames.length + 1;
        validations.push(
          `<dataValidation type="list" allowBlank="1" showDropDown="0" showInputMessage="1" showErrorMessage="1" sqref="C2:C1000"><formula1>Reference!$A$2:$A$${lastRow}</formula1></dataValidation>`
        );
      }
      if (roomNames.length > 0) {
        const lastRow = roomNames.length + 1;
        validations.push(
          `<dataValidation type="list" allowBlank="1" showDropDown="0" showInputMessage="1" showErrorMessage="1" sqref="D2:D1000"><formula1>Reference!$B$2:$B$${lastRow}</formula1></dataValidation>`
        );
      }

      if (validations.length > 0) {
        const dvBlock = `<dataValidations count="${validations.length}">${validations.join('')}</dataValidations>`;
        // Insert before </worksheet>
        const injected = sheet1Xml.replace('</worksheet>', `${dvBlock}</worksheet>`);
        zip.file(sheet1Path, injected);
      }

      const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

      // Download
      const safeName = buildingName.replace(/[^a-zA-Z0-9åäöÅÄÖ_-]/g, '_');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Import_${safeName}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);

      toast({ title: 'Template downloaded', description: `Excel template for ${buildingName} has been downloaded.` });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Could not create template', description: err.message });
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
        <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating...</>
      ) : (
        <><Download className="h-3.5 w-3.5" /> Download template</>
      )}
    </Button>
  );
};

export default ExcelTemplateDownload;
