# 프로젝트 가상 환경만 사용하며 Codex나 기존 세션을 시작·중지하지 않습니다.
param([string]$PublicOrigin = 'http://127.0.0.1:8787')
$ErrorActionPreference = 'Stop'
$taskProject = Split-Path -Parent $PSScriptRoot
$taskPython = Join-Path $taskProject '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) {
    throw '프로젝트 가상 환경이 없습니다. README의 설치 절차를 실행해 주세요.'
}
$taskRunTemp = Join-Path $taskProject ('.project_tmp\run-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskRunTemp -Force | Out-Null
$taskOldTemp = $env:TEMP
$taskOldTmp = $env:TMP
$taskOldEncoding = $env:PYTHONIOENCODING
Push-Location $taskProject
try {
    $env:TEMP = $taskRunTemp
    $env:TMP = $taskRunTemp
    $env:PYTHONIOENCODING = 'utf-8'
    & $taskPython -m companion.server --origin $PublicOrigin
} finally {
    Pop-Location
    $env:TEMP = $taskOldTemp
    $env:TMP = $taskOldTmp
    $env:PYTHONIOENCODING = $taskOldEncoding
    # 삭제 대상은 이번 실행에서 생성한 폴더 한 개로 제한합니다.
    $taskResolved = [IO.Path]::GetFullPath($taskRunTemp)
    if ($taskResolved.StartsWith([IO.Path]::GetFullPath($taskProject) + '\.project_tmp\run-')) {
        Remove-Item -LiteralPath $taskResolved -Recurse -Force
    }
}
