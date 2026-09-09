// V0.2.9 安全強化測試：URL 混淆還原 / 短網址偵測 / 指令限流 / Webhook 名稱假冒
const fs = require('fs');
const src = fs.readFileSync('bot.js', 'utf8');

let pass = 0, fail = 0;
function check(name, actual, expected) {
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
        pass++;
        console.log(`✅ ${name}`);
    } else {
        fail++;
        console.log(`❌ ${name}: 期望 ${JSON.stringify(expected)}，實際 ${JSON.stringify(actual)}`);
    }
}

// 抓取 M1 區塊（SHORTENER_DOMAINS 常量 + normalizeLink + extractObfuscatedUrls + isShortener + isHookImpersonating + checkCmdRate）
const startMark = 'const SHORTENER_DOMAINS = [';
const endMark = 'function extractUrls(content)';
const s = src.indexOf(startMark);
const e = src.indexOf(endMark);
if (s === -1 || e === -1 || e <= s) {
    console.error('❌ 無法抓取 V0.2.9 函式區塊');
    process.exit(1);
}
const block = src.slice(s, e);

const fn = new Function('trackers', block + `
return { normalizeLink, extractObfuscatedUrls, isShortener, isHookImpersonating, checkCmdRate };
`)(new Map());
const { normalizeLink, extractObfuscatedUrls, isShortener, isHookImpersonating, checkCmdRate } = fn;

// ===== normalizeLink：URL 混淆還原 =====
check('hxxps 混淆還原', normalizeLink('hxxps://discord-nitro.xyz'), 'https://discord-nitro.xyz');
check('hxxp 混淆還原', normalizeLink('hxxp://evil.com'), 'http://evil.com');
check('大寫 HXXPS 還原', normalizeLink('HXXPS://A[.]B'), 'https://A.B');
check('[.] 混淆還原', normalizeLink('discord-nitro[.]xyz'), 'discord-nitro.xyz');
check('(.) 混淆還原', normalizeLink('discord(.)xyz'), 'discord.xyz');
check('{ . } 混淆還原', normalizeLink('discord{.}xyz'), 'discord.xyz');
check('全形點還原', normalizeLink('discord．xyz'), 'discord.xyz');
check('空格分隔還原', normalizeLink('dis cord . com'), 'discord.com');
check('零寬字元移除', normalizeLink('discord\u200b.com'), 'discord.com');
check('正常網址不變', normalizeLink('https://example.com/path'), 'https://example.com/path');
check('空字串安全', normalizeLink(''), '');

// ===== extractObfuscatedUrls：混淆網址抓取 =====
check('抓 hxxp 混淆', extractObfuscatedUrls('check hxxps://discord-nitro[.]xyz now'), ['https://discord-nitro.xyz']);
check('抓 [.] 混淆', extractObfuscatedUrls('go to discord-nitro[.]xyz'), ['discord-nitro.xyz']);
check('抓 (.) 混淆', extractObfuscatedUrls('visit discord(.)xyz'), ['discord.xyz']);
check('抓全形點', extractObfuscatedUrls('see discord．xyz'), ['discord.xyz']);
check('抓空格分隔', extractObfuscatedUrls('visit discord . com'), ['discord.com']);
check('正常網址不抓', extractObfuscatedUrls('normal https://example.com'), []);
check('純文字不抓', extractObfuscatedUrls('just some words here'), []);
check('多個混淆都抓', extractObfuscatedUrls('a hxxp://x[.]com b y[.]net'), ['http://x.com', 'y.net']);

// ===== isShortener：短網址服務 =====
check('bit.ly 是短網址', isShortener('bit.ly'), true);
check('tinyurl.com 是短網址', isShortener('tinyurl.com'), true);
check('goo.gl 是短網址', isShortener('goo.gl'), true);
check('discord.com 不是', isShortener('discord.com'), false);
check('evil.xyz 不是', isShortener('evil.xyz'), false);

// ===== checkCmdRate：面板指令限流 =====
const tr = new Map();
const rate = new Function('trackers', block + `return checkCmdRate;`)(tr);
check('首次允許', rate('u1'), true);
check('5 秒內拒絕', rate('u1'), false);
check('不同使用者互不影響', rate('u2'), true);
tr.set('cmd_u1', Date.now() - 6000);
check('超過 5 秒後允許', rate('u1'), true);

// ===== isHookImpersonating：Webhook 名稱假冒 =====
check('Discord Nitro 假冒', isHookImpersonating('Discord Nitro'), true);
check('nitro-gift 假冒', isHookImpersonating('nitro-gift'), true);
check('Steam Verify 假冒', isHookImpersonating('Steam Verify'), true);
check('Discord Gift 假冒', isHookImpersonating('discord gift'), true);
check('正常名稱', isHookImpersonating('公告機器人'), false);
check('一般 bot 名稱', isHookImpersonating('My Cool Bot'), false);
check('空名稱', isHookImpersonating(''), false);
check('非字串', isHookImpersonating(null), false);

console.log(`\n========== ${fail === 0 ? '全部通過' : '有失敗'}（${pass} 通過 / ${fail} 失敗）==========`);
process.exit(fail === 0 ? 0 : 1);
