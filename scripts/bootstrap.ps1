
<#
.SYNOPSIS
Bootstraps jq, yq, jsonnet and the jsonnet-renderer VS Code extension on Windows.
#>
param(
    [string]$ToolsDir = "$PSScriptRoot\bin"
)
if (-not (Test-Path $ToolsDir)) {
    New-Item -ItemType Directory -Path $ToolsDir | Out-Null
}
function Ensure-Tool {
    param(
        [string]$Command,
        [string]$Url
    )
    if (Get-Command $Command -ErrorAction SilentlyContinue) {
        Write-Host "$Command already available. Skipping."
        return
    }
    $dest = Join-Path $ToolsDir "$Command.exe"
    if (-not (Test-Path $dest)) {
        Write-Host "Downloading $Command from $Url"
        Invoke-WebRequest -Uri $Url -OutFile $dest
    }
    Write-Host "$Command installed at $dest"
}

function Ensure-Jsonnet {
    param(
        [string]$Url
    )
    $command = 'jsonnet'
    if (Get-Command $command -ErrorAction SilentlyContinue) {
        Write-Host "$command already available. Skipping."
        return
    }
    $dest = Join-Path $ToolsDir "$command.exe"
    if (-not (Test-Path $dest)) {
        $archive = Join-Path $ToolsDir 'jsonnet.tar.gz'
        Write-Host "Downloading $command from $Url"
        Invoke-WebRequest -Uri $Url -OutFile $archive
        Write-Host 'Extracting jsonnet.exe'
        tar -xzf $archive -C $ToolsDir jsonnet.exe
        Remove-Item $archive
    }
    Write-Host "$command installed at $dest"
}
function Add-ToolsToPath {
    if (-not ($env:Path -split ';' | Where-Object { $_ -eq $ToolsDir })) {
        Write-Host "Adding $ToolsDir to PATH"
        [Environment]::SetEnvironmentVariable('Path', "$env:Path;$ToolsDir", 'User')
        $env:Path += ';' + $ToolsDir
    }
}

function Install-LatestVsix {
    param(
        [string]$Repo = 'dr-kosmos/jsonnet-render-extension',
        [string]$AssetName = 'jsonnet-renderer.vsix'
    )
    $dest = Join-Path $ToolsDir $AssetName
    if (-not (Test-Path $dest)) {
        $apiUrl = "https://api.github.com/repos/$Repo/releases/latest"
        Write-Host "Fetching latest release info from $apiUrl"
        $release = Invoke-RestMethod -Uri $apiUrl -UseBasicParsing
        $asset = $release.assets | Where-Object { $_.name -eq $AssetName } | Select-Object -First 1
        if ($null -eq $asset) {
            Write-Host "Asset $AssetName not found in latest release"
            return
        }
        Write-Host "Downloading $AssetName from $($asset.browser_download_url)"
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $dest
    }
    if (Get-Command code -ErrorAction SilentlyContinue) {
        Write-Host "Installing VS Code extension"
        code --install-extension $dest --force | Out-Null
    } else {
        Write-Host "VS Code not found. Skipping extension install."
    }
}
Ensure-Tool 'jq' 'https://github.com/stedolan/jq/releases/latest/download/jq-win64.exe'
Ensure-Tool 'yq' 'https://github.com/mikefarah/yq/releases/latest/download/yq_windows_amd64.exe'
Ensure-Jsonnet 'https://github.com/google/go-jsonnet/releases/download/v0.21.0/go-jsonnet_Windows_x86_64.tar.gz'
Add-ToolsToPath
Install-LatestVsix
