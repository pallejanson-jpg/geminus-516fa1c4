

# Uppdatera ACC Account ID

## Vad vi gör

Uppdaterar det lagrade ACC Account ID:t från det felaktiga värdet (e-postadress) till det korrekta hub-ID:t som du angett:

**Nytt värde:** `3cfd791f-26ad-4a2a-beb5-1de4867081e1`

## Teknisk detalj

- Uppdaterar backend-hemligheten `ACC_ACCOUNT_ID` med det nya värdet
- Inga kodändringar behövs -- edge-funktionen `acc-sync` läser redan denna hemlighet och använder den som `accountId` i API-anropen mot Autodesk Construction Cloud

## Efter uppdateringen

När hemligheten är uppdaterad kan du:
1. Öppna API-inställningarna
2. Välja rätt region (US eller EMEA)
3. Klicka "Testa anslutning" och sedan "Hämta projekt" för att verifiera att allt fungerar

