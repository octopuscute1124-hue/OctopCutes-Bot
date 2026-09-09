// V0.3.7 測試：確認制學習（10 分鐘群組共識）・低齡感知・候選記憶衰退
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

// ===== 1) watchLink：時間窗群組共識與低齡感知 =====
const wlStart = src.indexOf('const linkWatch = new Map();');
const wlEnd = src.indexOf('// 域名格式驗證');
if (wlStart === -1 || wlEnd === -1) { console.error('❌ 找不到 watchLink'); process.exit(1); }
let fakeNow = 1700000000000;
const FakeDate = class { static now() { return fakeNow; } };
const wl = new Function('Date', src.slice(wlStart, wlEnd) + '; return watchLink;')(FakeDate);
const w1 = wl('scam.xyz', 'userA', { lowAge: true });
check('首次記錄 hits=1', w1.hits, 1);
check('首次無共識', w1.consensus, false);
const w2 = wl('scam.xyz', 'userA', { lowAge: true });
check('同人重複無共識', w2.consensus, false);
check('同人 distinct=1', w2.distinctUsers, 1);
const w3 = wl('scam.xyz', 'userB', { lowAge: false });
check('2 人共識成立', w3.consensus, true);
check('低齡參與者=1', w3.lowAgeCount, 1);
const w4 = wl('scam.xyz', 'userC', { lowAge: true });
check('3 人共識', w4.consensus, true);
check('低齡參與者=2', w4.lowAgeCount, 2);
// 時間窗：過 11 分鐘，userA/userB/userC 全過期 → 重新計算
fakeNow += 11 * 60 * 1000;
const w5 = wl('scam.xyz', 'userD', { lowAge: false });
check('過期後重新計（distinct=1）', w5.distinctUsers, 1);
check('過期後無共識', w5.consensus, false);
const w6 = wl('scam.xyz', 'userE', { lowAge: true });
check('新窗 2 人共識', w6.consensus, true);

// ===== 2) 記憶衰退（pruneScamCandidates）=====
const pStart = src.indexOf('function pruneScamCandidates');
const pEnd = src.indexOf('function learnScamDomains');
if (pStart === -1 || pEnd === -1) { console.error('❌ 找不到 pruneScamCandidates'); process.exit(1); }
let now = 1700000000000;
const FakeDate2 = class { static now() { return now; } };
const DAY = 24 * 60 * 60 * 1000;
function buildPrune(cand) {
    const actions = [];
    const prune = new Function('Date', 'getScamCandidates', 'loadBlacklist', 'saveBlacklist',
        src.slice(pStart, pEnd) + '; return pruneScamCandidates;')(
        FakeDate2, () => cand, () => ({}), () => actions.push(['save'])
    );
    return { prune, actions, cand };
}
// 場景 1：24h 無命中的候選熱度減半
{
    const { prune, cand } = buildPrune({
        'hot.xyz': { count: 4, firstHit: now - 30 * DAY, lastHit: now - 36 * 3600 * 1000 }, // 36h 無命中 → 4/2=2
        'warm.xyz': { count: 1, firstHit: now - 30 * DAY, lastHit: now - 36 * 3600 * 1000 }, // 減半後最低 1
        'fresh.xyz': { count: 5, firstHit: now - 30 * DAY, lastHit: now - 1000 },   // <24h 不減
        'stale.xyz': { count: 3, firstHit: now - 100 * DAY, lastHit: now - 80 * DAY } // >72h 移除
    });
    const n = prune();
    check('36h 無命中熱度減半', cand['hot.xyz'].count, 2);
    check('減半最低保留 1', cand['warm.xyz'].count, 1);
    check('近期命中不減', cand['fresh.xyz'].count, 5);
    check('超過 72h 移除', cand['stale.xyz'], undefined);
    check('移除數量=1', n, 1);
}
// 場景 2：衰退但未移除會觸發保存
{
    const { prune, actions } = buildPrune({
        'decay.xyz': { count: 6, firstHit: now - 30 * DAY, lastHit: now - 36 * 3600 * 1000 }
    });
    prune();
    check('衰退觸發保存', actions.length, 1);
}

console.log(`\n========== ${fail === 0 ? '全部通過' : '有失敗'}（${pass} 通過 / ${fail} 失敗）==========`);
process.exit(fail === 0 ? 0 : 1);
