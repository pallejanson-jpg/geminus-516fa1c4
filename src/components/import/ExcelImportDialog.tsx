import React, { useState, useCallback } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import {
  Upload, Loader2, CheckCircle2, AlertTriangle, FileSpreadsheet, X,
} from 'lucide-react';
import * as XLSX from 'xlsx';

interface ExcelImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buildingFmGuid: string;
  buildingName: string;
}

interface ParsedRow {
  designation: string;
  commonName: string;
  floor: string;
  room: string;
  description: string;
  // Resolved GUIDs
  resolvedRoomFmGuid?: string;
  resolvedBuildingFmGuid?: string;
  isOrphan: boolean;
  // Validation
  valid: boolean;
  errors: string[];
}

type Step = 'upload' | 'preview' | 'importing' | 'done';

const ExcelImportDialog: React.FC<ExcelImportDialogProps> = ({
  open, onOpenChange, buildingFmGuid, buildingName,
}) => {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>('upload');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [importProgress, setImportProgress] = useState(0);
  const [importResults, setImportResults] = useState<{ created: number; failed: number }>({ created: 0, failed: 0 });

  const resetState = useCallback(() => {
    setStep('upload');
    setRows([]);
    setImportProgress(0);
    setImportResults({ created: 0, failed: 0 });
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json<Record<string, string>>(ws);

      if (jsonData.length === 0) {
        toast({ variant: 'destructive', title: 'Empty sheet', description: 'The Excel file contains no rows.' });
        return;
      }

      // Fetch floors and rooms for name lookup
      const { data: assets } = await supabase
        .from('assets')
        .select('fm_guid, name, common_name, category, level_fm_guid')
        .eq('building_fm_guid', buildingFmGuid)
        .in('category', ['Building Storey', 'IfcBuildingStorey', 'Space', 'IfcSpace']);

      const floors = (assets || []).filter(a =>
        a.category === 'Building Storey' || a.category === 'IfcBuildingStorey'
      );
      const rooms = (assets || []).filter(a =>
        a.category === 'Space' || a.category === 'IfcSpace'
      );

      // Build lookup maps (case-insensitive)
      const floorMap = new Map<string, string>();
      floors.forEach(f => {
        const key = (f.common_name || f.name || '').toLowerCase().trim();
        if (key) floorMap.set(key, f.fm_guid);
      });

      const roomMap = new Map<string, string>();
      rooms.forEach(r => {
        const key = (r.common_name || r.name || '').toLowerCase().trim();
        if (key) roomMap.set(key, r.fm_guid);
      });

      // Parse rows with name-to-GUID resolution
      const parsed: ParsedRow[] = jsonData.map(row => {
        // Support both Swedish and English headers
        const designation = (row['Designation *'] || row['Designation'] || row['designation'] || '').trim();
        const commonName = (row['CommonName'] || row['commonName'] || row['Common Name'] || '').trim();
        const floor = (row['Våning'] || row['Floor'] || row['floor'] || '').trim();
        const room = (row['Rum'] || row['Room'] || row['room'] || '').trim();
        const description = (row['Beskrivning'] || row['Description'] || row['description'] || '').trim();

        const errors: string[] = [];

        if (!designation) errors.push('Designation missing');

        // Resolve room
        let resolvedRoomFmGuid: string | undefined;
        if (room) {
          resolvedRoomFmGuid = roomMap.get(room.toLowerCase().trim());
          if (!resolvedRoomFmGuid) {
            errors.push(`Room "${room}" not found`);
          }
        }

        const isOrphan = !room;

        return {
          designation,
          commonName,
          floor,
          room,
          description,
          resolvedRoomFmGuid,
          resolvedBuildingFmGuid: buildingFmGuid,
          isOrphan,
          valid: errors.length === 0 && !!designation,
          errors,
        };
      });

      setRows(parsed);
      setStep('preview');
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Could not read file', description: err.message });
    }
  };

  const validRows = rows.filter(r => r.valid);
  const invalidRows = rows.filter(r => !r.valid);

  const handleImport = async () => {
    if (validRows.length === 0) return;
    setStep('importing');
    setImportProgress(0);

    let created = 0;
    let failed = 0;

    // Save locally in batches of 50
    const batchSize = 50;
    for (let i = 0; i < validRows.length; i += batchSize) {
      const batch = validRows.slice(i, i + batchSize);

      const records = batch.map(row => ({
        fm_guid: crypto.randomUUID(),
        category: 'Component',
        name: row.designation,
        common_name: row.commonName || row.designation,
        building_fm_guid: buildingFmGuid,
        in_room_fm_guid: row.resolvedRoomFmGuid || null,
        is_local: true,
        created_in_model: false,
        attributes: row.description ? { syncProperties: { Description: row.description } } : {},
      }));

      try {
        const { error } = await supabase.from('assets').insert(records);
        if (error) throw error;
        created += batch.length;
      } catch (err: any) {
        console.error('Batch import failed:', err);
        failed += batch.length;
      }

      setImportProgress(Math.round(((i + batch.length) / validRows.length) * 100));
    }

    setImportResults({ created, failed });
    setStep('done');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetState(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Import from Excel
          </DialogTitle>
          <DialogDescription>
            Import objects to {buildingName} from an Excel file
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto min-h-0">
          {step === 'upload' && (
            <div className="flex flex-col items-center justify-center gap-4 py-8">
              <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center w-full">
                <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground mb-3">
                  Välj en ifylld Excel-fil (.xlsx)
                </p>
                <Input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileChange}
                  className="max-w-xs mx-auto"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Ladda ner mallen först om du inte redan har den.
              </p>
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="default">{validRows.length} giltiga</Badge>
                {invalidRows.length > 0 && (
                  <Badge variant="destructive">{invalidRows.length} med fel</Badge>
                )}
                <span className="text-xs text-muted-foreground ml-auto">
                  Totalt {rows.length} rader
                </span>
              </div>

              <div className="rounded-md border max-h-[40vh] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">#</TableHead>
                      <TableHead>Designation</TableHead>
                      <TableHead>CommonName</TableHead>
                      <TableHead>Våning</TableHead>
                      <TableHead>Rum</TableHead>
                      <TableHead className="w-12">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, idx) => (
                      <TableRow key={idx} className={!row.valid ? 'bg-destructive/5' : ''}>
                        <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell className="text-sm font-mono">{row.designation || '—'}</TableCell>
                        <TableCell className="text-sm">{row.commonName || '—'}</TableCell>
                        <TableCell className="text-sm">{row.floor || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-sm">
                          {row.room || <Badge variant="secondary" className="text-[10px]">Orphan</Badge>}
                        </TableCell>
                        <TableCell>
                          {row.valid ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : (
                            <span className="flex items-center gap-1">
                              <AlertTriangle className="h-4 w-4 text-destructive" />
                              <span className="text-[10px] text-destructive">{row.errors[0]}</span>
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {step === 'importing' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Skapar objekt...</p>
              <Progress value={importProgress} className="w-64 h-2" />
              <p className="text-xs text-muted-foreground">{importProgress}%</p>
            </div>
          )}

          {step === 'done' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <CheckCircle2 className="h-10 w-10 text-green-500" />
              <p className="text-sm font-medium">Import klar!</p>
              <div className="flex gap-4 text-sm">
                <span className="text-green-600">{importResults.created} skapade</span>
                {importResults.failed > 0 && (
                  <span className="text-destructive">{importResults.failed} misslyckades</span>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {step === 'preview' && (
            <div className="flex gap-2 w-full justify-end">
              <Button variant="outline" onClick={resetState}>
                <X className="h-4 w-4 mr-1" /> Avbryt
              </Button>
              <Button onClick={handleImport} disabled={validRows.length === 0} className="gap-1.5">
                <Upload className="h-4 w-4" />
                Importera {validRows.length} objekt
              </Button>
            </div>
          )}
          {step === 'done' && (
            <Button onClick={() => { resetState(); onOpenChange(false); }}>
              Stäng
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ExcelImportDialog;
