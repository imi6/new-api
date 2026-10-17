# 一键同步官方仓库，并把本地修改接到 local/billing 后推送。
# 双击 sync-billing.bat，或在项目目录执行: powershell -ExecutionPolicy Bypass -File .\sync-billing.ps1
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Stop-Sync([string]$Message) {
    Write-Host ""
    Write-Host $Message -ForegroundColor Red
    exit 1
}

function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$GitArgs)
    Write-Host ("git " + ($GitArgs -join " ")) -ForegroundColor DarkGray
    & git @GitArgs
    if ($LASTEXITCODE -ne 0) {
        Stop-Sync ("命令失败: git " + ($GitArgs -join " "))
    }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Stop-Sync "没有找到 git。"
}

& git rev-parse --is-inside-work-tree 1>$null 2>$null
if ($LASTEXITCODE -ne 0) {
    Stop-Sync "当前目录不是 git 仓库。"
}

foreach ($remote in @("upstream", "origin")) {
    & git remote get-url $remote 1>$null 2>$null
    if ($LASTEXITCODE -ne 0) {
        Stop-Sync "缺少远程 $remote。upstream 应指向官方仓库，origin 应指向你的 GitHub 仓库。"
    }
}

$rebaseMerge = & git rev-parse --git-path rebase-merge
$rebaseApply = & git rev-parse --git-path rebase-apply
if ((Test-Path -LiteralPath $rebaseMerge) -or (Test-Path -LiteralPath $rebaseApply)) {
    Stop-Sync "上一次变基还没结束。解决冲突后执行 git rebase --continue，或放弃这次变基: git rebase --abort"
}

$dirty = @(& git status --porcelain) | Where-Object { $_ -and ($_ -notmatch '^\?\?') }
if ($dirty) {
    Write-Host ($dirty -join "`n")
    Stop-Sync "工作区有未提交的修改。请先提交或还原，再运行这个脚本。"
}

Write-Step "获取官方和 GitHub 上的最新提交"
Invoke-Git fetch upstream
Invoke-Git fetch origin

Write-Step "把 main 快进到官方 main"
Invoke-Git checkout main
Invoke-Git merge --ff-only upstream/main
Invoke-Git push origin main

Write-Step "把本地修改接到新的官方代码上"
Invoke-Git checkout local/billing
Write-Host "git rebase main" -ForegroundColor DarkGray
& git rebase main
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "变基停住了：官方和你改了同一段代码。请打开下面这些文件，保留官方的新逻辑，同时留下你的计费修改。" -ForegroundColor Yellow
    & git diff --name-only --diff-filter=U
    Write-Host ""
    Write-Host "改完后执行:" -ForegroundColor Yellow
    Write-Host "  git add <冲突文件>"
    Write-Host "  git rebase --continue"
    Write-Host "  git push --force-with-lease origin local/billing"
    exit 1
}

Write-Step "推送 local/billing，GitHub 会自动重新构建 newapi-zzs"
Invoke-Git push --force-with-lease origin local/billing

Write-Host ""
Write-Host "完成。main 已与官方对齐，local/billing 已推送。" -ForegroundColor Green
