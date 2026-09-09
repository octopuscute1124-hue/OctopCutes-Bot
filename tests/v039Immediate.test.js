// V0.3.9 測試：爆發式即時提升・學習摘要日誌
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

const om = src.match(/const OFFICIAL_DOMAINS = \[[\s\S]*?\];/);
if (!om) { console.error('❌ 找不到 OFFICIAL_DOMAINS'); process.exit(1); }
const officialCode = om[0];
const tierCode = src.match(/function assessLearningTier[\s\S]*?\n\}/)[0];
const gRepCode = src.match(/function getGuildReputation[\s\S]*?\n\}/)[0];
const rcStart = src.indexOf('function recordScamCandidate');
const rcEnd = src.indexOf('// V0.3.7：連結觀察池升級');
if (rcStart === -1 || rcEnd === -1) { console.error('❌ 找不到 recordScamCandidate'); process.exit(1); }
const rcCode = src.slice(rcStart, rcEnd);

// ===== 1) 爆發式即時提升 =====
function buildRecord(shared, bl) {
    const actions = [];
    const record = new Function('getScamCandidates', 'saveBlacklist', 'loadBlacklist', 'isTyposquatOf', 'logAction',
        [tierCode, gRepCode, officialCode, rcCode, 'return recordScamCandidate;'].join('\n'))(
        () => shared, (d) => actions.push(['save']), () => bl, () => false,
        (t, d) => actions.push([t, d])
    );
    return { record, actions, bl };
}

// 場景 1：多來源 count≥3 → 即時提升
{
    const shared = {};
    const bl = { scamDomains: [], scamDomainMeta: {} };
    const { record, actions } = buildRecord(shared, bl);
    record('burst-scam.xyz', { guildId: 'g1', accountAgeDays: 100 });
    record('burst-scam.xyz', { guildId: 'g1', accountAgeDays: 100 });
    record('burst-scam.xyz', { guildId: 'g2', accountAgeDays: 100 });
    check('多來源 3 次即時提升', bl.scamDomains.includes('burst-scam.xyz'), true);
    check('候選已移除', shared['burst-scam.xyz'] === undefined, true);
    check('confirmed=true', bl.scamDomainMeta['burst-scam.xyz'].confirmed, true);
    check('記錄 SCAM_LEARN immediate', actions.some(a => a[0] === 'SCAM_LEARN' && a[1].immediate === true), true);
    check('提升觸發保存', actions.filter(a => a[0] === 'save').length >= 2, true);
}

// 場景 2：單一來源 count4 → 不即時提升（單一來源需每日回合 count≥5）
{
    const shared = {};
    const bl = { scamDomains: [], scamDomainMeta: {} };
    const { record } = buildRecord(shared, bl);
    for (let i = 0; i < 4; i++) record('weak-burst.xyz', { guildId: 'g1', accountAgeDays: 100 });
    check('單一來源 4 次不即時提升', bl.scamDomains.includes('weak-burst.xyz'), false);
    check('候選保留', shared['weak-burst.xyz'].count, 4);
}

// 場景 2b：多來源第二次即觸發（跨伺服器新來源加成 +1）
{
    const shared = {};
    const bl = { scamDomains: [], scamDomainMeta: {} };
    const { record } = buildRecord(shared, bl);
    record('cross-burst.xyz', { guildId: 'g1', accountAgeDays: 100 });
    record('cross-burst.xyz', { guildId: 'g2', accountAgeDays: 100 });
    check('多來源第 2 次（跨服加成達 3）即時提升', bl.scamDomains.includes('cross-burst.xyz'), true);
}

// 場景 3：單一來源 count5 → 不即時提升（需每日回合門檻）
{
    const shared = {};
    const bl = { scamDomains: [], scamDomainMeta: {} };
    const { record } = buildRecord(shared, bl);
    for (let i = 0; i < 5; i++) record('single-burst.xyz', { guildId: 'g1', accountAgeDays: 100 });
    check('單一來源 5 次不即時提升', bl.scamDomains.includes('single-burst.xyz'), false);
    check('候選計數正確', shared['single-burst.xyz'].count, 5);
}

// 場景 4：官方域名不即時提升
{
    const shared = {};
    const bl = { scamDomains: [], scamDomainMeta: {} };
    const { record } = buildRecord(shared, bl);
    record('discord.com', { guildId: 'g1', accountAgeDays: 100 });
    record('discord.com', { guildId: 'g2', accountAgeDays: 100 });
    record('discord.com', { guildId: 'g3', accountAgeDays: 100 });
    check('官方域名不提升', bl.scamDomains.includes('discord.com'), false);
    check('官方候選保留（計數累計但不提升）', shared['discord.com'].count >= 3, true);
}

// 場景 5：已存在於黑名單不重複提升
{
    const shared = {};
    const bl = { scamDomains: ['already-known.xyz'], scamDomainMeta: {} };
    const { record, actions } = buildRecord(shared, bl);
    record('already-known.xyz', { guildId: 'g1', accountAgeDays: 100 });
    record('already-known.xyz', { guildId: 'g2', accountAgeDays: 100 });
    record('already-known.xyz', { guildId: 'g3', accountAgeDays: 100 });
    check('已存在不重複加入', bl.scamDomains.length, 1);
    check('無 SCAM_LEARN 事件', actions.some(a => a[0] === 'SCAM_LEARN'), false);
}

// 場景 6：仿冒官方（子域名尾綴）不誤傷
{
    const shared = {};
    const bl = { scamDomains: [], scamDomainMeta: {} };
    const { record } = buildRecord(shared, bl);
    record('discord.com.evil.xyz', { guildId: 'g1', accountAgeDays: 100 });
    record('discord.com.evil.xyz', { guildId: 'g2', accountAgeDays: 100 });
    record('discord.com.evil.xyz', { guildId: 'g3', accountAgeDays: 100 });
    check('子域名尾綴不被官方誤擋（可學習）', bl.scamDomains.includes('discord.com.evil.xyz'), true);
}

// ===== 2) 學習摘要日誌（SCAM_SUMMARY）=====
{
    const learnStart = src.indexOf('function learnScamDomains');
    const learnEnd = src.indexOf('// 每 24 小時執行一次學習回合');
    const learnCode = src.slice(learnStart, learnEnd);
    const candStart = src.indexOf('function getScamCandidates');
    const candEnd = src.indexOf('function recordScamCandidate');
    const candCode = src.slice(candStart, candEnd);
    const now = 1700000000000;
    const FakeDate = class { static now() { return now; } };
    const candidates = {};
    const bl = { scamDomains: [], scamDomainMeta: {}, scamCandidateStats: candidates };
    const actions = [];
    const learn = new Function('Date', 'loadBlacklist', 'saveBlacklist', 'logAction',
        [tierCode, officialCode, candCode, learnCode, 'return learnScamDomains;'].join('\n'))(
        FakeDate, () => bl, (d) => { actions.push(['save']); }, (t, d) => actions.push([t, d])
    );
    const r = learn();
    check('無變動不寫摘要', actions.some(a => a[0] === 'SCAM_SUMMARY'), false);
    // 有變動才寫摘要
    candidates['summary-test.xyz'] = { count: 3, lastHit: now, sources: ['g1', 'g2'] };
    const r2 = learn();
    check('有提升寫摘要', actions.some(a => a[0] === 'SCAM_SUMMARY'), true);
    check('摘要含學習數', (actions.find(a => a[0] === 'SCAM_SUMMARY') || [])[1].learned, 1);
}

console.log(`\n========== ${fail === 0 ? '全部通過' : '有失敗'}（${pass} 通過 / ${fail} 失敗）==========`);
process.exit(fail === 0 ? 0 : 1);
