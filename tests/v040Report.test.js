// V0.4.0 測試：每日學習彙報推送
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

const rStart = src.indexOf('async function reportLearning');
const rEnd = src.indexOf('// 每 24 小時執行一次學習回合');
if (rStart === -1 || rEnd === -1) { console.error('❌ 找不到 reportLearning'); process.exit(1); }
const rCode = src.slice(rStart, rEnd);

function buildEnv(bl, guildIds) {
    const sent = [];
    const client = { guilds: { cache: new Map(guildIds.map(g => [g, { id: g }])) } };
    // 共用 embed 物件（new 回傳同一個），fields 累積供斷言
    const embed = { fields: [], color: 0, title: '', description: '', setColor(c) { this.color = c; return this; }, setTitle(t) { this.title = t; return this; }, setDescription(d) { this.description = d; return this; }, setTimestamp() { return this; }, addFields(...fs) { this.fields.push(...fs); return this; } };
    const EmbedBuilder = class { constructor() { return embed; } };
    const report = new Function('loadBlacklist', 'sendAlert', 'EmbedBuilder', 'client', rCode + '; return reportLearning;')(
        () => bl, async (gid, emb) => { sent.push({ gid, emb }); }, EmbedBuilder, client
    );
    return { report, sent, embed };
}

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

(async () => {
// 場景 1：有變動 → 推送給所有伺服器
{
    const bl = { scamDomainMeta: {} };
    const { report, sent, embed } = buildEnv(bl, ['g1', 'g2']);
    await report({ learned: 1, removed: 0, forgotten: 2, unconfirmed: 1 });
    check('有變動推送 2 個伺服器', sent.length, 2);
    check('標題正確', embed.title, '🧠 學習彙報（24h）');
    check('新增欄位=1', embed.fields.find(f => f.name.includes('新增')).value, '1 個');
    check('老化欄位=2', embed.fields.find(f => f.name.includes('老化')).value, '2 個');
    check('降級欄位=1', embed.fields.find(f => f.name.includes('降級')).value, '1 個');
}

// 場景 2：無變動且無近 24h 即時提升 → 不推送
{
    const bl = { scamDomainMeta: { 'old-learned.xyz': { learnedAt: 1700000000000 - 3 * DAY, source: '自主學習', reports: 5 } } };
    const { report, sent } = buildEnv(bl, ['g1']);
    await report({ learned: 0, removed: 0, forgotten: 0, unconfirmed: 0 });
    check('無變動不推送', sent.length, 0);
}

// 場景 3：近 24h 即時提升列入清單
{
    const now = 1700000000000;
    const bl = { scamDomainMeta: {
        'burst-a.xyz': { learnedAt: now - 2 * HOUR, source: '自主學習', reports: 3, confirmed: true },
        'old-burst.xyz': { learnedAt: now - 30 * HOUR, source: '自主學習', reports: 9 }
    } };
    // 因真實 now 無法固定，此場景改驗證「有學習變動時才觸發彙報路徑」的基本行為已由場景 1 覆蓋；
    // immediate 清單存在性在此改為手動檢查欄位名稱是否會出現（依賴相對時間，僅當 learnedAt 為最近時）
    const { report, sent } = buildEnv(bl, ['g1']);
    await report({ learned: 0, removed: 0, forgotten: 0, unconfirmed: 0 });
    check('無變動時即使有 meta 也不推送（彙報由回合驅動）', sent.length, 0);
}

// 場景 4：空 meta 結構安全
{
    const bl = {};
    const { report, sent } = buildEnv(bl, ['g1']);
    await report({ learned: 0, removed: 0, forgotten: 0, unconfirmed: 0 });
    check('空 meta 不崩潰不推送', sent.length, 0);
}

// 場景 5：有回合變動且近 24h 有即時提升 → 含爆發清單欄位
{
    const now = Date.now();
    const bl = { scamDomainMeta: { 'burst-live.xyz': { learnedAt: now - 60 * 1000, source: '自主學習', reports: 4, confirmed: true } } };
    const { report, sent, embed } = buildEnv(bl, ['g1']);
    await report({ learned: 2, removed: 0, forgotten: 0, unconfirmed: 0 });
    check('有變動推送', sent.length, 1);
    const burstField = embed.fields.find(f => f.name.includes('即時封鎖'));
    check('含爆發清單欄位', burstField !== undefined, true);
    check('清單含域名與命中數', (burstField ? burstField.value : '').includes('burst-live.xyz（4 命中'), true);
}

console.log(`\n========== ${fail === 0 ? '全部通過' : '有失敗'}（${pass} 通過 / ${fail} 失敗）==========`);
process.exit(fail === 0 ? 0 : 1);
})();
