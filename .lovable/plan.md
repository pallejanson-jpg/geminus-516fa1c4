

# Förbättra ACC-inställningarna

## Problem 1: Information försvinner vid varje öppning
Mappstrukturen, projektlistan och annan ACC-data rensas varje gång du stänger och öppnar inställningarna. Du måste klicka "Visa mappar" igen varje gång.

**Lösning:** Flytta ACC-mappdata och projektlistan till sessionStorage (eller behåll state utanför modalen). Automatiskt ladda mappar vid modal-öppning om ett projekt-ID redan finns sparat.

## Problem 2: För många knappar
Knapparna "Synka platser", "Synka tillgångar", "Visa mappar" och "Status" visas alla samtidigt. De flesta behövs sällan.

**Lösning:** Visa bara "Visa mappar" som primär knapp (det viktigaste steget). Flytta "Synka platser", "Synka tillgångar" och "Status" till en dropdownmeny ("Fler åtgärder"). Enklare, renare vy.

## Problem 3: US/EMEA-projekt visas inte korrekt
Koden letar efter secrets `ACC_ACCOUNT_ID_US` och `ACC_ACCOUNT_ID_EMEA`, men bara `ACC_ACCOUNT_ID` finns konfigurerad. Båda regionerna faller tillbaka på samma account-ID, vilket gör att du ser samma projekt oavsett vilken region du väljer. Dessutom har du troligtvis olika account-IDs per region.

**Lösning:** Skapa två nya secrets (`ACC_ACCOUNT_ID_US` och `ACC_ACCOUNT_ID_EMEA`) med de korrekta Autodesk account-ID:na. Du kommer bli ombedd att ange dessa värden.

---

## Teknisk plan

### Steg 1: Nya secrets for region-specifika Account IDs
- Be dig ange `ACC_ACCOUNT_ID_US` och `ACC_ACCOUNT_ID_EMEA` med de korrekta Autodesk Account IDs

### Steg 2: Bevara ACC-state mellan modal-öppningar (ApiSettingsModal.tsx)
- Spara `accFolders`, `accTopLevelItems`, `accRootFolderName`, `accProjects`, `selectedAccProjectId` i sessionStorage
- Ladda tillbaka vid modal-öppning
- Automatiskt hämta mappar om vi har ett sparat projekt-ID men inga mappar i cache

### Steg 3: Förenkla knapplayout (ApiSettingsModal.tsx)
- Visa "Visa mappar" som enda primär knapp
- Flytta "Synka platser", "Synka tillgångar", och "Status" till en dropdown/collapsible under "Avancerat"
- Behåll all funktionalitet men gör den mindre störande

### Steg 4: Auto-ladda sparad region vid modal-öppning
- `check-status` ger redan tillbaka `savedRegion` -- se till att regionväljaren sätts korrekt OCH att projektlistan hämtas automatiskt med rätt region

### Filer som ändras
- `src/components/settings/ApiSettingsModal.tsx` -- state-persistens, knapplayout, auto-load
- Inga edge function-ändringar behövs (koden stödjer redan region-specifika account IDs)

