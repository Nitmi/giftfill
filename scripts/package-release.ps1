param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot '.output/chrome-mv3/manifest.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne $version) { throw 'Build version does not match package.json. Run npm run zip first.' }
$releaseRoot = Join-Path $projectRoot "work/release/GiftFill-$version"
if (Test-Path -LiteralPath $releaseRoot) { throw 'Release staging folder already exists; choose a new version or inspect it first.' }
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot '.output/chrome-mv3') -Destination (Join-Path $releaseRoot 'extension') -Recurse
foreach ($pair in @(@('docs/install.md','INSTALL.md'),@('docs/validation.md','VALIDATION.md'),@('docs/security.md','SECURITY.md'),@('LICENSE','LICENSE'),@('THIRD_PARTY_NOTICES.txt','THIRD_PARTY_NOTICES.txt'))) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $pair[0]) -Destination (Join-Path $releaseRoot $pair[1])
}
Compress-Archive -LiteralPath $releaseRoot -DestinationPath (Join-Path $OutputDirectory "GiftFill-$version.zip") -Force
git -C $projectRoot archive --format=zip -o (Join-Path $OutputDirectory "GiftFill-source-$version.zip") HEAD
if ($LASTEXITCODE -ne 0) { throw 'Source archive failed.' }
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/install.md') -Destination (Join-Path $OutputDirectory '安装说明.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/validation.md') -Destination (Join-Path $OutputDirectory '验证记录.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/security.md') -Destination (Join-Path $OutputDirectory '安全设计.md')
Write-Output "Packaged GiftFill $version to $OutputDirectory"
