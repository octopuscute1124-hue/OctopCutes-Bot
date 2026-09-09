// V0.3.1 高置信度漸進處置測試：跨類型累積 / 警告→禁言→封鎖 / 強訊號 2 次封鎖
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

// 抓取 countStrikes + escalatePunishment 連續區塊
const escStart = src.indexOf('function countStrikes');
const escEnd = src.indexOf('// ============ 間隔檢測 ============');
if (escStart === -1 || escEnd === -1 || escEnd <= escStart) {
    console.error('❌ 找不到漸進處置函式區塊');
    process.exit(1);
}
const block = src.slice(escStart, escEnd);

let fakeNow = 1700000000000;
const FakeDate = class { static now() { return fakeNow; } };

// ===== countStrikes：跨類型累積 =====
const tr1 = new Map();
tr1.set('strike_flood_u1_g1', { count: 1, last: fakeNow });
tr1.set('strike_mention_u1_g1', { count: 2, last: fakeNow });
tr1.set('strike_scam_u1_g1', { count: 3, last: fakeNow });
tr1.set('strike_flood_u2_g1', { count: 5, last: fakeNow }); // 其他使用者不計
const cs = new Function('trackers', 'Date', block + '; return countStrikes;')(tr1, FakeDate);
check('跨類型累積 1+2+3=6', cs('u1', 'g1'), 6);
check('其他使用者獨立', cs('u2', 'g1'), 5);
// 逾 10 分鐘不計
fakeNow += 600001;
check('逾 10 分鐘不計', cs('u1', 'g1'), 0);

// ===== escalatePunishment：一般訊號 警告→禁言→封鎖 =====
fakeNow = 1700000000000;
const tr2 = new Map();
const calls = { ban: 0, warn: 0, timeout: 0, logs: [] };
const member = {
    id: 'u1',
    guild: { id: 'g1', name: '測試伺服器' },
    user: { tag: '測試者#0001' },
    timeout: async (ms, reason) => { calls.timeout++; calls.timeoutMs = ms; calls.timeoutReason = reason; }
};
const esc = new Function(
    'trackers', 'Date', 'addStrike', 'warnUser', 'banUser', 'logAction',
    block + '; return { escalatePunishment, countStrikes };'
)(tr2, FakeDate,
    (uid, gid, kind) => {
        const key = `strike_${kind}_${uid}_${gid}`;
        const now = Date.now();
        if (!tr2.has(key) || now - tr2.get(key).last > 600000) tr2.set(key, { count: 0, last: now });
        const d = tr2.get(key);
        d.count++;
        d.last = now;
        return d.count;
    },
    async (m, ch, reason, tag) => { calls.warn++; calls.warnReason = `${tag} - ${reason}`; return 'warn'; },
    async (m, reason, kind, ch) => { calls.ban++; calls.banReason = reason; return 'ban'; },
    (t, d) => calls.logs.push([t, d])
);

(async () => {
    // 第 1 次（一般訊號）→ 警告
    let r1 = await esc.escalatePunishment(member, null, '洪水', '洪水 - 測試');
    check('第 1 次 → 警告', r1, 'warn');
    check('第 1 次未封鎖', calls.ban, 0);

    // 第 2 次（跨類型：不同規則）→ 禁言 1 小時
    let r2 = await esc.escalatePunishment(member, null, 'mention', 'mention - 測試');
    check('第 2 次（跨類型）→ 禁言', r2, 'timeout');
    check('禁言 1 小時', calls.timeoutMs, 3600000);
    check('禁言仍未封鎖', calls.ban, 0);

    // 第 3 次 → 封鎖
    let r3 = await esc.escalatePunishment(member, null, '腳本', '腳本 - 測試');
    check('第 3 次 → 封鎖', r3, 'ban');
    check('封鎖原因含多次異常', /多次異常 3 次/.test(calls.banReason), true);

    // 強訊號：第 1 次警告、第 2 次封鎖
    const tr3 = new Map();
    const calls2 = { ban: 0, warn: 0 };
    const esc2 = new Function(
        'trackers', 'Date', 'addStrike', 'warnUser', 'banUser', 'logAction',
        block + '; return escalatePunishment;'
    )(tr3, FakeDate,
        (uid, gid, kind) => {
            const key = `strike_${kind}_${uid}_${gid}`;
            const now = Date.now();
            if (!tr3.has(key) || now - tr3.get(key).last > 600000) tr3.set(key, { count: 0, last: now });
            const d = tr3.get(key);
            d.count++;
            d.last = now;
            return d.count;
        },
        async () => { calls2.warn++; return 'warn'; },
        async (m, reason) => { calls2.ban++; calls2.banReason = reason; return 'ban'; },
        () => {}
    );
    let s1 = await esc2(member, null, '詐騙連結', '詐騙連結測試', { strong: true });
    check('強訊號第 1 次 → 警告', s1, 'warn');
    check('強訊號第 1 次未封鎖', calls2.ban, 0);
    let s2 = await esc2(member, null, '詐騙連結', '詐騙連結測試', { strong: true });
    check('強訊號第 2 次 → 封鎖', s2, 'ban');
    check('強訊號封鎖原因含累犯', /累犯 2 次/.test(calls2.banReason || ''), true);

    // 管理員/白名單豁免保留（banUser 未被呼叫的語義檢查由既有測試涵蓋）

    console.log(`\n========== ${fail === 0 ? '全部通過' : '有失敗'}（${pass} 通過 / ${fail} 失敗）==========`);
    process.exit(fail === 0 ? 0 : 1);
})();
