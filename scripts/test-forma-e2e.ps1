
<#
.SYNOPSIS
  End-to-end test av Autodesk Forma â†’ Geminus-integrationen.

.DESCRIPTION
  Testar hela kedjan:
    1. Supabase-inloggning
    2. APS token (2-legged)
    3. list-hubs  (hÃ¤mtar Autodesk-konton)
    4. list-projects (hÃ¤mtar Forma-projekt)
    5. sync-forma-building (locations + assets + translation)
    6. check-translation (pollar geometristatus)
    7. Geminus Plus sync (acc-to-geminus-plus)

.PARAMETER SupabaseEmail
  Ditt Supabase-konto (e-post).

.PARAMETER SupabasePassword
  Ditt Supabase-lÃ¶senord.

.PARAMETER FormaProjectId
  ACC-projektets ID (GUID, utan "b."-prefix).
  Hittas i Forma under projektinstÃ¤llningar, eller via list-projects nedan.

.PARAMETER FormaVersionUrn
  (Valfritt) URN till RVT-filen som ska Ã¶versÃ¤ttas.
  HÃ¤mtas via list-folders i appen.

.PARAMETER ModelName
  (Valfritt) Eget modellnamn, t.ex. "A-modell". AnvÃ¤nds som synligt namn i viewer.

.EXAMPLE
  .\test-forma-e2e.ps1 `
    -SupabaseEmail "paljanson@swg.com" `
    -SupabasePassword "ditt-lÃ¶senord" `
    -FormaProjectId "abc123-..." `
    -ModelName "A-modell"
#>

param(
  [Parameter(Mandatory)][string]$SupabaseEmail,
  [Parameter(Mandatory)][string]$SupabasePassword,
  [string]$FormaProjectId = "",
  [string]$FormaVersionUrn = "",
  [string]$ModelName = "Forma-modell"
)

$SB_URL  = "https://lzhlfditqujumnmfqqvq.supabase.co"
$ANON_KEY = "sb_publishable_kajozGqcD_h2r2GKWKziEA_op_F_D7f"

$passed = 0
$failed = 0
$jwt    = $null

function Step([string]$name, [scriptblock]$block) {
  Write-Host "`nâ”€â”€ $name â”€â”€" -ForegroundColor Cyan
  try {
    & $block
    $script:passed++
  } catch {
    Write-Host "  âŒ MISSLYCKADES: $_" -ForegroundColor Red
    $script:failed++
  }
}

function CallFn([string]$fn, [hashtable]$body) {
  $r = Invoke-RestMethod "$SB_URL/functions/v1/$fn" `
    -Method POST `
    -Headers @{ "Authorization"="Bearer $script:jwt"; "Content-Type"="application/json" } `
    -Body ($body | ConvertTo-Json -Depth 5) `
    -TimeoutSec 60
  return $r
}

# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
# STEG 1: Supabase login
# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
Step "1. Supabase-inloggning" {
  $r = Invoke-RestMethod "$SB_URL/auth/v1/token?grant_type=password" `
    -Method POST `
    -Headers @{ "apikey"=$ANON_KEY; "Content-Type"="application/json" } `
    -Body (@{ email=$SupabaseEmail; password=$SupabasePassword } | ConvertTo-Json)
  $script:jwt = $r.access_token
  Write-Host "  âœ… Inloggad: $($r.user.email) (exp: $($r.expires_in)s)" -ForegroundColor Green
}

if (-not $jwt) { Write-Host "`nâŒ Kan inte fortsÃ¤tta utan JWT. Kontrollera email/lÃ¶senord." -ForegroundColor Red; exit 1 }

# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
# STEG 2: Kontrollera APS-konfiguration via test-connection
# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
Step "2. APS-anslutning (test-connection)" {
  $r = CallFn "acc-sync" @{ action="test-connection" }
  if ($r.success) {
    Write-Host "  âœ… APS OK: $($r.message)" -ForegroundColor Green
  } else {
    Write-Host "  âŒ APS-fel: $($r.error)" -ForegroundColor Red
    Write-Host "     â†’ LÃ¤gg till APS_CLIENT_ID och APS_CLIENT_SECRET i Supabase Secrets" -ForegroundColor Yellow
    throw "APS credentials saknas"
  }
}

# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
# STEG 3: HÃ¤mta hubs (Autodesk-konton)
# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
Step "3. HÃ¤mta hubs (list-hubs)" {
  $r = CallFn "acc-sync" @{ action="list-hubs" }
  Write-Host "  âœ… Hittade $($r.hubs.Count) hub(s):" -ForegroundColor Green
  $r.hubs | ForEach-Object { Write-Host "     - $($_.name) (id=$($_.id), region=$($_.region))" }
}

# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
# STEG 4: HÃ¤mta projekt (om projektID saknas)
# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
if (-not $FormaProjectId) {
  Step "4. HÃ¤mta projekt (list-projects â€” krÃ¤ver accountId)" {
    Write-Host "  âš ï¸  Inget FormaProjectId angett. KÃ¶r steg 4 manuellt med -FormaProjectId." -ForegroundColor Yellow
    Write-Host "     HÃ¤mta ID:t frÃ¥n appen: InstÃ¤llningar â†’ Autodesk Forma â†’ VÃ¤lj projekt" -ForegroundColor Yellow
  }
} else {
  Step "4. Projekt-ID angett" {
    Write-Host "  âœ… AnvÃ¤nder projektID: $FormaProjectId" -ForegroundColor Green
  }
}

# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
# STEG 5: sync-forma-building (locations + assets + translation)
# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
$buildingFmGuid = $null
if ($FormaProjectId) {
  Step "5. sync-forma-building (locations + assets + translation)" {
    $body = @{
      action    = "sync-forma-building"
      projectId = $FormaProjectId
      modelName = $ModelName
    }
    if ($FormaVersionUrn) { $body.versionUrn = $FormaVersionUrn }

    $r = CallFn "acc-sync" $body
    Write-Host "  Meddelande: $($r.message)" -ForegroundColor $(if ($r.success) { "Green" } else { "Yellow" })

    $loc = $r.results.locations
    $ast = $r.results.assets
    $trs = $r.results.translation

    Write-Host "  Platser:    $(if ($loc.success) {"âœ… $($loc.upserted) ($($loc.buildings) byggnader, $($loc.storeys) plan, $($loc.spaces) rum)"} else {"âŒ $($loc.error)"})"
    Write-Host "  TillgÃ¥ngar: $(if ($ast.success) {"âœ… $($ast.totalSynced) installationer"} else {"âŒ $($ast.error)"})"
    if ($trs) {
      Write-Host "  Geometri:   $(if ($trs.success) {"âœ… status=$($trs.status)"} else {"âŒ $($trs.error)"})"
    }
    if ($r.errors.Count -gt 0) {
      Write-Host "  Fel: $($r.errors -join ', ')" -ForegroundColor Red
    }

    # Spara buildingFmGuid frÃ¥n locations fÃ¶r nÃ¤sta steg
    if ($loc.success) {
      $bldgs = Invoke-RestMethod "$SB_URL/rest/v1/assets?category=eq.Building&fm_guid=like.acc-*&select=fm_guid,common_name&limit=5" `
        -Headers @{ "apikey"=$ANON_KEY; "Authorization"="Bearer $script:jwt" }
      if ($bldgs.Count -gt 0) {
        $script:buildingFmGuid = $bldgs[0].fm_guid
        Write-Host "  Byggnad i DB: $($bldgs[0].fm_guid) '$($bldgs[0].common_name)'" -ForegroundColor Cyan
      }
    }
  }
}

# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
# STEG 6: Poll check-translation (om VersionUrn angavs)
# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
if ($FormaVersionUrn -and $FormaProjectId) {
  Step "6. check-translation (geometristatus)" {
    $maxAttempts = 6
    for ($i = 1; $i -le $maxAttempts; $i++) {
      $r = CallFn "acc-sync" @{
        action        = "check-translation"
        versionUrn    = $FormaVersionUrn
        buildingFmGuid= $buildingFmGuid
        accProjectId  = $FormaProjectId
        modelName     = $ModelName
      }
      Write-Host "  FÃ¶rsÃ¶k $i/$maxAttempts: status=$($r.status) progress=$($r.progress)"
      if ($r.status -eq "success") {
        Write-Host "  âœ… Translation klar! geometriExtract=$($r.geometryExtractTriggered)" -ForegroundColor Green
        break
      } elseif ($r.status -eq "failed") {
        throw "Translation misslyckades"
      }
      if ($i -lt $maxAttempts) { Start-Sleep -Seconds 15 }
    }
  }
}

# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
# STEG 7: acc-to-geminus-plus (synka hierarkin till Asset+)
# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
if ($buildingFmGuid) {
  Step "7. acc-to-geminus-plus (synk till Asset+)" {
    $r = CallFn "acc-to-geminus-plus" @{ action="check-status" }
    Write-Host "  Status: $($r.totalAccObjects) ACC-objekt, $($r.syncedToGeminusPlus) synkade" -ForegroundColor Green

    if ($r.totalAccObjects -gt 0) {
      $r2 = CallFn "acc-to-geminus-plus" @{ action="sync"; buildingFmGuid=$buildingFmGuid }
      $s = $r2.summary
      Write-Host "  âœ… Synkat: $($s.buildingsSynced) byggnader, skapade: $($s.created | ConvertTo-Json -Compress)" -ForegroundColor Green
      if ($s.totalErrors -gt 0) { Write-Host "  âš ï¸ Fel: $($s.totalErrors)" -ForegroundColor Yellow }
    } else {
      Write-Host "  âš ï¸  Inga ACC-objekt i DB (kÃ¶r steg 5 fÃ¶rst)" -ForegroundColor Yellow
    }
  }
}

# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
# STEG 8: Verifiera xkt_models
# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
Step "8. Verifiera xkt_models i DB" {
  $r = Invoke-RestMethod "$SB_URL/rest/v1/xkt_models?select=building_fm_guid,model_id,model_name,format,storage_path,synced_at&order=synced_at.desc&limit=10" `
    -Headers @{ "apikey"=$ANON_KEY; "Authorization"="Bearer $script:jwt" }
  if ($r.Count -eq 0) {
    Write-Host "  âš ï¸  Inga XKT-modeller i DB Ã¤n (geometrikonvertering kan ta 5-25 min)" -ForegroundColor Yellow
  } else {
    Write-Host "  âœ… $($r.Count) XKT-modell(er) i DB:" -ForegroundColor Green
    $r | ForEach-Object { Write-Host "     $($_.model_name) (format=$($_.format)) â†’ $($_.storage_path)" }
  }
}

# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
# SAMMANFATTNING
# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
Write-Host ""
Write-Host "â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•" -ForegroundColor Cyan
Write-Host "  Resultat: $passed/$($passed+$failed) steg OK" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Yellow" })
Write-Host "â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•" -ForegroundColor Cyan

if ($failed -gt 0) {
  Write-Host ""
  Write-Host "Vanliga orsaker till fel:" -ForegroundColor Yellow
  Write-Host "  â€¢ APS_CLIENT_ID / APS_CLIENT_SECRET saknas i Supabase Secrets"
  Write-Host "    â†’ LÃ¤gg till via: npx supabase secrets set APS_CLIENT_ID=xxx APS_CLIENT_SECRET=yyy --project-ref lzhlfditqujumnmfqqvq"
  Write-Host "  â€¢ Inget Forma-projekt valt (ange -FormaProjectId)"
  Write-Host "  â€¢ 3-legged OAuth ej godkÃ¤nd (logga in via appen: InstÃ¤llningar â†’ Autodesk Forma)"
}
