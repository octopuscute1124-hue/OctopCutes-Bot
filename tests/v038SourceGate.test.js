// V0.3.8 測試：來源多樣性提升門檻・提升後二次確認（降級機制）
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

// 抽取 learnScamDomains（含 OFFICIAL_DOMAINS、getScamCandidates）
const om = src.match(/const OFFICIAL_DOMAINS = \[[\s\S]*?\];/);
if (!om) { console.error('❌ 找不到 OFFICIAL_DOMAINS'); process.exit(1); }
const officialCode = om[0];
const candStart = src.indexOf('function getScamCandidates');
const candEnd = src.indexOf('function recordScamCandidate');
const candCode = src.slice(candStart, candEnd);
const learnStart = src.indexOf('function learnScamDomains');
const learnEnd = src.indexOf('// 每 24 小時執行一次學習回合');
const learnCode = src.slice(learnStart, learnEnd);

const DAY = 24 * 60 * 60 * 1000;
let now = 1700000000000;
const FakeDate = class { static now() { return now; } };

function buildEnv(domains, meta, candidates) {
    // 注意：new Function 內 getScamCandidates 函式宣告會遮蔽同名參數——改用 bot.js 版函式，經由 bl.scamCandidateStats 共享候選
    const bl = { scamDomains: domains, scamDomainMeta: meta, scamCandidateStats: candidates };
    const actions = [];
    const learn = new Function('Date', 'loadBlacklist', 'saveBlacklist', 'logAction',
        [officialCode, candCode, learnCode, 'return learnScamDomains;'].join('\n'))(
        FakeDate, () => bl, (d) => { actions.push(['save']); }, (t, d) => actions.push([t, d])
    );
    return { learn, actions, bl };
}

// ===== 場景 1：多來源（sources≥2）count 3 → 提升 =====
{
    const candidates = { 'discord-verify.xyz': { count: 3, lastHit: now, sources: ['g1', 'g2'] } };
    const { learn, bl } = buildEnv([], {}, candidates);
    const r = learn();
    check('多來源 count3 提升', bl.scamDomains.includes('discord-verify.xyz'), true);
    check('confirmed=true', bl.scamDomainMeta['discord-verify.xyz'].confirmed, true);
    check('learned=1', r.learned, 1);
}

// ===== 場景 2：單一來源 count 3 → 不提升（需 ≥5）=====
{
    const candidates = { 'single-scam.xyz': { count: 3, lastHit: now, sources: ['g1'] } };
    const { learn, bl } = buildEnv([], {}, candidates);
    const r = learn();
    check('單一來源 count3 不提升', bl.scamDomains.includes('single-scam.xyz'), false);
    check('learned=0', r.learned, 0);
    check('候選保留', 'single-scam.xyz' in candidates, true);
}

// ===== 場景 3：單一來源 count 5 → 提升（未確認）=====
{
    const candidates = { 'persistent-scam.xyz': { count: 5, lastHit: now, sources: ['g1'] } };
    const { learn, bl } = buildEnv([], {}, candidates);
    const r = learn();
    check('單一來源 count5 提升', bl.scamDomains.includes('persistent-scam.xyz'), true);
    check('confirmed=false', bl.scamDomainMeta['persistent-scam.xyz'].confirmed, false);
    check('learned=1', r.learned, 1);
}

// ===== 場景 4：多來源 count 2 → 不提升 =====
{
    const candidates = { 'weak.xyz': { count: 2, lastHit: now, sources: ['g1', 'g2'] } };
    const { learn, bl } = buildEnv([], {}, candidates);
    const r = learn();
    check('多來源 count2 不提升', bl.scamDomains.includes('weak.xyz'), false);
}

// ===== 場景 5：單一來源提升後 24h 無命中 → 降級回候選 =====
{
    const candidates = {};
    const domains = ['persistent-scam.xyz'];
    const meta = { 'persistent-scam.xyz': { reports: 5, hits: 0, addedAt: now - 2 * DAY, source: '自主學習', learnedAt: now - 25 * 3600 * 1000, confirmed: false } };
    const { learn, bl, actions } = buildEnv(domains, meta, candidates);
    const r = learn();
    check('24h 無命中被降級', bl.scamDomains.includes('persistent-scam.xyz'), false);
    check('meta 同步刪除', meta['persistent-scam.xyz'] === undefined, true);
    check('候選恢復', 'persistent-scam.xyz' in candidates, true);
    check('unconfirmed=1', r.unconfirmed, 1);
    check('記錄降級事件', actions.some(a => a[0] === 'SCAM_UNCONFIRMED'), true);
    check('降級觸發保存', actions.some(a => a[0] === 'save'), true);
}

// ===== 場景 6：單一來源提升後 24h 內有命中 → 保留 =====
{
    const candidates = {};
    const domains = ['confirmed-scam.xyz'];
    const meta = { 'confirmed-scam.xyz': { reports: 5, hits: 2, addedAt: now - 2 * DAY, source: '自主學習', learnedAt: now - 25 * 3600 * 1000, confirmed: false } };
    const { learn, bl } = buildEnv(domains, meta, candidates);
    const r = learn();
    check('24h 內有命中保留', bl.scamDomains.includes('confirmed-scam.xyz'), true);
    check('unconfirmed=0', r.unconfirmed, 0);
}

// ===== 場景 7：多來源（confirmed）無命中 → 不降級 =====
{
    const candidates = {};
    const domains = ['multi-confirmed.xyz'];
    const meta = { 'multi-confirmed.xyz': { reports: 3, hits: 0, addedAt: now - 2 * DAY, source: '自主學習', learnedAt: now - 25 * 3600 * 1000, confirmed: true } };
    const { learn, bl } = buildEnv(domains, meta, candidates);
    const r = learn();
    check('多來源已確認不降級', bl.scamDomains.includes('multi-confirmed.xyz'), true);
    check('unconfirmed=0', r.unconfirmed, 0);
}

// ===== 場景 8：不足 24h 不檢查 =====
{
    const candidates = {};
    const domains = ['recent-learned.xyz'];
    const meta = { 'recent-learned.xyz': { reports: 5, hits: 0, addedAt: now, source: '自主學習', learnedAt: now - 2 * 3600 * 1000, confirmed: false } };
    const { learn, bl } = buildEnv(domains, meta, candidates);
    const r = learn();
    check('不足 24h 不降級', bl.scamDomains.includes('recent-learned.xyz'), true);
    check('unconfirmed=0', r.unconfirmed, 0);
}

console.log(`\n========== ${fail === 0 ? '全部通過' : '有失敗'}（${pass} 通過 / ${fail} 失敗）==========`);
process.exit(fail === 0 ? 0 : 1);
