

## Problem

SheetJS (`xlsx`) community edition stöder **inte** Data Validation (dropdowns) vid skrivning. Egenskapen `ws['!dataValidation']` ignoreras helt — den finns inte i bibliotekets writer. Därför genereras Hjälpdata-fliken korrekt, men inga dropdowns syns i Import-fliken.

## Lösning

Byt till att referera Hjälpdata-fliken via **named ranges** i formler som SheetJS *inte heller* stöder — så den enda fungerande lösningen är att använda **`xlsx` Pro** (kommersiell) eller bygga Data Validation manuellt via XML-manipulation av den genererade filen.

**Rekommenderad approach:** Skriv en postprocessing-steg som:

1. Genererar `.xlsx` med SheetJS som vanligt (data + hjälpdata)
2. Packar upp filen (`.xlsx` är en ZIP)
3. Injicerar `<dataValidation>` XML-element direkt i `xl/worksheets/sheet1.xml`
4. Packar om och laddar ner

Alternativt kan vi använda ett enklare trick: **referera till Hjälpdata-fliken direkt i validerings-XML** med formel `Hjälpdata!$A$2:$A${n}` för våningar och `Hjälpdata!$B$2:$B${n}` för rum.

### Tekniska ändringar

**`src/components/import/ExcelTemplateDownload.tsx`:**

- Generera workbook som idag med SheetJS
- Skriv till en `Uint8Array` istället för direkt fil (`XLSX.write(wb, {type:'array'})`)
- Packa upp med JSZip (lägg till beroende `jszip`)
- Läs `xl/worksheets/sheet1.xml`
- Injicera `<dataValidations>` block med två regler:
  - Kolumn C (Våning): `<dataValidation type="list" sqref="C2:C1000"><formula1>Hjälpdata!$A$2:$A${floorCount+1}</formula1></dataValidation>`
  - Kolumn D (Rum): `<dataValidation type="list" sqref="D2:D1000"><formula1>Hjälpdata!$B$2:$B${roomCount+1}</formula1></dataValidation>`
- Packa om ZIP → Blob → ladda ner

### Nytt beroende
- `jszip` — för att manipulera xlsx-filen (ZIP-format)

### Resultat
Användaren får en Excel-fil där kolumn C och D har riktiga dropdowns som refererar till Hjälpdata-fliken.

