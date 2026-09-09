# OctopCutes-Bot 香橙派→本機備份腳本（繁體中文）
# 用法：powershell -ExecutionPolicy Bypass -File backup_from_pi.ps1
# 將香橙派 /root/octopus-bot 的資料檔與程式檔拉到本機 backups\<日期>，保留最近 7 天。
$ErrorActionPreference = 'Continue'
$pi = 'root@192.168.0.54'
$srcDir = '/root/octopus-bot'
$destRoot = Join-Path $PSScriptRoot 'backups'
$stamp = Get-Date -Format 'yyyyMMdd'
$dest = Join-Path $destRoot $stamp
New-Item -ItemType Directory -Force -Path $dest | Out-Null

# 要備份的檔案（crash.log 可能不存在，失敗不影響其他）
$files = @('config.json','blacklist.json','logs.json','bot.js','package.json','README.md','.env','crash.log')
$ok = 0
foreach ($f in $files) {
    scp -q "${pi}:${srcDir}/${f}" $dest 2>$null
    if (Test-Path (Join-Path $dest $f)) { $ok++ }
}

# 刪除 7 天前的備份（僅保留日期格式資料夾）
Get-ChildItem $destRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^\d{8}$' -and $_.LastWriteTime -lt (Get-Date).AddDays(-7) } |
    Remove-Item -Recurse -Force

Write-Output "✅ 備份完成：$dest（成功 $ok / $($files.Count) 個檔案）"
Get-ChildItem $dest | Select-Object Name, Length | Format-Table -AutoSize
