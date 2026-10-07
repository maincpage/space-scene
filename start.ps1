$ErrorActionPreference = 'Stop'
try {
    $sceneRoot = $PSScriptRoot
    $scenePort = if ($env:PORT) { [int]$env:PORT } else { 4173 }
    $sceneUrl = "http://127.0.0.1:$scenePort"
    $expectedRoot = Join-Path $sceneRoot '图'
    $running = $null
    try { $running = Invoke-RestMethod "$sceneUrl/api/projects" -TimeoutSec 2 } catch {}
    if ($running -and $running.root -ne $expectedRoot) { throw '这个端口正在运行另一个目录的空间场景，请关闭该服务或设置其他 PORT。' }
    if (-not $running) {
        $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
        $nodePath = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
        if (-not (Test-Path -LiteralPath $nodePath)) { throw '需要 Node.js 18 或更新版本。安装后重新双击启动；直接打开 index.html 仍可使用游客模式。' }
        $sceneProcess = Start-Process -FilePath $nodePath -ArgumentList @(('"{0}"' -f (Join-Path $sceneRoot 'server.cjs'))) -WorkingDirectory $sceneRoot -WindowStyle Hidden -PassThru
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            Start-Sleep -Milliseconds 200
            try { $running = Invoke-RestMethod "$sceneUrl/api/projects" -TimeoutSec 1 } catch {}
            if ($running -and $running.root -eq $expectedRoot) { break }
            if ($sceneProcess.HasExited) { throw '项目服务启动失败，端口可能被占用。请关闭占用程序或设置其他 PORT。' }
        }
        if (-not $running -or $running.root -ne $expectedRoot) { throw '未能连接项目服务，请检查端口设置。' }
    }
    Start-Process $sceneUrl
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    Read-Host '按回车关闭'
    exit 1
}
