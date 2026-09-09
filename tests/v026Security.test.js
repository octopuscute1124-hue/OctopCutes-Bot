// V0.2.6 極致防護單元測試：maskToken / trackMention / 自訂詐騙域名 / mention_ 清理
// 直接從 bot.js 抽取實際函式測試。
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'bot.js'), 'utf8');

function grab(pattern, label) {
  const m = src.match(pattern);
  if (!m) { console.error(`❌ 找不到 ${label}`); process.exit(1); }
  return m[0];
}

let pass = true;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) console.log(`❌ ${label}: 期望 ${JSON.stringify(expected)}，實際 ${JSON.stringify(actual)}`);
  else console.log(`✅ ${label}`);
  if (!ok) pass = false;
}

// ===== maskToken =====
const origToken = process.env.DISCORD_TOKEN;
process.env.DISCORD_TOKEN = 'fake-token-abcdef1234567890';
const maskCode = grab(/function maskToken\(text\) \{[\s\S]*?\r?\n\}/, 'maskToken');
const maskToken = new Function(maskCode + '; return maskToken;')();
check('maskToken 遮罩 token', maskToken('錯誤: fake-token-abcdef1234567890 發生'), '錯誤: tk***(27字元) 發生');
check('maskToken 無 token 原樣', maskToken('一般訊息'), '一般訊息');
check('maskToken 空值', maskToken(null), null);
check('maskToken 非字串', maskToken(123), '123');
check('maskToken 多次出現全遮', maskToken('a fake-token-abcdef1234567890 b fake-token-abcdef1234567890'), 'a tk***(27字元) b tk***(27字元)');
process.env.DISCORD_TOKEN = origToken;

// ===== trackMention =====
let fakeNow = 1700000000000;
class FakeDate { static now() { return fakeNow; } }
const trackers = new Map();
const tM = new Function('trackers', 'Date', grab(/function trackMention\(userId\) \{[\s\S]*?\r?\n\}/, 'trackMention') + '; return trackMention;')(trackers, FakeDate);
const cl = new Function('trackers', 'Date', grab(/function cleanupTrackers\(\) \{[\s\S]*?\r?\n\}/, 'cleanupTrackers') + '; return cleanupTrackers;')(trackers, FakeDate);

fakeNow += 1000;
check('1 次 @everyone 不觸發', tM('u1'), false);
check('2 次 @everyone 不觸發', tM('u1'), false);
const r3 = tM('u1');
check('3 次 @everyone 觸發', r3 !== false && r3.triggered === true, true);
check('觸發次數 3', r3.count, 3);
check('mention_ 條目存在', trackers.has('mention_u1'), true);

// 逾 60 秒重置
fakeNow += 70000;
check('逾 60 秒後重置（1 次）', tM('u1'), false);

// cleanupTrackers 清理過期 mention_
trackers.clear();
fakeNow += 1000;
tM('u2'); tM('u2'); tM('u2');
fakeNow += 70000;
cl();
check('逾 60 秒 mention_ 被清理', trackers.has('mention_u2'), false);

// 近期活動保留
trackers.clear();
fakeNow += 1000;
tM('u3');
fakeNow += 10000;
cl();
check('近期 mention_ 保留', trackers.has('mention_u3'), true);

// ===== getScamReason 自訂詐騙域名（注入 loadBlacklist stub） =====
const code = [
  grab(/const SCAM_DOMAINS = \[[\s\S]*?\];/, 'SCAM_DOMAINS'),
  grab(/const OFFICIAL_DOMAINS = \[[\s\S]*?\];/, 'OFFICIAL_DOMAINS'),
  grab(/const SHORTENER_DOMAINS = \[[\s\S]*?\];/, 'SHORTENER_DOMAINS'),
  grab(/function getScamReason\(url\) \{[\s\S]*?\r?\n\}/, 'getScamReason'),
  grab(/function isShortener\(host\) \{[\s\S]*?\r?\n\}/, 'isShortener'),
  'return getScamReason;'
].join('\n');
const getScamReason = new Function('loadBlacklist', code)(() => ({ scamDomains: ['evil-test.com', 'phish.example'] }));
check('自訂域名命中', getScamReason('https://evil-test.com/click') !== null, true);
check('自訂域名子域命中', getScamReason('https://sub.phish.example/x') !== null, true);
check('官方域名仍放行（自訂不影響）', getScamReason('https://discord.com/app'), null);
check('正常網域不受影響', getScamReason('https://example.com/page'), null);
check('內建詐騙域名仍命中', getScamReason('https://discord-nitro.com/free') !== null, true);
// 無 loadBlacklist 環境（如部分測試）不崩潰
const getScamReasonNoBL = new Function(code)();
check('無 loadBlacklist 不崩潰', getScamReasonNoBL('https://evil-test.com/x') !== null, false);

console.log(pass ? '========== 全部通過 ==========' : '========== 有失敗 ==========');
process.exit(pass ? 0 : 1);
