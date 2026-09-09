// V0.2.5 詐騙連結攔截 + 假冒名稱偵測單元測試
// 直接從 bot.js 抽取實際函式來測，避免測試與實作脫節。
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'bot.js'), 'utf8');

function grab(pattern, label) {
  const m = src.match(pattern);
  if (!m) { console.error(`❌ 找不到 ${label}`); process.exit(1); }
  return m[0];
}

const code = [
  grab(/const SCAM_DOMAINS = \[[\s\S]*?\];/, 'SCAM_DOMAINS'),
  grab(/const OFFICIAL_DOMAINS = \[[\s\S]*?\];/, 'OFFICIAL_DOMAINS'),
  grab(/const SHORTENER_DOMAINS = \[[\s\S]*?\];/, 'SHORTENER_DOMAINS'),
  grab(/function extractUrls\(content\) \{[\s\S]*?\r?\n\}/, 'extractUrls'),
  grab(/function getScamReason\(url\) \{[\s\S]*?\r?\n\}/, 'getScamReason'),
  grab(/function isShortener\(host\) \{[\s\S]*?\r?\n\}/, 'isShortener'),
  grab(/function isImpersonating\(user\) \{[\s\S]*?\r?\n\}/, 'isImpersonating'),
  'return { SCAM_DOMAINS, OFFICIAL_DOMAINS, SHORTENER_DOMAINS, extractUrls, getScamReason, isShortener, isImpersonating };'
].join('\n');

const mod = new Function(code)();
const { extractUrls, getScamReason, isImpersonating } = mod;

let pass = true;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) console.log(`❌ ${label}: 期望 ${JSON.stringify(expected)}，實際 ${JSON.stringify(actual)}`);
  else console.log(`✅ ${label}`);
  if (!ok) pass = false;
}

// ===== extractUrls =====
const urls = extractUrls('看看這個 https://example.com/a?b=1 還有 http://test.org 結尾');
check('extractUrls 提取兩個 URL', urls.length, 2);
check('extractUrls 保留 query', urls[0], 'https://example.com/a?b=1');
check('extractUrls 第二個 URL', urls[1], 'http://test.org');
check('extractUrls 無 URL', extractUrls('完全沒有連結').length, 0);
check('extractUrls 去除結尾標點', extractUrls('https://example.com/.').length > 0 ? extractUrls('https://example.com/.')[0] : 'X', 'https://example.com/');

// ===== getScamReason：官方域 → null =====
check('官方 discord.com', getScamReason('https://discord.com/channels/123'), null);
check('官方 discord.gg', getScamReason('https://discord.gg/abc'), null);
check('官方 github.com', getScamReason('https://github.com/user/repo'), null);
check('官方 discord.js.org', getScamReason('https://discord.js.org/docs'), null);
check('官方子域 discordapp.com', getScamReason('https://canary.discord.com/app'), null);

// ===== getScamReason：詐騙黑名單 → 原因 =====
check('黑名單 discord-nitro.com', getScamReason('https://discord-nitro.com/free') !== null, true);
check('黑名單 discordnitro.xyz', getScamReason('http://discordnitro.xyz/gift') !== null, true);
check('黑名單 steamgift.net', getScamReason('https://steamgift.net/codes') !== null, true);
check('黑名單子域 evil.discordgift.io', getScamReason('https://evil.discordgift.io/x') !== null, true);

// ===== getScamReason：偽官方 → 原因 =====
check('偽官方 discord.com.evil.com', getScamReason('https://discord.com.evil.com/verify') !== null, true);
check('偽官方 discord-verify.net', getScamReason('https://discord-verify.net/') !== null, true);
check('偽官方 free-nitro.xyz', getScamReason('https://free-nitro.xyz/') !== null, true);

// ===== getScamReason：IP 直連 → 原因 =====
check('IP 直連', getScamReason('http://192.168.1.5/hack'), 'IP 直連連結');
check('IP 直連帶埠', getScamReason('http://10.0.0.1:8080/x') !== null, true);

// ===== getScamReason：無效/其他 → null =====
check('無效 URL', getScamReason('not-a-url'), null);
check('正常網域', getScamReason('https://example.com/page'), null);

// ===== isImpersonating =====
check('discord nitro 名稱', isImpersonating({ username: 'discord nitro gift' }) !== null, true);
check('Free Nitro 名稱', isImpersonating({ username: 'Free Nitro' }) !== null, true);
check('steam gift 名稱', isImpersonating({ username: 'steam gift bot' }) !== null, true);
check('一般名稱', isImpersonating({ username: 'octopus123' }), null);
check('discord.js 開發者不誤判', isImpersonating({ username: 'discord.js developer' }), null);
check('空名稱', isImpersonating({}), null);

console.log(pass ? '========== 全部通過 ==========' : '========== 有失敗 ==========');
process.exit(pass ? 0 : 1);
