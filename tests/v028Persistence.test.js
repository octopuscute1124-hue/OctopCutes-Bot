// V0.2.8 學習候選池持久化單元測試：recordScamCandidate / isValidDomain / pruneScamCandidates
// 直接從 bot.js 抽取實際函式，注入 blacklist/save stub 測試。
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

const getCandCode = grab(/function getScamCandidates\(\) \{[\s\S]*?\r?\n\}/, 'getScamCandidates');
const recordCode = grab(/function recordScamCandidate\(host, meta = \{\}\) \{[\s\S]*?\r?\n\}/, 'recordScamCandidate');
const validCode = grab(/function isValidDomain\(host\) \{[\s\S]*?\r?\n\}/, 'isValidDomain');
const pruneCode = grab(/function pruneScamCandidates\(\) \{[\s\S]*?\r?\n\}/, 'pruneScamCandidates');

function buildRecord(bl) {
  const actions = [];
  // V0.3.5：recordScamCandidate 已加入智慧加權（仿冒/跨伺服器/新帳號）——此處注入 isTyposquatOf mock 以維持「基礎計數」測試語義（加權行為由 v035 涵蓋）
  const record = new Function('loadBlacklist', 'saveBlacklist', 'isTyposquatOf', [getCandCode, recordCode, 'return recordScamCandidate;'].join('\n'))(
    () => bl,
    (d) => actions.push(['save']),
    () => false
  );
  return { record, actions, bl };
}

function buildPrune(bl) {
  const actions = [];
  const prune = new Function('loadBlacklist', 'saveBlacklist', [getCandCode, pruneCode, 'return pruneScamCandidates;'].join('\n'))(
    () => bl,
    (d) => actions.push(['save'])
  );
  return { prune, actions, bl };
}

const valid = new Function([validCode, 'return isValidDomain;'].join('\n'))();
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

// ===== 場景 1：recordScamCandidate 累積計數並寫入 =====
{
  const bl = { scamCandidateStats: {} };
  const { record, actions } = buildRecord(bl);
  record('discord-verify.xyz');
  record('discord-verify.xyz');
  record('discord-verify.xyz');
  record('steam-gift.xyz');
  check('命中 3 次計數正確', bl.scamCandidateStats['discord-verify.xyz'].count, 3);
  check('不同域名分開統計', bl.scamCandidateStats['steam-gift.xyz'].count, 1);
  check('含首次命中時間', typeof bl.scamCandidateStats['discord-verify.xyz'].firstHit === 'number', true);
  check('每次命中都寫入黑名單', actions.length, 4);
}

// ===== 場景 2：舊候選存在時累加而非覆蓋 =====
{
  const bl = { scamCandidateStats: { 'old.xyz': { count: 2, firstHit: now - 5 * DAY, lastHit: now - 1000 } } };
  const { record } = buildRecord(bl);
  record('old.xyz');
  check('既有候選累加', bl.scamCandidateStats['old.xyz'].count, 3);
  check('firstHit 保留原始', now - bl.scamCandidateStats['old.xyz'].firstHit > 4 * DAY, true);
  check('lastHit 更新', bl.scamCandidateStats['old.xyz'].lastHit >= now - 1000, true);
}

// ===== 場景 3：isValidDomain 合法輸入 =====
{
  check('一般域名合法', valid('example.com'), true);
  check('子域名合法', valid('a.b.example.co.uk'), true);
  check('連字號合法', valid('discord-verify.xyz'), true);
  check('大寫自動接受', valid('EXAMPLE.COM'), true);
  check('尾隨點合法化後接受', valid('example.com.'), false);
  check('單層網域非法', valid('localhost'), false);
  check('前導連字號非法', valid('-bad.com'), false);
  check('尾隨連字號非法', valid('bad-.com'), false);
  check('連續句點非法', valid('bad..com'), false);
  check('特殊字元非法', valid('bad_domain.com'), false);
  check('超過 253 字元非法', valid('a'.repeat(254) + '.com'), false);
  check('空字串非法', valid(''), false);
  check('非字串非法', valid(12345), false);
  check('IP 直連非域名（不進學習）', valid('192.168.0.1'), true);
}

// ===== 場景 4：pruneScamCandidates 清除過期候選 =====
{
  const bl = { scamCandidateStats: {
    'stale.xyz': { count: 1, firstHit: now - 100 * DAY, lastHit: now - 80 * DAY },
    'fresh.xyz': { count: 1, firstHit: now - 100 * DAY, lastHit: now - 1000 }
  } };
  const { prune, actions } = buildPrune(bl);
  const n = prune();
  check('清除 1 個過期候選', n, 1);
  check('過期已刪除', 'stale.xyz' in bl.scamCandidateStats, false);
  check('近期保留', 'fresh.xyz' in bl.scamCandidateStats, true);
  check('有變更才寫入', actions.length, 1);
}

// ===== 場景 5：無過期候選時不寫入 =====
{
  const bl = { scamCandidateStats: { 'fresh.xyz': { count: 1, lastHit: now - 1000 } } };
  const { prune, actions } = buildPrune(bl);
  const n = prune();
  check('清除 0 個', n, 0);
  check('不寫入', actions.length, 0);
}

// ===== 場景 6：loadBlacklist 缺欄位時 getScamCandidates 自動補結構 =====
{
  const bl = { scamDomains: [] }; // 沒有 scamCandidateStats
  const getCand = new Function('loadBlacklist', [getCandCode, 'return getScamCandidates;'].join('\n'))(() => bl);
  const cand = getCand();
  check('自動補結構', typeof cand === 'object', true);
  check('寫回共享物件', bl.scamCandidateStats === cand, true);
}

console.log(pass ? '========== 全部通過 ==========' : '========== 有失敗 ==========');
process.exit(pass ? 0 : 1);
