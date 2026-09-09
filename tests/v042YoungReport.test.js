// V0.4.2 測試：低齡帳號先行警示・彙報「曾被駁回再現」標記
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

// ===== 1) 低齡帳號先行警示 =====
const laStart = src.indexOf('async function lowAgeScamAlert');
const laEnd = src.indexOf('// 域名格式驗證（防駭）');
if (laStart === -1 || laEnd === -1) { console.error('❌ 找不到 lowAgeScamAlert'); process.exit(1); }
const laCode = src.slice(laStart, laEnd);

function buildAlert() {
    const sent = [];
    const embed = { fields: [], setColor() { return this; }, setTitle(t) { this.title = t; return this; }, setDescription(d) { this.description = d; return this; }, setTimestamp() { return this; }, addFields(...fs) { this.fields.push(...fs); return this; } };
    const EmbedBuilder = class { constructor() { return embed; } };
    const lowAgeReview = new Map();
    const lowAgeCtx = { n: 0 };
    const ButtonBuilder = class { constructor() { return this; } setCustomId(id) { this.id = id; return this; } setLabel(l) { this.label = l; return this; } setStyle(st) { this.style = st; return this; } };
    const ActionRowBuilder = class { constructor() { return this; } addComponents(...cs) { this.components = cs; return this; } };
    const fn = new Function('isAlertEnabled', 'sendAlert', 'EmbedBuilder', 'ActionRowBuilder', 'ButtonBuilder', 'lowAgeReview', 'lowAgeCtx', laCode + '; return lowAgeScamAlert;')(
        (gid, feat) => true, async (gid, emb, row) => { sent.push({ gid, emb, row }); }, EmbedBuilder, ActionRowBuilder, ButtonBuilder, lowAgeReview, lowAgeCtx
    );
    return { fn, sent, embed, lowAgeReview };
}

(async () => {
// 場景 1：lowAgeCount≥1 → 發送警示
{
    const { fn, sent, embed } = buildAlert();
    const ok = await fn({ name: '測試伺服器' }, { tag: '新帳號#1234' }, 'http://evil.xyz/link', 'evil.xyz',
        { lowAgeCount: 1, distinctUsers: 3 }, 'g1');
    check('低齡發送候選連結觸發警示', ok, true);
    check('警示送到警報頻道', sent.length, 1);
    check('標題正確', embed.title, '⚠️ 低齡帳號發送可疑連結');
    check('描述含帳號', embed.description.includes('新帳號#1234'), true);
    check('欄位含域名', embed.fields.some(f => f.name === '域名' && f.value === 'evil.xyz'), true);
    check('欄位含共識', embed.fields.some(f => f.name === '共識' && f.value.includes('3 個使用者')), true);
}

// 場景 1b：審核按鈕（V0.4.3）
{
    const { fn, sent, lowAgeReview } = buildAlert();
    const ok = await fn({ name: '測試' }, { tag: '新帳號#1234' }, 'http://evil.xyz/link', 'evil.xyz',
        { lowAgeCount: 1, distinctUsers: 2 }, 'g1');
    check('產生審核按鈕仍觸發', ok, true);
    check('審核記錄已建立', lowAgeReview.size, 1);
    const rec = lowAgeReview.values().next().value;
    check('審核記錄含域名', rec.host, 'evil.xyz');
    check('審核記錄含伺服器', rec.guildId, 'g1');
    const row = sent[0] && sent[0].row;
    check('送出 ActionRow', row !== undefined, true);
    check('按鈕含確認釣魚', row && row.components && row.components.some(c => c.label === '✅ 確認釣魚' && c.style === 4), true);
    check('按鈕含放行', row && row.components && row.components.some(c => c.label === '❌ 放行' && c.style === 2), true);
}

// 場景 2：lowAgeCount=0（非低齡）→ 不警示
{
    const { fn, sent } = buildAlert();
    const ok = await fn({ name: 'g' }, { tag: 't' }, 'http://x.xyz', 'x.xyz', { lowAgeCount: 0, distinctUsers: 1 }, 'g1');
    check('非低齡不警示', ok, false);
    check('無發送', sent.length, 0);
}

// 場景 3：w 為 null（防呆）→ 不警示
{
    const { fn, sent } = buildAlert();
    const ok = await fn({ name: 'g' }, { tag: 't' }, 'http://x.xyz', 'x.xyz', null, 'g1');
    check('null 防呆不警示', ok, false);
    check('無發送', sent.length, 0);
}

// 場景 4：警報功能停用 → 不警示
{
    const sent = [];
    const embed = { fields: [], setColor() { return this; }, setTitle() { return this; }, setDescription() { return this; }, setTimestamp() { return this; }, addFields() { return this; } };
    const EmbedBuilder = class { constructor() { return embed; } };
    const fn = new Function('isAlertEnabled', 'sendAlert', 'EmbedBuilder', laCode + '; return lowAgeScamAlert;')(
        () => false, async (gid, emb) => { sent.push({ gid, emb }); }, EmbedBuilder
    );
    const ok = await fn({ name: 'g' }, { tag: 't' }, 'http://x.xyz', 'x.xyz', { lowAgeCount: 2, distinctUsers: 2 }, 'g1');
    check('警報停用不警示', ok, false);
    check('無發送', sent.length, 0);
}

// ===== 2) 彙報「曾被駁回再現」標記 =====
const rStart = src.indexOf('async function reportLearning');
const rEnd = src.indexOf('// 每 24 小時執行一次學習回合');
const rCode = src.slice(rStart, rEnd);

function buildReport(bl, guildIds) {
    const sent = [];
    const client = { guilds: { cache: new Map(guildIds.map(g => [g, { id: g }])) } };
    const embed = { fields: [], setColor(c) { this.color = c; return this; }, setTitle(t) { this.title = t; return this; }, setDescription(d) { this.description = d; return this; }, setTimestamp() { return this; }, addFields(...fs) { this.fields.push(...fs); return this; } };
    const EmbedBuilder = class { constructor() { return embed; } };
    const report = new Function('loadBlacklist', 'sendAlert', 'EmbedBuilder', 'client', rCode + '; return reportLearning;')(
        () => bl, async (gid, emb) => { sent.push({ gid, emb }); }, EmbedBuilder, client
    );
    return { report, sent, embed };
}

// 場景 5：曾被駁回再現 → 彙報標記
{
    const now = Date.now();
    const bl = { scamDomainMeta: { 'rejected-again.xyz': { learnedAt: now - 3600000, source: '自主學習', reports: 4, confirmed: true } }, rejectedDomains: { 'rejected-again.xyz': { at: now - 8 * 86400000 } } };
    const { report, sent, embed } = buildReport(bl, ['g1']);
    await report({ learned: 1, removed: 0, forgotten: 0, unconfirmed: 0 });
    check('有變動推送', sent.length, 1);
    const burstField = embed.fields.find(f => f.name.includes('即時封鎖'));
    check('含爆發清單欄位', burstField !== undefined, true);
    check('標記曾被駁回再現', (burstField ? burstField.value : '').includes('・曾被駁回再現'), true);
}

// 場景 6：非駁回域名 → 不標記
{
    const now = Date.now();
    const bl = { scamDomainMeta: { 'normal.xyz': { learnedAt: now - 3600000, source: '自主學習', reports: 3, confirmed: true } }, rejectedDomains: {} };
    const { report, sent, embed } = buildReport(bl, ['g1']);
    await report({ learned: 1, removed: 0, forgotten: 0, unconfirmed: 0 });
    const burstField = embed.fields.find(f => f.name.includes('即時封鎖'));
    check('非駁回域名顯示無標記', (burstField ? burstField.value : '').includes('曾被駁回'), false);
    check('正常顯示域名', (burstField ? burstField.value : '').includes('normal.xyz'), true);
}

console.log(`\n========== ${fail === 0 ? '全部通過' : '有失敗'}（${pass} 通過 / ${fail} 失敗）==========`);
process.exit(fail === 0 ? 0 : 1);
})();
