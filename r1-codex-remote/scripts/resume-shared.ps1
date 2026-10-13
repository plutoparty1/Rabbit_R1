# 기존 Codex의 정상 종료를 기다린 뒤 승인된 같은 대화를 이어받습니다.
param(
    [string]$ThreadId = '01a113d7-a337-75b1-871f-d4db4a3c36b7',
    [string]$WorkingDirectory = 'C:\Users\정산-PC\jjs1124',
    [int]$OriginalProcessId = 37572
)
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'R1 Codex 같은 대화 이어받기'
$taskProject = Split-Path -Parent $PSScriptRoot
$taskServerPath = Join-Path $taskProject '.runtime\shared-server.json'
$taskTokenPath = Join-Path $taskProject '.runtime\shared-token.txt'
$taskBinary = Join-Path $env:LOCALAPPDATA 'Programs\OpenAI\Codex\bin\codex.exe'
$taskPython = Join-Path $taskProject '.venv\Scripts\python.exe'
$taskServerScript = Join-Path $PSScriptRoot 'shared_server.py'
$taskGuid = [guid]::Parse($ThreadId)
if ($OriginalProcessId -gt 0 -and (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $OriginalProcessId))) {
    Write-Host '현재 Codex가 정상 종료되기를 기다립니다. 현재 작업을 강제로 종료하지 않습니다.'
    Write-Host '현재 답변이 끝난 뒤 기존 Codex 터미널에서 Ctrl+C를 두 번 눌러 주세요.'
}
while ($OriginalProcessId -gt 0 -and ($taskOriginal = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $OriginalProcessId))) {
    if ($taskOriginal.ExecutablePath -ne $taskBinary -or $taskOriginal.CommandLine -notmatch '--no-daemon') {
        throw '원래 프로세스 정보가 변경되었습니다. 자동으로 진행하지 않습니다.'
    }
    Start-Sleep -Seconds 1
}
# 원래 작업의 종료를 기다리는 동안 서버도 종료될 수 있으므로 직전에 다시 검사합니다.
& $taskPython -B $taskServerScript --check
if ($LASTEXITCODE -ne 0) {
    Write-Host '공유 서버 연결을 복구하고 있습니다.'
    $taskServerProcess = Start-Process -FilePath $taskPython -ArgumentList @('-B', ('"' + $taskServerScript + '"')) -WorkingDirectory $taskProject -WindowStyle Hidden -PassThru
    $taskDeadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        Start-Sleep -Milliseconds 300
        & $taskPython -B $taskServerScript --check
        if ($LASTEXITCODE -eq 0) { break }
        if ($taskServerProcess.HasExited) {
            throw '공유 서버가 시작되지 않았습니다. .runtime\shared-server.json 상태를 확인해 주세요.'
        }
    } while ([DateTime]::UtcNow -lt $taskDeadline)
    if ($LASTEXITCODE -ne 0) {
        throw '공유 서버 인증 연결 대기 시간이 초과되었습니다.'
    }
}
$taskServer = Get-Content -LiteralPath $taskServerPath -Encoding UTF8 | ConvertFrom-Json
$taskOldToken = $env:R1_CODEX_SERVER_TOKEN
try {
    $env:R1_CODEX_SERVER_TOKEN = [IO.File]::ReadAllText($taskTokenPath, [Text.Encoding]::UTF8).Trim()
    Write-Host '같은 대화를 공유 서버에서 이어받습니다. 새 대화를 만들지 않습니다.'
    & $taskBinary resume $taskGuid.ToString() --remote $taskServer.endpoint --remote-auth-token-env R1_CODEX_SERVER_TOKEN -C $WorkingDirectory
    if ($LASTEXITCODE -ne 0) {
        throw '대화 재접속이 종료되었습니다. 위 오류 내용을 확인해 주세요.'
    }
} finally {
    $env:R1_CODEX_SERVER_TOKEN = $taskOldToken
}
