// V0.3.4 更新：行為風險評分演算法（半衰期衰減，取代盲目計數）
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

// 抓取風險評分 + 漸進處置連續區塊（含 RISK_HALF_LIFE 宣告）
const escStart = src.indexOf('function isKnownOffender');
const escEnd = src.indexOf('// ============ 間隔檢測 ============');
if (escStart === -1 || escEnd === -1 || escEnd <= escStart) {
    console.error('❌ 找不到風險評分函式區塊');
    process.exit(1);
}
const block = src.slice(escStart, escEnd);

let fakeNow = 1700000000000;
const FakeDate = class { static now() { return fakeNow; } };

// ===== getRiskScore：時間衰減 =====
const tr1 = new Map();
tr1.set('risk_u1_g1', { score: 100, last: fakeNow });
const rs = new Function('trackers', 'Date', 'logsBuffer', block + '; return { getRiskScore, addRisk };')(tr1, FakeDate, []);
check('未衰減時保持原分', rs.getRiskScore('u1', 'g1'), 100);
fakeNow += 10 * 60 * 1000; // 過一個半衰期
check('過一個半衰期減半', rs.getRiskScore('u1', 'g1'), 50);
fakeNow += 80 * 60 * 1000; // 太久無活動
check('太久無活動歸零', rs.getRiskScore('u1', 'g1'), 0);
check('無紀錄歸零', rs.getRiskScore('u9', 'g1'), 0);

// ===== escalatePunishment：風險分數門檻（洪水權重 2）=====
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
    'trackers', 'Date', 'addStrike', 'addRisk', 'getRiskScore', 'warnUser', 'banUser', 'logAction', 'logsBuffer',
    block + '; return { escalatePunishment, addRisk };'
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
    (uid, gid, kind) => {
        const w = { flood: 2, script: 2, selfbot: 2, mention: 1, dup: 1 }[kind] || 1;
        const score = esc.getRiskScore(uid, gid) + w;
        tr2.set(`risk_${uid}_${gid}`, { score, last: Date.now() });
        return score;
    },
    (uid, gid) => {
        const d = tr2.get(`risk_${uid}_${gid}`);
        if (!d) return 0;
        const elapsed = Date.now() - (d.last || Date.now());
        return d.score * Math.pow(0.5, elapsed / (10 * 60 * 1000));
    },
    async (m, ch, reason, tag) => { calls.warn++; calls.warnReason = `${tag} - ${reason}`; return 'warn'; },
    async (m, reason, kind, ch) => { calls.ban++; calls.banReason = reason; return 'ban'; },
    (t, d) => calls.logs.push([t, d]), []
);

(async () => {
    // 洪水權重 2：1 次 → 2 分警告、2 次 → 4 分仍警告、3 次 → 6 分禁言、5 次 → 10 分封鎖
    let r1 = await esc.escalatePunishment(member, null, 'flood', '洪水 - 測試');
    check('第 1 次（2 分）→ 警告', r1, 'warn');
    check('第 1 次未封鎖', calls.ban, 0);

    let r2 = await esc.escalatePunishment(member, null, 'flood', '洪水 - 測試');
    check('第 2 次（4 分）仍警告——不盲目計數', r2, 'warn');
    check('第 2 次未封鎖', calls.ban, 0);

    let r3 = await esc.escalatePunishment(member, null, 'flood', '洪水 - 測試');
    check('第 3 次（6 分）→ 禁言', r3, 'timeout');
    check('禁言 1 小時', calls.timeoutMs, 3600000);
    check('禁言仍未封鎖', calls.ban, 0);

    await esc.escalatePunishment(member, null, 'flood', '洪水 - 測試'); // 第 4 次（8 分）→ 禁言
    let r5 = await esc.escalatePunishment(member, null, 'flood', '洪水 - 測試'); // 第 5 次（10 分）→ 封鎖
    check('第 5 次（10 分）→ 封鎖', r5, 'ban');
    check('封鎖原因含風險分數', /風險 10\.0 分/.test(calls.banReason || ''), true);

    // 輕訊號（權重 1）多次才升級
    const tr3 = new Map();
    const calls2 = { ban: 0, warn: 0, timeout: 0 };
    const esc2 = new Function(
        'trackers', 'Date', 'addStrike', 'addRisk', 'getRiskScore', 'warnUser', 'banUser', 'logAction', 'logsBuffer',
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
        (uid, gid, kind) => {
            const w = 1;
            const prev = tr3.get(`risk_${uid}_${gid}`);
            const score = (prev ? prev.score : 0) + w;
            tr3.set(`risk_${uid}_${gid}`, { score, last: Date.now() });
            return score;
        },
        (uid, gid) => {
            const d = tr3.get(`risk_${uid}_${gid}`);
            if (!d) return 0;
            return d.score;
        },
        async () => { calls2.warn++; return 'warn'; },
        async (m, reason) => { calls2.ban++; calls2.banReason = reason; return 'ban'; },
        () => {}, []
    );
    let l1 = await esc2(member, null, 'mention', 'mention - 測試');
    check('輕訊號 1 次 → 警告', l1, 'warn');
    let l5 = await esc2(member, null, 'mention', 'mention - 測試');
    await esc2(member, null, 'mention', 'mention - 測試');
    await esc2(member, null, 'mention', 'mention - 測試');
    await esc2(member, null, 'mention', 'mention - 測試');
    check('輕訊號 5 次（5 分）仍警告', l5, 'warn');
    check('輕訊號 5 次未封鎖', calls2.ban, 0);

    // 強訊號：第 1 次警告、第 2 次封鎖
    const tr4 = new Map();
    const calls3 = { ban: 0, warn: 0 };
    const esc3 = new Function(
        'trackers', 'Date', 'addStrike', 'addRisk', 'getRiskScore', 'warnUser', 'banUser', 'logAction', 'logsBuffer',
        block + '; return escalatePunishment;'
    )(tr4, FakeDate,
        (uid, gid, kind) => {
            const key = `strike_${kind}_${uid}_${gid}`;
            const now = Date.now();
            if (!tr4.has(key) || now - tr4.get(key).last > 600000) tr4.set(key, { count: 0, last: now });
            const d = tr4.get(key);
            d.count++;
            d.last = now;
            return d.count;
        },
        () => 0, () => 0,
        async () => { calls3.warn++; return 'warn'; },
        async (m, reason) => { calls3.ban++; calls3.banReason = reason; return 'ban'; },
        () => {}, []
    );
    let s1 = await esc3(member, null, '詐騙連結', '詐騙連結測試', { strong: true });
    check('強訊號第 1 次 → 警告', s1, 'warn');
    check('強訊號第 1 次未封鎖', calls3.ban, 0);
    let s2 = await esc3(member, null, '詐騙連結', '詐騙連結測試', { strong: true });
    check('強訊號第 2 次 → 封鎖', s2, 'ban');
    check('強訊號封鎖原因含累犯', /累犯 2 次/.test(calls3.banReason || ''), true);

    // 衰減後降級：2 分過半衰期剩 1 分，再觸發仍警告
    const tr5 = new Map();
    tr5.set('risk_u1_g1', { score: 2, last: fakeNow });
    const esc4 = new Function(
        'trackers', 'Date', 'addStrike', 'addRisk', 'getRiskScore', 'warnUser', 'banUser', 'logAction', 'logsBuffer',
        block + '; return escalatePunishment;'
    )(tr5, FakeDate,
        () => 1,
        (uid, gid, kind) => {
            const prev = tr5.get(`risk_${uid}_${gid}`);
            const score = (prev ? prev.score : 0) + 1;
            tr5.set(`risk_${uid}_${gid}`, { score, last: Date.now() });
            return score;
        },
        (uid, gid) => {
            const d = tr5.get(`risk_${uid}_${gid}`);
            if (!d) return 0;
            const elapsed = Date.now() - (d.last || Date.now());
            return d.score * Math.pow(0.5, elapsed / (10 * 60 * 1000));
        },
        async () => { calls.warn++; return 'warn'; },
        async () => { calls.ban++; return 'ban'; },
        () => {}, []
    );
    fakeNow += 10 * 60 * 1000; // 過半衰期：2 分 → 1 分
    let d1 = await esc4(member, null, 'mention', '衰減測試');
    check('衰減後觸發仍警告', d1, 'warn');

    console.log(`\n========== ${fail === 0 ? '全部通過' : '有失敗'}（${pass} 通過 / ${fail} 失敗）==========`);
    process.exit(fail === 0 ? 0 : 1);
})();
