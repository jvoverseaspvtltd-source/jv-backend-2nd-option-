$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $PSScriptRoot + "\.."
$watcher.IncludeSubdirectories = $true
$watcher.EnableRaisingEvents = $true

$onChange = {
    $path = $EventArgs.FullPath
    # Ignore git internal files and node_modules
    if ($path -match "\.git\\" -or $path -match "node_modules\\") {
        return
    }
    
    Write-Host "Change detected in: $path" -ForegroundColor Cyan
    
    cd $PSScriptRoot\..
    
    git add .
    git commit -m "Auto-commit: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    git push origin main
    
    Write-Host "Successfully pushed to GitHub!" -ForegroundColor Green
}

Register-ObjectEvent $watcher "Changed" -Action $onChange | Out-Null
Register-ObjectEvent $watcher "Created" -Action $onChange | Out-Null
Register-ObjectEvent $watcher "Deleted" -Action $onChange | Out-Null

Write-Host "Auto-push service started. Watching for changes..." -ForegroundColor Green
while ($true) { Start-Sleep -Seconds 1 }
