// V0.3.5 測試：智慧學習強化（仿冒偵測／跨伺服器共識／新帳號關聯／累犯加成）
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

// ===== levenshtein =====
const lvStart = src.indexOf('function levenshtein');
const lvEnd = src.indexOf('// V0.3.5：仿冒官方域名偵測');
if (lvStart === -1 || lvEnd === -1) { console.error('❌ 找不到 levenshtein'); process.exit(1); }
const levenshtein = new Function(src.slice(lvStart, lvEnd) + '; return levenshtein;')();
check('相同字串距離 0', levenshtein('discord.com', 'discord.com'), 0);
check('一字差距離 1', levenshtein('discord.com', 'disc0rd.com'), 1);
check('長度差', levenshtein('abc', 'abcdef'), 3);
check('完全不同', levenshtein('abc', 'xyz'), 3);

// ===== isTyposquatOf（含 levenshtein 定義）=====
const tsStart = src.indexOf('function deobfuscate');
const tsEnd = src.indexOf('// 清除超過 72 小時未命中的過期候選');
if (tsStart === -1 || tsEnd === -1) { console.error('❌ 找不到 isTyposquatOf'); process.exit(1); }
const OFFLINE = ['discord.com', 'discord.gg', 'github.com', 'steampowered.com', 'google.com'];
const isTyposquat = new Function('OFFICIAL_DOMAINS', 'isValidDomain', src.slice(tsStart, tsEnd) + '; return isTyposquatOf;')(OFFLINE, () => true);
check('disc0rd.com 仿冒', isTyposquat('disc0rd.com'), true);
check('discord-verify.com 仿冒', isTyposquat('discord-verify.com'), true);
check('steamgift.net 仿冒', isTyposquat('steamgift.net'), true);
check('官方本身不算', isTyposquat('discord.com'), false);
check('官方子域不算', isTyposquat('discord.gg'), false);
check('正常域名不算', isTyposquat('google.com'), false);
check('無品牌名域名不算', isTyposquat('my-fan-page.com'), false);

// ===== recordScamCandidate 加權 =====
const rcStart = src.indexOf('function recordScamCandidate');
const rcEnd = src.indexOf('// 域名格式驗證');
if (rcStart === -1 || rcEnd === -1) { console.error('❌ 找不到 recordScamCandidate'); process.exit(1); }
const tierCode = src.match(/function assessLearningTier[\s\S]*?\n\}/)[0];
const shared = {};
const bl = { scamDomains: [], scamDomainMeta: {} };
const rc = new Function(
    'getScamCandidates', 'saveBlacklist', 'loadBlacklist', 'isTyposquatOf', 'OFFICIAL_DOMAINS', 'logAction',
    tierCode + src.slice(rcStart, rcEnd) + '; return recordScamCandidate;'
)(
    () => shared, () => {}, () => bl,
    (h) => h === 'disc0rd.com',
    ['discord.com', 'discord.gg'], () => {}
);
rc('example-scam.com', { guildId: 'g1', accountAgeDays: 100 });
check('一般候選單次 +1', shared['example-scam.com'].count, 1);
rc('example-scam.com', { guildId: 'g1', accountAgeDays: 100 });
check('同來源重複不加成', shared['example-scam.com'].count, 2);
rc('example-scam.com', { guildId: 'g2', accountAgeDays: 100 });
check('跨伺服器共識加成達 4（V0.3.9 即時提升）', bl.scamDomainMeta['example-scam.com'].reports, 4);
check('多來源 count≥3 即時提升（V0.3.9）', bl.scamDomains.includes('example-scam.com'), true);
check('即時提升後候選移除', shared['example-scam.com'] === undefined, true);
check('提升 meta 記錄多來源', bl.scamDomainMeta['example-scam.com'].sources.length, 2);
rc('newbie-scam.com', { guildId: 'g1', accountAgeDays: 2 });
check('新帳號關聯加成（+2）', shared['newbie-scam.com'].count, 2);
rc('disc0rd.com', { guildId: 'g1', accountAgeDays: 100 });
check('仿冒官方加成（+2）', shared['disc0rd.com'].count, 2);

// ===== isKnownOffender / addRisk 累犯加成 =====
const oStart = src.indexOf('function isKnownOffender');
const oEnd = src.indexOf('const RISK_HALF_LIFE');
if (oStart === -1 || oEnd === -1) { console.error('❌ 找不到 isKnownOffender'); process.exit(1); }
const offender = new Function('logsBuffer', src.slice(oStart, oEnd) + '; return isKnownOffender;');
check('無紀錄非累犯', offender([])('u1'), false);
const logs = [{ action: 'WARNING', details: { userId: 'u2' } }, { action: 'BAN', details: { userId: 'u3' } }];
check('BAN 紀錄為累犯', offender(logs)('u3'), true);
check('僅警告非累犯', offender(logs)('u2'), false);

const rStart = src.indexOf('const RISK_HALF_LIFE');
const rEnd = src.indexOf('// ============ 間隔檢測 ============');
if (rStart === -1 || rEnd === -1) { console.error('❌ 找不到風險區塊'); process.exit(1); }
const riskBlock = src.slice(rStart, rEnd);
const tr = new Map();
let fakeNow = 1700000000000;
const FakeDate = class { static now() { return fakeNow; } };
const risk = new Function('trackers', 'Date', 'logsBuffer', 'isKnownOffender', riskBlock + '; return { addRisk, getRiskScore };')(tr, FakeDate, [{ action: 'BAN', details: { userId: 'u9' } }], (uid) => uid === 'u9');
risk.addRisk('u9', 'g1', 'mention'); // 權重 1 + 累犯 1 = 2
check('累犯觸發分數加成', risk.getRiskScore('u9', 'g1'), 2);
const tr2 = new Map();
const risk2 = new Function('trackers', 'Date', 'logsBuffer', 'isKnownOffender', riskBlock + '; return { addRisk, getRiskScore };')(tr2, FakeDate, [], () => false);
risk2.addRisk('u1', 'g1', 'mention'); // 非累犯 = 1
check('非累犯無加成', risk2.getRiskScore('u1', 'g1'), 1);

console.log(`\n========== ${fail === 0 ? '全部通過' : '有失敗'}（${pass} 通過 / ${fail} 失敗）==========`);
process.exit(fail === 0 ? 0 : 1);
