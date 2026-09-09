// V0.3.6 測試：信任分層・Raid 精準偵測・跨使用者共識・同形字混淆還原
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'bot.js'), 'utf8');

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

// ===== 1) deobfuscate + isTyposquatOf（混淆還原）=====
const tsStart = src.indexOf('function deobfuscate');
const tsEnd = src.indexOf('// 清除超過 72 小時未命中的過期候選');
if (tsStart === -1 || tsEnd === -1) { console.error('❌ 找不到 deobfuscate 區塊'); process.exit(1); }
const OFFLINE = ['discord.com', 'discord.gg', 'github.com', 'steampowered.com', 'google.com'];
const deob = new Function('OFFICIAL_DOMAINS', 'isValidDomain', src.slice(tsStart, tsEnd) + '; return { deobfuscate, isTyposquatOf };')(OFFLINE, () => true);
check('d1sc0rd.com 還原（1→l）', deob.deobfuscate('d1sc0rd.com'), 'dlscord.com');
check('st34mgift.net 還原', deob.deobfuscate('st34mgift.net'), 'steamgift.net');
check('無混淆不變', deob.deobfuscate('discord.com'), 'discord.com');
check('混淆官方判仿冒', deob.isTyposquatOf('d1sc0rd.com'), true);
check('混淆 steam 判仿冒', deob.isTyposquatOf('st34mgift.net'), true);
check('正常官方不算', deob.isTyposquatOf('discord.com'), false);
check('無品牌名不算', deob.isTyposquatOf('my-fan-page.com'), false);

// ===== 2) getTrustTier（信任分層）=====
const tStart = src.indexOf('function getTrustTier');
const tEnd = src.indexOf('const RISK_HALF_LIFE');
if (tStart === -1 || tEnd === -1) { console.error('❌ 找不到 getTrustTier'); process.exit(1); }
const tier = new Function('isWhitelisted', 'PermissionFlagsBits', src.slice(tStart, tEnd) + '; return getTrustTier;');
const mkMember = (opts) => ({
    id: 'u1',
    user: { createdTimestamp: Date.now() - (opts.ageDays || 30) * 86400000 },
    permissions: opts.admin ? { has: () => true } : { has: () => false }
});
const ADMIN = { Administrator: 'ADMIN' };
check('管理員高信任 0.6', tier(() => false, ADMIN)(mkMember({ admin: true })).multiplier, 0.6);
check('白名單高信任 0.6', tier(() => true, ADMIN)(mkMember({})).multiplier, 0.6);
check('新帳號低信任 1.3', tier(() => false, ADMIN)(mkMember({ ageDays: 2 })).multiplier, 1.3);
check('一般成員 1.0', tier(() => false, ADMIN)(mkMember({ ageDays: 60 })).multiplier, 1.0);

// ===== 3) addRisk 信任加權 =====
const rStart = src.indexOf('const RISK_HALF_LIFE');
const rEnd = src.indexOf('// ============ 間隔檢測 ============');
if (rStart === -1 || rEnd === -1) { console.error('❌ 找不到風險區塊'); process.exit(1); }
const riskBlock = src.slice(rStart, rEnd);
const FakeDate = class { static now() { return 1700000000000; } };
const buildRisk = (logs) => {
    const tr = new Map();
    const risk = new Function('trackers', 'Date', 'logsBuffer', 'isKnownOffender', riskBlock + '; return { addRisk, getRiskScore };')(tr, FakeDate, logs, () => false);
    return { tr, risk };
};
const r1 = buildRisk([]);
r1.risk.addRisk('u1', 'g1', 'flood', { trustMultiplier: 0.6 }); // 2 × 0.6 = 1.2
check('高信任權重 ×0.6', r1.risk.getRiskScore('u1', 'g1'), 1.2);
const r2 = buildRisk([]);
r2.risk.addRisk('u2', 'g1', 'flood', { trustMultiplier: 1.3 }); // 2 × 1.3 = 2.6
check('低信任權重 ×1.3', r2.risk.getRiskScore('u2', 'g1'), 2.6);
const r3 = buildRisk([]);
r3.risk.addRisk('u3', 'g1', 'flood'); // 無 meta → 1.0
check('無 meta 不變', r3.risk.getRiskScore('u3', 'g1'), 2);

// ===== 4) trackRaidJoin（Raid 精準偵測）=====
const rjStart = src.indexOf('const raidJoins = new Map();');
const rjEnd = src.indexOf('// V0.3.0：大量加入防護');
if (rjStart === -1 || rjEnd === -1) { console.error('❌ 找不到 trackRaidJoin'); process.exit(1); }
let fakeNow = 1700000000000;
const FakeDate2 = class { static now() { return fakeNow; } };
const raid = new Function('Date', src.slice(rjStart, rjEnd) + '; return trackRaidJoin;')(FakeDate2);
raid('g1', 2); raid('g1', 2); raid('g1', 2); raid('g1', 2);
check('5 個低齡帳號觸發', raid('g1', 2), 5);
raid('g1', 300);
check('老帳號不計入', raid('g1', 300), 5);
fakeNow += 61000; // 過 61 秒
check('過期事件清理', raid('g1', 2), 1);

// ===== 5) watchLink（跨使用者共識）=====
const wlStart = src.indexOf('const linkWatch = new Map();');
const wlEnd = src.indexOf('// 域名格式驗證');
if (wlStart === -1 || wlEnd === -1) { console.error('❌ 找不到 watchLink'); process.exit(1); }
const wl = new Function(src.slice(wlStart, wlEnd) + '; return watchLink;')();
const wr1 = wl('scam.xyz', 'userA');
check('首次記錄 hits=1', wr1.hits, 1);
const wr2 = wl('scam.xyz', 'userA');
check('同人重複無共識', wr2.consensus, false);
const wr3 = wl('scam.xyz', 'userB');
check('2 人共識成立', wr3.consensus, true);
check('不同使用者數=2', wr3.distinctUsers, 2);

// ===== 6) recordScamCandidate 跨使用者加權 =====
const rcStart = src.indexOf('function recordScamCandidate');
const rcEnd = src.indexOf('// V0.3.7：連結觀察池升級');
if (rcStart === -1 || rcEnd === -1) { console.error('❌ 找不到 recordScamCandidate'); process.exit(1); }
const tierCode = src.match(/function assessLearningTier[\s\S]*?\n\}/)[0];
const shared = {};
const bl = { scamDomains: [], scamDomainMeta: {} };
const rc = new Function(
    'getScamCandidates', 'saveBlacklist', 'loadBlacklist', 'isTyposquatOf', 'OFFICIAL_DOMAINS', 'logAction',
    tierCode + src.slice(rcStart, rcEnd) + '; return recordScamCandidate;'
)(() => shared, () => {}, () => bl, () => false, ['discord.com', 'discord.gg'], () => {});
rc('multi-scam.com', { guildId: 'g1', accountAgeDays: 100, senderCount: 1 });
check('單一發送者不加權', shared['multi-scam.com'].count, 1);
rc('multi-scam.com', { guildId: 'g2', accountAgeDays: 100, senderCount: 2 });
check('跨使用者共識加成達 4（V0.3.9 即時提升）', bl.scamDomainMeta['multi-scam.com'].reports, 4);
check('多來源 count≥3 即時提升（V0.3.9）', bl.scamDomains.includes('multi-scam.com'), true);

console.log(`\n========== ${fail === 0 ? '全部通過' : '有失敗'}（${pass} 通過 / ${fail} 失敗）==========`);
process.exit(fail === 0 ? 0 : 1);
