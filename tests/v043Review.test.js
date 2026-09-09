// V0.4.3 測試：一鍵審核回報（applyLowAgeReview）＋學習品質指標
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

// ===== 1) applyLowAgeReview =====
const arStart = src.indexOf('function applyLowAgeReview');
const arEnd = src.indexOf('// 域名格式驗證（防駭）');
if (arStart === -1 || arEnd === -1) { console.error('❌ 找不到 applyLowAgeReview'); process.exit(1); }
const arCode = src.slice(arStart, arEnd);

function buildApply(bl) {
    const actions = [];
    const fn = new Function('loadBlacklist', 'saveBlacklist', 'logAction', 'Date',
        [officialCode, arCode, 'return applyLowAgeReview;'].join('\n'))(
        () => bl, (d) => { actions.push(['save']); }, (t, d) => actions.push([t, d]),
        class { static now() { return 1700000000000; } }
    );
    return { fn, actions, bl };
}

// 場景 1：確認釣魚 → 加入黑名單
{
    const bl = { scamDomains: [], scamDomainMeta: {} };
    const { fn, actions } = buildApply(bl);
    const r = fn('phish-review.xyz', 'g1', true, '開發者#1');
    check('確認釣魚 ok', r.ok, true);
    check('已加入黑名單', bl.scamDomains.includes('phish-review.xyz'), true);
    check('confirmed=true', bl.scamDomainMeta['phish-review.xyz'].confirmed, true);
    check('來源=管理員審核', bl.scamDomainMeta['phish-review.xyz'].source, '管理員審核');
    check('記錄審核者', bl.scamDomainMeta['phish-review.xyz'].reviewedBy, '開發者#1');
    check('SCAM_LEARN 事件', actions.some(a => a[0] === 'SCAM_LEARN'), true);
}

// 場景 2：確認釣魚但官方域名 → 拒絕
{
    const bl = { scamDomains: [], scamDomainMeta: {} };
    const { fn, actions } = buildApply(bl);
    const r = fn('discord.com', 'g1', true, '開發者#1');
    check('官方域名拒絕', r.ok, false);
    check('未加入', bl.scamDomains.length, 0);
    check('無 SCAM_LEARN', actions.some(a => a[0] === 'SCAM_LEARN'), false);
}

// 場景 3：放行 → 駁回記錄＋清候選
{
    const bl = { scamDomains: [], scamDomainMeta: {}, rejectedDomains: {}, scamCandidateStats: { 'review-pass.xyz': { count: 3 } } };
    const { fn, actions } = buildApply(bl);
    const r = fn('review-pass.xyz', 'g2', false, '管理員#2');
    check('放行 ok', r.ok, true);
    check('駁回記錄存在', bl.rejectedDomains['review-pass.xyz'] !== undefined, true);
    check('駁回含審核者', bl.rejectedDomains['review-pass.xyz'].by, '管理員#2');
    check('候選已清除', bl.scamCandidateStats['review-pass.xyz'] === undefined, true);
    check('SCAM_REJECT 事件', actions.some(a => a[0] === 'SCAM_REJECT'), true);
}

// 場景 4：放行且無候選（防呆）
{
    const bl = { scamDomains: [], scamDomainMeta: {} };
    const { fn } = buildApply(bl);
    const r = fn('no-candidate.xyz', 'g1', false, '管理員#1');
    check('無候選放行不崩潰', r.ok, true);
    check('駁回記錄存在', bl.rejectedDomains['no-candidate.xyz'] !== undefined, true);
}

// ===== 2) 彙報學習品質指標 =====
const rStart = src.indexOf('async function reportLearning');
const rEnd = src.indexOf('// 每 24 小時執行一次學習回合');
const rCode = src.slice(rStart, rEnd);

(async () => {
function buildReport(bl, guildIds) {
    const sent = [];
    const client = { guilds: { cache: new Map(guildIds.map(g => [g, { id: g }])) } };
    const embed = { fields: [], setColor() { return this; }, setTitle() { return this; }, setDescription() { return this; }, setTimestamp() { return this; }, addFields(...fs) { this.fields.push(...fs); return this; } };
    const EmbedBuilder = class { constructor() { return embed; } };
    const report = new Function('loadBlacklist', 'sendAlert', 'EmbedBuilder', 'client', rCode + '; return reportLearning;')(
        () => bl, async (gid, emb) => { sent.push({ gid, emb }); }, EmbedBuilder, client
    );
    return { report, sent, embed };
}

// 場景 5：品質欄位計算（近 30 天）
{
    const now = Date.now();
    const DAY = 86400000;
    const bl = {
        scamDomainMeta: {
            'a.xyz': { learnedAt: now - 5 * DAY },   // 30 天內
            'b.xyz': { learnedAt: now - 40 * DAY },  // 超過 30 天
            'c.xyz': { learnedAt: now - 2 * DAY }
        },
        rejectedDomains: {
            'r1.xyz': { at: now - 10 * DAY },
            'r2.xyz': { at: now - 50 * DAY }         // 超過 30 天
        }
    };
    const { report, sent, embed } = buildReport(bl, ['g1']);
    await report({ learned: 1, removed: 0, forgotten: 0, unconfirmed: 0 });
    const qField = embed.fields.find(f => f.name.includes('學習品質'));
    check('品質欄位存在', qField !== undefined, true);
    check('提升=2（30 天內）', (qField ? qField.value : '').includes('提升 2'), true);
    check('駁回=1（30 天內）', (qField ? qField.value : '').includes('駁回 1'), true);
    check('駁回率=33%', (qField ? qField.value : '').includes('33%'), true);
}

// 場景 6：零駁回不顯示率
{
    const now = Date.now();
    const bl = { scamDomainMeta: { 'a.xyz': { learnedAt: now - 1000 } }, rejectedDomains: {} };
    const { report, sent, embed } = buildReport(bl, ['g1']);
    await report({ learned: 1, removed: 0, forgotten: 0, unconfirmed: 0 });
    const qField = embed.fields.find(f => f.name.includes('學習品質'));
    check('零駁回顯示提升 1', (qField ? qField.value : '').includes('提升 1'), true);
    check('零駁回不顯示率', (qField ? qField.value : '').includes('%'), false);
}

console.log(`\n========== ${fail === 0 ? '全部通過' : '有失敗'}（${pass} 通過 / ${fail} 失敗）==========`);
process.exit(fail === 0 ? 0 : 1);
})();
