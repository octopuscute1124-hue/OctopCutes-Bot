// V0.3.2 測試：全域黑名單管理員同意制 / 輸入層消毒 / banUser 提名行為
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'bot.js'), 'utf8');

// discord.js 僅安裝在香橙派，測試以 stub 類別注入
class StubBuilder { constructor() { this._ = {}; } setColor(v) { this._.c = v; return this; } setTitle(v) { this._.t = v; return this; } setDescription(v) { this._.d = v; return this; } addFields(v) { this._.f = v; return this; } setTimestamp() { return this; } setFooter(v) { this._.ft = v; return this; } }
class StubRow { constructor() { this._ = []; } addComponents(...c) { this._ = this._.concat(c); return this; } }
class StubBtn { constructor() { this._ = {}; } setCustomId(v) { this._.id = v; return this; } setLabel(v) { this._.l = v; return this; } setStyle(v) { this._.s = v; return this; } }
const EmbedBuilder = StubBuilder, ActionRowBuilder = StubRow, ButtonBuilder = StubBtn;

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

const gStart = src.indexOf('function canApproveGlobalBan');
const sStart = src.indexOf('function sanitizeContent');
const iStart = src.indexOf('// ============ 間隔檢測');
const bStart = src.indexOf('async function banUser');
const bEnd = src.indexOf('// 累犯計數');
if ([gStart, sStart, iStart, bStart, bEnd].some(x => x === -1)) {
    console.error('❌ 找不到測試目標區塊');
    process.exit(1);
}
const blockG = src.slice(gStart, sStart);
const blockS = src.slice(sStart, iStart);
const blockB = src.slice(bStart, bEnd);

// ===== sanitizeContent：零寬/隱形字元剝離 =====
const sanitizeContent = new Function(blockS + '; return sanitizeContent;')();
check('剝離 ZWSP 插入', sanitizeContent('d\u200Biscord'), 'discord');
check('剝離 ZWJ 插入', sanitizeContent('steam\u200Dgift'), 'steamgift');
check('剝離 BOM/軟連字號/雙向控制', sanitizeContent('a\uFEFFb\u00ADc\u200Ed'), 'abcd');
check('一般文字保留', sanitizeContent('普通文字 123 !章魚'), '普通文字 123 !章魚');
check('空值安全', sanitizeContent(null), '');

// ===== canApproveGlobalBan：管理員 / 白名單 / 普通 =====
const PF = { Administrator: 8 };
const canApprove = new Function('PermissionFlagsBits', 'isWhitelisted', blockG + '; return canApproveGlobalBan;')(PF, () => false);
check('管理員可決定', canApprove({ member: { permissions: { has: (p) => p === 8 } } }), true);
const canApproveWl = new Function('PermissionFlagsBits', 'isWhitelisted', blockG + '; return canApproveGlobalBan;')(PF, () => true);
check('白名單可決定', canApproveWl({ member: {} }), true);
check('普通成員不可', canApprove({ member: {} }), false);
check('無 member 不可', canApprove({}), false);
check('null 不可', canApprove(null), false);

// ===== proposeGlobalBan：24 小時內不重複提名 =====
const tr = new Map();
const fakeNow = 1700000000000;
const FakeDate = class { static now() { return fakeNow; } };
const targetStub = {
    send: async () => ({ createMessageComponentCollector: () => ({ on: () => {}, on: () => {} }) })
};
const memberMock = {
    id: 'u1',
    guild: { id: 'g1', name: '測試伺服器', systemChannel: null, channels: { cache: new Map([['c1', targetStub]]) } },
    user: { tag: '測試者#0001' }
};
const configMock = { alertChannel: { g1: 'c1' } };
const propose = new Function(
    'member', 'channel', 'trackers', 'Date', 'config', 'PermissionFlagsBits',
    'isWhitelisted', 'ActionRowBuilder', 'ButtonBuilder', 'EmbedBuilder',
    'addToBlacklist', 'logAction', 'scanAll',
    blockG + '; return proposeGlobalBan;'
)(memberMock, null, tr, FakeDate, configMock, PF, () => false,
    ActionRowBuilder, ButtonBuilder, EmbedBuilder,
    () => true, () => {}, () => {});
(async () => {
    const r1 = await propose(memberMock, '測試原因', null);
    check('首次提名發送成功', r1, true);
    const r2 = await propose(memberMock, '測試原因', null);
    check('24 小時內不重複提名', r2, false);
    // 逾 24 小時後可再次提名
    tr.get('gb_g1_u1').last = fakeNow - 86400001;
    const r3 = await propose(memberMock, '測試原因', null);
    check('逾 24 小時可再提名', r3, true);

    // ===== banUser：全域提名行為 =====
    const banBlock = new Function(
        'proposeGlobalBan', 'logAction', 'EmbedBuilder',
        blockB + '; return banUser;'
    )(async () => { banCalls++; return true; }, () => {}, EmbedBuilder);
    const m = { id: 'u9', ban: async () => {}, guild: { id: 'g9', name: 'G9' }, user: { tag: 'X#0001' } };
    let banCalls = 0;
    await banBlock(m, 'r', 'lr', null, false);
    check('proposeGlobal=false 不提名', banCalls, 0);
    await banBlock(m, 'r', 'lr', null, true);
    check('proposeGlobal=true 發起提名', banCalls, 1);
    await banBlock(m, 'r', 'lr');
    check('預設發起提名', banCalls, 2);

    console.log(`\n========== ${fail === 0 ? '全部通過' : '有失敗'}（${pass} 通過 / ${fail} 失敗）==========`);
    process.exit(fail === 0 ? 0 : 1);
})();
