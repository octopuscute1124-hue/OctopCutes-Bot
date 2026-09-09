// V0.4.4 測試：自我校準・動態學習門檻
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
const now = 1700000000000;
const cutoff = now - 30 * 86400000;
const FakeDate = class { static now() { return now; } };

// ===== 1) 品質評估函式 assessLearningTier =====
const assess = new Function('Date', tierCode + '; return assessLearningTier;')(FakeDate);
{
    const bl = { scamDomainMeta: { a: { learnedAt: cutoff + 1 } }, rejectedDomains: {} };
    check('駁回率 0% → normal', assess(bl), 'normal');
}
{
    const bl = {
        scamDomainMeta: { a: { learnedAt: cutoff + 1 }, b: { learnedAt: cutoff + 2 }, c: { learnedAt: cutoff + 3 } },
        rejectedDomains: { x: { at: cutoff + 1 } }
    };
    check('駁回率 25% → tight', assess(bl), 'tight');
}
{
    const bl = {
        scamDomainMeta: { a: { learnedAt: cutoff + 1 }, b: { learnedAt: cutoff + 2 }, c: { learnedAt: cutoff + 3 } },
        rejectedDomains: { x: { at: cutoff + 1 }, y: { at: cutoff + 2 } }
    };
    check('駁回率 40% → strict', assess(bl), 'strict');
}
{
    const bl = { scamDomainMeta: { a: { learnedAt: cutoff + 1 } }, rejectedDomains: { x: { at: cutoff + 1 } } };
    check('樣本 2 筆 → normal（不調整）', assess(bl), 'normal');
}
{
    const bl = { scamDomainMeta: { a: { learnedAt: cutoff - 1 } }, rejectedDomains: { x: { at: cutoff - 1 } } };
    check('超過 30 天不計入 → normal', assess(bl), 'normal');
}

// ===== 2) 每日提升動態門檻 =====
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

// strict 級（駁回率 40%）：多來源需 ≥5
{
    const candidates = { 'strict-case.xyz': { count: 3, sources: ['g1', 'g2'], lastHit: now } };
    const bl = {
        scamDomains: [],
        scamDomainMeta: { a: { learnedAt: cutoff + 1 }, b: { learnedAt: cutoff + 2 }, c: { learnedAt: cutoff + 3 } },
        rejectedDomains: { x: { at: cutoff + 1 }, y: { at: cutoff + 2 } },
        scamCandidateStats: candidates
    };
    const { learn } = buildLearn(candidates, bl);
    learn();
    check('strict 級：多來源 count3 不提升（需 5）', bl.scamDomains.includes('strict-case.xyz'), false);
    candidates['strict-case.xyz'].count = 5;
    learn();
    check('strict 級：多來源 count5 提升', bl.scamDomains.includes('strict-case.xyz'), true);
}

// tight 級（駁回率 25%）：多來源需 ≥4
{
    const candidates = { 'tight-case.xyz': { count: 3, sources: ['g1', 'g2'], lastHit: now } };
    const bl = {
        scamDomains: [],
        scamDomainMeta: { a: { learnedAt: cutoff + 1 }, b: { learnedAt: cutoff + 2 }, c: { learnedAt: cutoff + 3 } },
        rejectedDomains: { x: { at: cutoff + 1 } },
        scamCandidateStats: candidates
    };
    const { learn } = buildLearn(candidates, bl);
    learn();
    check('tight 級：多來源 count3 不提升（需 4）', bl.scamDomains.includes('tight-case.xyz'), false);
    candidates['tight-case.xyz'].count = 4;
    learn();
    check('tight 級：多來源 count4 提升', bl.scamDomains.includes('tight-case.xyz'), true);
}

// normal 級（無駁回）：多來源 count3 提升（回歸）
{
    const candidates = { 'normal-case.xyz': { count: 3, sources: ['g1', 'g2'], lastHit: now } };
    const bl = { scamDomains: [], scamDomainMeta: {}, rejectedDomains: {}, scamCandidateStats: candidates };
    const { learn } = buildLearn(candidates, bl);
    learn();
    check('normal 級：多來源 count3 提升（回歸）', bl.scamDomains.includes('normal-case.xyz'), true);
}

// strict 級：單一來源需 ≥8
{
    const candidates = { 'single-strict.xyz': { count: 6, sources: ['g1'], lastHit: now } };
    const bl = {
        scamDomains: [],
        scamDomainMeta: { a: { learnedAt: cutoff + 1 }, b: { learnedAt: cutoff + 2 }, c: { learnedAt: cutoff + 3 } },
        rejectedDomains: { x: { at: cutoff + 1 }, y: { at: cutoff + 2 } },
        scamCandidateStats: candidates
    };
    const { learn } = buildLearn(candidates, bl);
    learn();
    check('strict 級：單一來源 count6 不提升（需 8）', bl.scamDomains.includes('single-strict.xyz'), false);
    candidates['single-strict.xyz'].count = 8;
    learn();
    check('strict 級：單一來源 count8 提升', bl.scamDomains.includes('single-strict.xyz'), true);
}

// ===== 3) 爆發式即時提升動態門檻 =====
const rcStart = src.indexOf('function recordScamCandidate');
const rcEnd = src.indexOf('// V0.3.7：連結觀察池升級');
const rcCode = src.slice(rcStart, rcEnd);

function buildRecord(shared, bl) {
    const actions = [];
    const record = new Function('getScamCandidates', 'saveBlacklist', 'loadBlacklist', 'isTyposquatOf', 'logAction', 'Date',
        [tierCode, officialCode, rcCode, 'return recordScamCandidate;'].join('\n'))(
        () => shared, (d) => actions.push(['save']), () => bl, () => false,
        (t, d) => actions.push([t, d]), FakeDate
    );
    return { record, actions, bl };
}

// strict 級：多來源連擊需達 5 次才爆發
{
    const shared = {};
    const bl = {
        scamDomains: [],
        scamDomainMeta: { a: { learnedAt: cutoff + 1 }, b: { learnedAt: cutoff + 2 }, c: { learnedAt: cutoff + 3 } },
        rejectedDomains: { x: { at: cutoff + 1 }, y: { at: cutoff + 2 } }
    };
    const { record } = buildRecord(shared, bl);
    record('strict-burst.xyz', { guildId: 'g1', accountAgeDays: 100 });
    record('strict-burst.xyz', { guildId: 'g2', accountAgeDays: 100 });
    check('strict 級：2 來源連擊未達標不爆發', bl.scamDomains.includes('strict-burst.xyz'), false);
    record('strict-burst.xyz', { guildId: 'g1', accountAgeDays: 100 });
    record('strict-burst.xyz', { guildId: 'g2', accountAgeDays: 100 });
    check('strict 級：連擊達 5 次爆發', bl.scamDomains.includes('strict-burst.xyz'), true);
}

// normal 級：2 來源即爆發（回歸，v039 場景）
{
    const shared = {};
    const bl = { scamDomains: [], scamDomainMeta: {}, rejectedDomains: {} };
    const { record } = buildRecord(shared, bl);
    record('norm-burst.xyz', { guildId: 'g1', accountAgeDays: 100 });
    record('norm-burst.xyz', { guildId: 'g2', accountAgeDays: 100 });
    check('normal 級：2 來源即爆發（回歸）', bl.scamDomains.includes('norm-burst.xyz'), true);
}

// ===== 4) 彙報含學習門檻欄位 =====
(async () => {
const rStart = src.indexOf('async function reportLearning');
const rEnd = src.indexOf('// 每 24 小時執行一次學習回合');
const rCode = src.slice(rStart, rEnd);
const blR = {
    scamDomains: [],
    scamDomainMeta: { a: { learnedAt: cutoff + 1 } },
    rejectedDomains: {}
};
const sent = [];
const report = new Function('loadBlacklist', 'sendAlert', 'EmbedBuilder', 'client', tierCode + rCode + '; return reportLearning;')(
    () => blR,
    (gid, embed) => { sent.push({ gid, fields: embed.fields }); },
    class {
        constructor() {
            this.fields = [];
            this.setColor = () => this;
            this.setTitle = () => this;
            this.setDescription = () => this;
            this.addFields = (f) => { this.fields.push(f); return this; };
        }
    },
    { guilds: { cache: [{ id: 'g1', name: 'G1', members: { cache: new Array(5) } }] } }
);
await report({ learned: 1, removed: 0, forgotten: 0, unconfirmed: 0 });
const tierField = sent.length ? sent[0].fields.find(f => f.name.includes('學習門檻')) : null;
check('彙報含學習門檻欄位', !!tierField, true);
check('門檻欄位含等級', tierField ? tierField.value.includes('標準') || tierField.value.includes('收緊') || tierField.value.includes('嚴格') : false, true);
})();

console.log(`\n========== ${fail === 0 ? '全部通過' : '有失敗'}（${pass} 通過 / ${fail} 失敗）==========`);
process.exit(fail === 0 ? 0 : 1);
