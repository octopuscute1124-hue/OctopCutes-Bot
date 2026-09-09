// V0.3.0 穩定性/相容性/安全測試：大量加入防護 / 純文字釣魚 / 面板限流清理
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
function grab(pattern, label) {
    const m = src.match(pattern);
    if (!m) { console.error(`❌ 找不到 ${label}`); process.exit(1); }
    return m[0];
}

// ===== trackJoin：大量加入防護 =====
const trackers = new Map();
let fakeNow = 1700000000000;
const FakeDate = class { static now() { return fakeNow; } };
const tJ = new Function('trackers', 'Date',
    grab(/function trackJoin\(gid\) \{[\s\S]*?\r?\n\}/, 'trackJoin') + '; return trackJoin;'
)(trackers, FakeDate);

// g1：觸發測試
tJ('g1'); tJ('g1'); tJ('g1'); tJ('g1');
check('第 5 次加入觸發', tJ('g1'), 5);
check('第 6 次仍觸發', tJ('g1'), 6);
// g2：不觸發測試（獨立伺服器）
tJ('g2'); tJ('g2'); tJ('g2');
check('4 次以下不觸發', tJ('g2'), 0);
// g3：不同伺服器獨立統計
check('不同伺服器獨立統計', tJ('g3'), 0);
// 逾 60 秒重置
fakeNow += 70000;
check('逾 60 秒後重置', tJ('g1'), 0);
// 再次累積
fakeNow += 1000;
tJ('g1'); tJ('g1'); tJ('g1');
check('60 秒內再次累積', tJ('g1'), 5);

// ===== cleanupTrackers：cmd_/join_ 清理 =====
const tr2 = new Map();
const cl = new Function('trackers', 'Date',
    grab(/function cleanupTrackers\(\) \{[\s\S]*?\r?\n\}/, 'cleanupTrackers') + '; return cleanupTrackers;'
)(tr2, FakeDate);

const rateFn = new Function('trackers', 'Date', grab(/function checkCmdRate\(uid\) \{[\s\S]*?\r?\n\}/, 'checkCmdRate') + '; return checkCmdRate;')(tr2, FakeDate);
rateFn('u9');
check('cmd_ 條目存在', tr2.has('cmd_u9'), true);
fakeNow += 20000;
cl();
check('逾 10 秒 cmd_ 被清理', tr2.has('cmd_u9'), false);

const tJ2 = new Function('trackers', 'Date',
    grab(/function trackJoin\(gid\) \{[\s\S]*?\r?\n\}/, 'trackJoin') + '; return trackJoin;'
)(tr2, FakeDate);
tJ2('g9');
check('join_ 條目存在', tr2.has('join_g9'), true);
fakeNow += 70000;
cl();
check('逾 60 秒 join_ 被清理', tr2.has('join_g9'), false);

// ===== detectTextScam：純文字釣魚偵測 =====
const dts = new Function(grab(/function detectTextScam\(content\) \{[\s\S]*?\r?\n\}/, 'detectTextScam') + '; return detectTextScam;')();
check('free nitro 不再誤判（V0.3.4 去敏化）', dts('hey check this free nitro'), null);
check('claim discord nitro', dts('claim discord nitro now') !== null, true);
check('discord gift code 話術', dts('get a discord gift code here') !== null, true);
check('steam gift code 話術', dts('steam gift code giveaway') !== null, true);
check('verify your account 話術', dts('verify your discord account') !== null, true);
check('nitro gift 不再誤判（V0.3.4 去敏化）', dts('nitro gift for you'), null);
check('正常訊息', dts('今天天氣很好'), null);
check('技術討論', dts('how to use nitro emoji in discord'), null);
check('空內容', dts(''), null);
check('非字串', dts(null), null);

// ===== 路徑硬化：資料檔定義為絕對路徑 =====
check('BLACKLIST_FILE 用 __dirname', /const BLACKLIST_FILE = path\.join\(DATA_DIR, 'blacklist\.json'\);/.test(src), true);
check('crash.log 用 __dirname', /appendFileSync\(path\.join\(__dirname, 'crash\.log'\)/.test(src), true);
check('.env 檢查用 __dirname', /statSync\(path\.join\(__dirname, '\.env'\)\)/.test(src), true);

// ===== 斷線偵測：ShardDisconnect 已掛載 =====
check('ShardDisconnect 監聽存在', /client\.on\(Events\.ShardDisconnect,/.test(src), true);

// ===== 記憶體可觀測性 =====
check('記憶體日誌存在', /記憶體:/.test(src), true);

console.log(`\n========== ${fail === 0 ? '全部通過' : '有失敗'}（${pass} 通過 / ${fail} 失敗）==========`);
process.exit(fail === 0 ? 0 : 1);
