// V0.4.1 測試：人工駁回・防反彈記憶・再現警示
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

const DAY = 24 * 60 * 60 * 1000;
const now = 1700000000000;
const FakeDate = class { static now() { return now; } };

// ===== 1) 爆發提升防反彈（recordScamCandidate）=====
const tierCode = src.match(/function assessLearningTier[\s\S]*?\n\}/)[0];
const gRepCode = src.match(/function getGuildReputation[\s\S]*?\n\}/)[0];
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

// 場景 1：駁回 7 天內 → 多來源達標不提升（候選被清）
{
    const shared = { 'rejected-a.xyz': { count: 3, lastHit: now, sources: ['g1', 'g2'] } };
    const bl = { scamDomains: [], scamDomainMeta: {}, rejectedDomains: { 'rejected-a.xyz': { at: now - 2 * DAY } } };
    const { record, actions } = buildRecord(shared, bl);
    record('rejected-a.xyz', { guildId: 'g1', accountAgeDays: 100 });
    check('駁回冷卻中不即時提升', bl.scamDomains.includes('rejected-a.xyz'), false);
    check('候選被清（防每日回合誤升）', shared['rejected-a.xyz'] === undefined, true);
    check('無 SCAM_LEARN', actions.some(a => a[0] === 'SCAM_LEARN'), false);
}

// 場景 2：駁回 8 天前（過冷卻）→ 提升成功＋再現警示
{
    const shared = { 'rejected-b.xyz': { count: 3, lastHit: now, sources: ['g1', 'g2'] } };
    const bl = { scamDomains: [], scamDomainMeta: {}, rejectedDomains: { 'rejected-b.xyz': { at: now - 8 * DAY } } };
    const { record, actions } = buildRecord(shared, bl);
    record('rejected-b.xyz', { guildId: 'g1', accountAgeDays: 100 });
    check('過冷卻可再次提升', bl.scamDomains.includes('rejected-b.xyz'), true);
    check('記錄 SCAM_REJECTED_AGAIN', actions.some(a => a[0] === 'SCAM_REJECTED_AGAIN'), true);
    check('也記錄 SCAM_LEARN', actions.some(a => a[0] === 'SCAM_LEARN'), true);
}

// 場景 3：無駁回 → 正常爆發提升（回歸）
{
    const shared = { 'normal-burst.xyz': { count: 3, lastHit: now, sources: ['g1', 'g2'] } };
    const bl = { scamDomains: [], scamDomainMeta: {} };
    const { record, actions } = buildRecord(shared, bl);
    record('normal-burst.xyz', { guildId: 'g1', accountAgeDays: 100 });
    check('無駁回正常提升', bl.scamDomains.includes('normal-burst.xyz'), true);
    check('無再現警示', actions.some(a => a[0] === 'SCAM_REJECTED_AGAIN'), false);
}

// ===== 2) 每日回合防反彈（learnScamDomains）=====
const lsStart = src.indexOf('function learnScamDomains');
const lsEnd = src.indexOf('// 每 24 小時執行一次學習回合');
const lsCode = src.slice(lsStart, lsEnd);
const csStart = src.indexOf('function getScamCandidates');
const csEnd = src.indexOf('function recordScamCandidate');
const csCode = src.slice(csStart, csEnd);

function buildLearn(bl) {
    const actions = [];
    const learn = new Function('Date', 'loadBlacklist', 'saveBlacklist', 'logAction', 'getScamCandidates',
        [tierCode, officialCode, csCode, lsCode, 'return learnScamDomains;'].join('\n'))(
        FakeDate, () => bl, (d) => { actions.push(['save']); }, (t, d) => actions.push([t, d]), () => bl.scamCandidateStats || {}
    );
    return { learn, actions, bl };
}

// 場景 4：每日回合——駁回 7 天內 → 單一來源 count5 不提升（候選清掉）
{
    const bl = { scamDomains: [], scamDomainMeta: {}, scamCandidateStats: { 'rejected-c.xyz': { count: 5, lastHit: now, sources: ['g1'] } }, rejectedDomains: { 'rejected-c.xyz': { at: now - 1 * DAY } } };
    const { learn, actions } = buildLearn(bl);
    const r = learn();
    check('每日回合駁回冷卻中不提升', bl.scamDomains.includes('rejected-c.xyz'), false);
    check('候選被清', bl.scamCandidateStats['rejected-c.xyz'] === undefined, true);
    check('learned=0', r.learned, 0);
    check('無 SCAM_LEARN', actions.some(a => a[0] === 'SCAM_LEARN'), false);
}

// 場景 5：每日回合——駁回過冷卻 → 提升＋再現警示
{
    const bl = { scamDomains: [], scamDomainMeta: {}, scamCandidateStats: { 'rejected-d.xyz': { count: 5, lastHit: now, sources: ['g1'] } }, rejectedDomains: { 'rejected-d.xyz': { at: now - 10 * DAY } } };
    const { learn, actions } = buildLearn(bl);
    const r = learn();
    check('每日回合過冷卻可提升', bl.scamDomains.includes('rejected-d.xyz'), true);
    check('learned=1', r.learned, 1);
    check('記錄 SCAM_REJECTED_AGAIN', actions.some(a => a[0] === 'SCAM_REJECTED_AGAIN'), true);
}

// 場景 6：每日回合——無駁回正常提升（回歸）
{
    const bl = { scamDomains: [], scamDomainMeta: {}, scamCandidateStats: { 'normal-daily.xyz': { count: 5, lastHit: now, sources: ['g1'] } } };
    const { learn } = buildLearn(bl);
    const r = learn();
    check('每日回合無駁回正常提升', bl.scamDomains.includes('normal-daily.xyz'), true);
    check('learned=1', r.learned, 1);
}

console.log(`\n========== ${fail === 0 ? '全部通過' : '有失敗'}（${pass} 通過 / ${fail} 失敗）==========`);
process.exit(fail === 0 ? 0 : 1);
