// V0.4.5 測試：來源信譽・伺服器可信度
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
const now = 1700000000000;
const FakeDate = class { static now() { return now; } };

// ===== 1) 信譽權重計分（recordScamCandidate）=====
const rcStart = src.indexOf('function recordScamCandidate');
const rcEnd = src.indexOf('// V0.3.7：連結觀察池升級');
const rcCode = src.slice(rcStart, rcEnd);

function buildRecord(shared, bl) {
    const actions = [];
    const record = new Function('getScamCandidates', 'saveBlacklist', 'loadBlacklist', 'isTyposquatOf', 'logAction', 'Date',
        [tierCode, gRepCode, officialCode, rcCode, 'return recordScamCandidate;'].join('\n'))(
        () => shared, (d) => actions.push(['save']), () => bl, () => false,
        (t, d) => actions.push([t, d]), FakeDate
    );
    return { record, actions, bl };
}

// 中性（無信譽資料）→ 權重 1（回歸）
{
    const shared = {};
    const bl = { scamDomains: [], scamDomainMeta: {}, rejectedDomains: {} };
    const { record } = buildRecord(shared, bl);
    record('neutral.xyz', { guildId: 'g1', accountAgeDays: 100 });
    record('neutral.xyz', { guildId: 'g2', accountAgeDays: 100 });
    check('中性伺服器：2 來源即爆發（權重 1 回歸）', bl.scamDomains.includes('neutral.xyz'), true);
}

// 高信譽加速（0.8 → 權重 1.3）
{
    const shared = {};
    const bl = { scamDomains: [], scamDomainMeta: {}, rejectedDomains: {}, guildReputations: { g1: 0.8 } };
    const { record } = buildRecord(shared, bl);
    record('trusted.xyz', { guildId: 'g1', accountAgeDays: 100 });
    record('trusted.xyz', { guildId: 'g1', accountAgeDays: 100 });
    check('高信譽：單來源 2 次未達標（2.6）', bl.scamDomains.includes('trusted.xyz'), false);
    record('trusted.xyz', { guildId: 'g2', accountAgeDays: 100 });
    check('高信譽：加中性來源即達 3.6 爆發', bl.scamDomains.includes('trusted.xyz'), true);
}

// 低信譽減速（0.2 → 權重 0.7）
{
    const shared = {};
    const bl = { scamDomains: [], scamDomainMeta: {}, rejectedDomains: {}, guildReputations: { g1: 0.2 } };
    const { record } = buildRecord(shared, bl);
    for (let i = 0; i < 3; i++) record('distrusted.xyz', { guildId: 'g1', accountAgeDays: 100 });
    check('低信譽：單來源 3 次不達標（2.1）', bl.scamDomains.includes('distrusted.xyz'), false);
    record('distrusted.xyz', { guildId: 'g2', accountAgeDays: 100 });
    check('低信譽：需高信譽/中性來源背書才爆發', bl.scamDomains.includes('distrusted.xyz'), true);
}

// ===== 2) 學習提升後信譽加分 =====
const candStart = src.indexOf('function getScamCandidates');
const candEnd = src.indexOf('function recordScamCandidate');
const candCode = src.slice(candStart, candEnd);
const learnStart = src.indexOf('function learnScamDomains');
const learnEnd = src.indexOf('// 每 24 小時執行一次學習回合');
const learnCode = src.slice(learnStart, learnEnd);

function buildLearn(candidates, bl) {
    const actions = [];
    const learn = new Function('Date', 'loadBlacklist', 'saveBlacklist', 'logAction',
        [tierCode, officialCode, candCode, learnCode, 'return learnScamDomains;'].join('\n'))(
        FakeDate, () => bl, (d) => actions.push(['save']), (t, d) => actions.push([t, d])
    );
    return { learn, actions, bl };
}

{
    const candidates = { 'rep-learn.xyz': { count: 3, sources: ['g1', 'g2'], lastHit: now } };
    const bl = { scamDomains: [], scamDomainMeta: {}, rejectedDomains: {}, scamCandidateStats: candidates };
    const { learn } = buildLearn(candidates, bl);
    learn();
    check('提升成功', bl.scamDomains.includes('rep-learn.xyz'), true);
    check('來源伺服器信譽 +0.1', bl.guildReputations.g1, 0.6);
    check('另一來源也 +0.1', bl.guildReputations.g2, 0.6);
    check('meta 記錄來源', JSON.stringify(bl.scamDomainMeta['rep-learn.xyz'].sources), JSON.stringify(['g1', 'g2']));
}

// 信譽上限封頂 1
{
    const candidates = { 'rep-cap.xyz': { count: 3, sources: ['g1', 'g2'], lastHit: now } };
    const bl = { scamDomains: [], scamDomainMeta: {}, rejectedDomains: {}, guildReputations: { g1: 0.95 }, scamCandidateStats: candidates };
    const { learn } = buildLearn(candidates, bl);
    learn();
    check('信譽上限封頂 1', bl.guildReputations.g1, 1);
}

// ===== 3) 審核駁回信譽懲罰（applyLowAgeReview）=====
const arStart = src.indexOf('function applyLowAgeReview');
const arEnd = src.indexOf('// 域名格式驗證（防駭）');
const arCode = src.slice(arStart, arEnd);
const cutoff = now - 30 * 86400000;

function buildApply(bl) {
    const actions = [];
    const fn = new Function('loadBlacklist', 'saveBlacklist', 'logAction', 'Date',
        [officialCode, arCode, 'return applyLowAgeReview;'].join('\n'))(
        () => bl, (d) => { actions.push(['save']); }, (t, d) => actions.push([t, d]),
        FakeDate
    );
    return { fn, actions, bl };
}

{
    const bl = { scamDomains: [], scamDomainMeta: {}, rejectedDomains: {}, guildReputations: { g1: 0.5 }, scamCandidateStats: { 'rep-reject.xyz': { count: 2, sources: ['g1', 'g2'], lastHit: now } } };
    const { fn } = buildApply(bl);
    fn('rep-reject.xyz', 'g9', false, '管理者');
    check('駁回後候選來源信譽 -0.2', bl.guildReputations.g1, 0.3);
    check('另一來源也 -0.2', bl.guildReputations.g2, 0.3);
    check('候選已清除', bl.scamCandidateStats['rep-reject.xyz'] === undefined, true);
}

// 信譽下限歸零
{
    const bl = { scamDomains: [], scamDomainMeta: {}, rejectedDomains: {}, guildReputations: { g1: 0.1 }, scamCandidateStats: { 'rep-floor.xyz': { count: 2, sources: ['g1'], lastHit: now } } };
    const { fn } = buildApply(bl);
    fn('rep-floor.xyz', 'g9', false, '管理者');
    check('信譽下限歸零', bl.guildReputations.g1, 0);
}

console.log(`\n========== ${fail === 0 ? '全部通過' : '有失敗'}（${pass} 通過 / ${fail} 失敗）==========`);
process.exit(fail === 0 ? 0 : 1);
