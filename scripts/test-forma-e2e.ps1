
<#
.SYNOPSIS
  End-to-end test av Autodesk Forma → Geminus-integrationen.

.DESCRIPTION
  Testar hela kedjan:
    1. Supabase-inloggning
    2. APS token (2-legged)
    3. list-hubs  (hämtar Autodesk-konton)
    4. list-projects (hämtar Forma-projekt)
    5. sync-forma-building (locations + assets + translation)
    6. check-translation (pollar geometristatus)
    7. Geminus Plus sync (acc-to-geminus-plus)

.PARAMETER SupabaseEmail
  Ditt Supabase-konto (e-post).

.PARAMETER SupabasePassword
  Ditt Supabase-lösenord.

.PARAMETER FormaProjectId
  ACC-projektets ID (GUID, utan "b."-prefix).
  Hittas i Forma under projektinställningar, eller via list-projects nedan.

.PARAMETER FormaVersionUrn
  (Valfritt) URN till RVT-filen som ska översättas.
  Hämtas via list-folders i appen.

.PARAMETER ModelName
  (Valfritt) Eget modellnamn, t.ex. "A-modell". Används som synligt namn i viewer.

.EXAMPLE
  .\test-forma-e2e.ps1 `
    -SupabaseEmail "paljanson@swg.com" `
    -SupabasePassword "ditt-lösenord" `
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
$ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6aGxmZGl0cXVqdW1ubWZxcXZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNDgwNjksImV4cCI6MjA5NjgyNDA2OX0.Kh-JDtaW46KMy5m85i17mVlH5nih-uBOOUqhQ0hcJzM"

$passed = 0
$failed = 0
$jwt    = $null

function Step([string]$name, [scriptblock]$block) {
  Write-Host "`n── $name ──" -ForegroundColor Cyan
  try {
    & $block
    $script:passed++
  } catch {
    Write-Host "  ❌ MISSLYCKADES: $_" -ForegroundColor Red
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

# ═══════════════════════════════════════════════════════════════
# STEG 1: Supabase login
# ═══════════════════════════════════════════════════════════════
Step "1. Supabase-inloggning" {
  $r = Invoke-RestMethod "$SB_URL/auth/v1/token?grant_type=password" `
    -Method POST `
    -Headers @{ "apikey"=$ANON_KEY; "Content-Type"="application/json" } `
    -Body (@{ email=$SupabaseEmail; password=$SupabasePassword } | ConvertTo-Json)
  $script:jwt = $r.access_token
  Write-Host "  ✅ Inloggad: $($r.user.email) (exp: $($r.expires_in)s)" -ForegroundColor Green
}

if (-not $jwt) { Write-Host "`n❌ Kan inte fortsätta utan JWT. Kontrollera email/lösenord." -ForegroundColor Red; exit 1 }

# ═══════════════════════════════════════════════════════════════
# STEG 2: Kontrollera APS-konfiguration via test-connection
# ═══════════════════════════════════════════════════════════════
Step "2. APS-anslutning (test-connection)" {
  $r = CallFn "acc-sync" @{ action="test-connection" }
  if ($r.success) {
    Write-Host "  ✅ APS OK: $($r.message)" -ForegroundColor Green
  } else {
    Write-Host "  ❌ APS-fel: $($r.error)" -ForegroundColor Red
    Write-Host "     → Lägg till APS_CLIENT_ID och APS_CLIENT_SECRET i Supabase Secrets" -ForegroundColor Yellow
    throw "APS credentials saknas"
  }
}

# ═══════════════════════════════════════════════════════════════
# STEG 3: Hämta hubs (Autodesk-konton)
# ═══════════════════════════════════════════════════════════════
Step "3. Hämta hubs (list-hubs)" {
  $r = CallFn "acc-sync" @{ action="list-hubs" }
  Write-Host "  ✅ Hittade $($r.hubs.Count) hub(s):" -ForegroundColor Green
  $r.hubs | ForEach-Object { Write-Host "     - $($_.name) (id=$($_.id), region=$($_.region))" }
}

# ═══════════════════════════════════════════════════════════════
# STEG 4: Hämta projekt (om projektID saknas)
# ═══════════════════════════════════════════════════════════════
if (-not $FormaProjectId) {
  Step "4. Hämta projekt (list-projects — kräver accountId)" {
    Write-Host "  ⚠️  Inget FormaProjectId angett. Kör steg 4 manuellt med -FormaProjectId." -ForegroundColor Yellow
    Write-Host "     Hämta ID:t från appen: Inställningar → Autodesk Forma → Välj projekt" -ForegroundColor Yellow
  }
} else {
  Step "4. Projekt-ID angett" {
    Write-Host "  ✅ Använder projektID: $FormaProjectId" -ForegroundColor Green
  }
}

# ═══════════════════════════════════════════════════════════════
# STEG 5: sync-forma-building (locations + assets + translation)
# ═══════════════════════════════════════════════════════════════
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

    Write-Host "  Platser:    $(if ($loc.success) {"✅ $($loc.upserted) ($($loc.buildings) byggnader, $($loc.storeys) plan, $($loc.spaces) rum)"} else {"❌ $($loc.error)"})"
    Write-Host "  Tillgångar: $(if ($ast.success) {"✅ $($ast.totalSynced) installationer"} else {"❌ $($ast.error)"})"
    if ($trs) {
      Write-Host "  Geometri:   $(if ($trs.success) {"✅ status=$($trs.status)"} else {"❌ $($trs.error)"})"
    }
    if ($r.errors.Count -gt 0) {
      Write-Host "  Fel: $($r.errors -join ', ')" -ForegroundColor Red
    }

    # Spara buildingFmGuid från locations för nästa steg
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

# ═══════════════════════════════════════════════════════════════
# STEG 6: Poll check-translation (om VersionUrn angavs)
# ═══════════════════════════════════════════════════════════════
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
      Write-Host "  Försök $i/$maxAttempts: status=$($r.status) progress=$($r.progress)"
      if ($r.status -eq "success") {
        Write-Host "  ✅ Translation klar! geometriExtract=$($r.geometryExtractTriggered)" -ForegroundColor Green
        break
      } elseif ($r.status -eq "failed") {
        throw "Translation misslyckades"
      }
      if ($i -lt $maxAttempts) { Start-Sleep -Seconds 15 }
    }
  }
}

# ═══════════════════════════════════════════════════════════════
# STEG 7: acc-to-geminus-plus (synka hierarkin till Asset+)
# ═══════════════════════════════════════════════════════════════
if ($buildingFmGuid) {
  Step "7. acc-to-geminus-plus (synk till Asset+)" {
    $r = CallFn "acc-to-geminus-plus" @{ action="check-status" }
    Write-Host "  Status: $($r.totalAccObjects) ACC-objekt, $($r.syncedToGeminusPlus) synkade" -ForegroundColor Green

    if ($r.totalAccObjects -gt 0) {
      $r2 = CallFn "acc-to-geminus-plus" @{ action="sync"; buildingFmGuid=$buildingFmGuid }
      $s = $r2.summary
      Write-Host "  ✅ Synkat: $($s.buildingsSynced) byggnader, skapade: $($s.created | ConvertTo-Json -Compress)" -ForegroundColor Green
      if ($s.totalErrors -gt 0) { Write-Host "  ⚠️ Fel: $($s.totalErrors)" -ForegroundColor Yellow }
    } else {
      Write-Host "  ⚠️  Inga ACC-objekt i DB (kör steg 5 först)" -ForegroundColor Yellow
    }
  }
}

# ═══════════════════════════════════════════════════════════════
# STEG 8: Verifiera xkt_models
# ═══════════════════════════════════════════════════════════════
Step "8. Verifiera xkt_models i DB" {
  $r = Invoke-RestMethod "$SB_URL/rest/v1/xkt_models?select=building_fm_guid,model_id,model_name,format,storage_path,synced_at&order=synced_at.desc&limit=10" `
    -Headers @{ "apikey"=$ANON_KEY; "Authorization"="Bearer $script:jwt" }
  if ($r.Count -eq 0) {
    Write-Host "  ⚠️  Inga XKT-modeller i DB än (geometrikonvertering kan ta 5-25 min)" -ForegroundColor Yellow
  } else {
    Write-Host "  ✅ $($r.Count) XKT-modell(er) i DB:" -ForegroundColor Green
    $r | ForEach-Object { Write-Host "     $($_.model_name) (format=$($_.format)) → $($_.storage_path)" }
  }
}

# ═══════════════════════════════════════════════════════════════
# SAMMANFATTNING
# ═══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Resultat: $passed/$($passed+$failed) steg OK" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Yellow" })
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan

if ($failed -gt 0) {
  Write-Host ""
  Write-Host "Vanliga orsaker till fel:" -ForegroundColor Yellow
  Write-Host "  • APS_CLIENT_ID / APS_CLIENT_SECRET saknas i Supabase Secrets"
  Write-Host "    → Lägg till via: npx supabase secrets set APS_CLIENT_ID=xxx APS_CLIENT_SECRET=yyy --project-ref lzhlfditqujumnmfqqvq"
  Write-Host "  • Inget Forma-projekt valt (ange -FormaProjectId)"
  Write-Host "  • 3-legged OAuth ej godkänd (logga in via appen: Inställningar → Autodesk Forma)"
}
