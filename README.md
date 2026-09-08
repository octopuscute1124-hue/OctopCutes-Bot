# :octopus: OctopCutes 防護機器人

一個專為 Discord 設計的全方位安全防護機器人，具備行為型攻擊偵測、全域黑名單同步、警報系統與可視化控制面板。

> 本版本已修復多項容易誤封（false positive）與稽核缺口的問題，詳見文末[更新日誌](#pencil-更新日誌)。

---

## :sparkles: 功能特色

- :shield: **22 項安全防護**：涵蓋洪水攻擊、腳本/SelfBot、Webhook 濫用、權限變更、XSS 注入、惡意檔案、撞庫攻擊等
- :warning: **累犯制**：內容型偵測（XSS、惡意 Rich Presence）改為「首次警告、再犯才封鎖」，降低誤判造成的永久傷害
- :clipboard: **全域黑名單**：JSON 儲存，跨伺服器同步封鎖，並記錄來源伺服器、原因、時間以利稽核
- :outbox_tray: **伺服器可退出全域黑名單**：不想被其他伺服器的誤判連累，可個別關閉
- :video_game: **直覺操作**：`!章魚` 叫出控制面板，按鈕切換設定，安全開關支援分頁
- :bar_chart: **黑名單查詢**：一鍵查看所有被封鎖帳號
- :arrows_counterclockwise: **定期掃描**：每 30 分鐘自動掃描所有伺服器
- :floppy_disk: **設定持久化**：重啟機器人保護設定不消失
- :page_facing_up: **操作日誌**：所有自動封鎖與管理員操作都會寫入 `logs.json`

---

## :rocket: 快速開始

### 安裝

```bash
git clone https://github.com/octopuscute1124-hue/OctopCutes-Bot.git
cd OctopCutes-Bot
npm install
```

首次啟動會自動建立 `config.json`／`blacklist.json`／`logs.json`（執行期資料，不納入版本控制，可參考同目錄的 `*.example.json` 範本）。

需要 [Node.js](https://nodejs.org/) 18 以上版本，以及 `discord.js` v14。

### 設定

1. 複製 `.env.example` 為 `.env`
2. 填入你的 Discord Bot Token 與開發者（機器人擁有者）ID

```env
DISCORD_TOKEN=你的機器人Token
DEVELOPER_ID=你的Discord使用者ID
```

3. 到 [Discord Developer Portal](https://discord.com/developers/applications) 為機器人開啟以下 **Privileged Gateway Intents**：
   - `SERVER MEMBERS INTENT`
   - `MESSAGE CONTENT INTENT`
   - `PRESENCE INTENT`
4. 邀請機器人加入伺服器時，至少給予 `Ban Members`、`Manage Channels`、`Manage Roles`、`Manage Webhooks`、`Moderate Members`（禁言）等權限。

### 啟動

```bash
node bot.js
```

Windows 使用者也可以直接執行附帶的 `start.bat`（請先修改內部路徑為你自己的專案位置）。

---

## :book: 指令說明

| 指令 | 說明 | 權限 |
|------|------|------|
| `!章魚` | 開啟控制面板 | 管理員，短時間內重複開啟會被冷卻限制（`bruteForce` 開關） |

面板內按鈕：

| 按鈕 | 說明 | 權限 |
|------|------|------|
| 🛡️ 安全設定 | 切換 22 項安全防護（分兩頁） | 管理員 |
| 🔔 警報設定 | 切換 9 項警報通知、設定警報頻道 | 管理員 |
| 🔄 刷新 | 重新整理面板數據 | 管理員 |
| 📋 黑名單 | 查看全域黑名單 | 僅開發者 |
| 👑 白名單 | 管理不受保護的使用者/角色 | 僅開發者 |
| 💬 自動回應 | 設定關鍵字自動回覆 | 僅開發者 |
| 📤 匯出 | 匯出該伺服器目前的設定 JSON | 僅開發者 |

---

## :shield: 安全防護一覽（22 項）

| 開關 | 說明 | 觸發後動作 |
|---|---|---|
| `stopLoss` 止損 | 短時間內在多頻道 @everyone/@here | 立即封鎖 |
| `mentionSpeed` @mention 速度 | 單則訊息 ≥3 個提及且速度異常 | 立即封鎖 |
| `scriptDetection` 腳本 | 發訊速度異常規律（疑似機器人） | 立即封鎖 |
| `voiceAbuse` 語音濫用 | 快速切換語音頻道 | 立即封鎖 |
| `webhookMonitor` Webhook | 短時間內大量建立/發送 Webhook | 自動刪除 Webhook |
| `selfbotDetection` SelfBot | 回應速度過快 | 立即封鎖 |
| `floodProtection` 洪水 | 極短時間大量發送訊息 | 立即封鎖 |
| `floodJoin` 洪水加入 | 短時間大量成員加入 | 發送警報 |
| `permissionSpam` 權限變更 | 頻道權限被異常快速修改 | 發送警報 |
| `maliciousFile` 惡意檔案 | 上傳 `.exe .scr .bat .cmd .com .pif .vbs` | 刪訊息+立即封鎖 |
| `xssProtection` XSS | 訊息含真正的注入樣式（略過程式碼區塊） | 首犯警告，累犯封鎖 |
| `richPresence` RichP | 個人狀態文字含注入樣式 | 首犯警告，累犯封鎖 |
| `crawlerDetection` 爬蟲 | 大量請求行為 | 禁言 60 秒 |
| `collusionAttack` 撞庫 | 短時間內反覆嘗試加入 | 立即封鎖 |
| `suspiciousAccount` 可疑帳號 | 帳號 <7天 或 <30天無頭像 | 僅發送警報（不自動封鎖） |
| `bruteForce` 面板冷卻 | 短時間重複開啟 `!章魚` 面板 | 暫時限制使用 |
| `rateLimit` RateLimit | 控制面板操作過於頻繁 | 暫時拒絕操作 |
| `autoDegrade` 自動降級 | 系統負載過高或行為異常 | 暫時進入保護模式 |
| `inviteMonitor` 邀請濫用 | 短時間內大量建立邀請連結 | 立即封鎖 |
| `roleLock` 角色鎖定 | 非管理員角色被賦予管理員權限 | 自動復原權限+發送警報 |
| `channelSpam` 頻道監控 | 大量建立/刪除頻道 | 發送警報 |
| `honorGlobalBlacklist`* 全域黑名單套用 | 是否套用其他伺服器造成的封鎖 | 關閉後該伺服器只保留自己觸發的封鎖 |

\* 因 Discord 單則訊息最多 5 列元件、面板按鈕已滿，此項目目前只能透過直接編輯 `config.json` 的
`securitySettings.<伺服器ID>.honorGlobalBlacklist` 設為 `false` 來關閉，尚未加入面板按鈕。

以上除 `honorGlobalBlacklist` 外皆可在「🛡️ 安全設定」面板中即時切換（分三頁顯示）。

---

## :file_folder: 檔案說明

| 檔案 | 說明 |
|------|------|
| `bot.js` | 主程式 |
| `blacklist.json` | 全域黑名單（**執行期自動產生**，不納入版本控制，可參考 `blacklist.example.json`） |
| `config.json` | 各伺服器設定（**執行期自動產生**，不納入版本控制，可參考 `config.example.json`） |
| `logs.json` | 操作日誌（**執行期自動產生**，不納入版本控制，保留最近30天） |
| `crash.log` | 當機／未處理錯誤紀錄（V0.2.3 新增，供追查異常重啟原因） |
| `config.example.json` | 設定檔範本（V0.2.4 新增） |
| `blacklist.example.json` | 黑名單範本（V0.2.4 新增） |
| `.env` | 環境變數（Token、開發者ID），**請勿上傳到公開倉庫** |
| `PRIVACY.md` | 隱私條款 |
| `start.bat` | Windows 一鍵啟動腳本 |

---

## :bar_chart: 資料生命週期

- 黑名單：只要伺服器把 `honorGlobalBlacklist` 設為 `false`，就不會被其他伺服器造成的封鎖影響。
- 日誌：`logs.json` 會自動清除 30 天前的紀錄，且上限 5000 筆。
- 設定：儲存於 `config.json`，重啟機器人不會遺失（與黑名單一樣落地為檔案，非純記憶體）。

---

## :pencil: 更新日誌

### V0.2.6（2026-09-09）— 極致防護（防駭客強化）

#### 🕵️ Token 與憑證防護
- Token 遮罩：任何控制台輸出、crash.log 中出現的 DISCORD_TOKEN 一律替換為遮罩，bot token 不會再因錯誤訊息外洩
- 單實例鎖：防止誤啟動第二個實例同時操作設定檔/黑名單造成衝突，重複啟動直接拒絕
- .env 權限檢查（Unix）：group/other 可讀時啟動即警告，提醒 chmod 600

#### 🤖 假冒機器人偵測
- 定期（啟動後 60 秒、每 6 小時、新伺服器加入時）掃描各伺服器，發現名稱含 OctopCutes 的其他機器人即記錄警報

#### 🌐 自訂詐騙域名
- 管理員可用『!章魚 加詐騙域名 <網域>』／『!章魚 刪詐騙域名 <網域>』擴充詐騙黑名單，與內建清單合併判定（格式自動驗證）

#### ⚡ 記憶體感知自動調節
- 每分鐘監測 RSS：超過 180MB 自動把掃描間隔從 30 分鐘縮短到 10 分鐘並強制清理追蹤器；超過 260MB 縮短到 6 分鐘；恢復正常自動回復

#### 📢 @everyone/@here 濫用防護（新增安全開關：mentionSpam）
- 60 秒內 ≥3 次 @everyone/@here 觸發：刪訊息＋禁言警告（管理員/白名單豁免，不直接封鎖）

#### ⚡ 加入即封鎖
- 新成員加入時立即檢查全域黑名單，命中直接封鎖，不必等 30 分鐘定時掃描

#### 🧪 測試
- 新增 tests/v026Security.test.js（token 遮罩、@everyone 追蹤與清理、自訂詐騙域名 18 項），連同既有測試全部通過

---

### V0.2.5（2026-09-09）— 安全強化與防駭客功能（力大磚飛）

#### 🎣 詐騙連結攔截（新增安全開關：scamLink）
- 內建常見詐騙／釣魚域名黑名單（discord-nitro、discordgift、steamgift、netflix-gift 等 26 組），命中即刪訊息＋警告，10 分鐘內累犯第 2 次自動封鎖
- 偽官方域名偵測：域名含 discord／steam／nitro 關鍵字但非官方域名（如 discord.com.evil.com）一律視為可疑
- IP 直連連結偵測（http://123.45.67.89/... 通常是惡意）
- 官方域名白名單（discord、GitHub、YouTube 等 50+ 組，含子域）確保不會誤封正常分享

#### 🔁 重複內容偵測（新增安全開關：duplicateSpam）
- 同一使用者 30 秒內發送 ≥5 條內容相同（前 100 字元）的訊息即觸發，警告後累犯封鎖，專打刷屏機器人

#### 🎭 假冒名稱偵測（新增安全開關：impersonation）
- 新成員名稱含 discord／steam／nitro ＋ 贈禮／官方關鍵字組合（如「discord nitro gift」）時發出警報

#### 🛑 緊急停機（僅開發者）
- 開發者輸入 !章魚 停止 可遠端關閉機器人（先寫出未落盤日誌再退出），機器人失控時可立即止血

#### 🛡️ 自我防護
- 設定檔損壞自動備份：config.json／blacklist.json／logs.json 若被竄改或手動誤改導致 JSON 損壞，自動備份為 .corrupt-<時間戳> 再以預設值重啟，不讓壞檔弄掛機器人
- blacklist.json 結構保險：即使 JSON 合法但結構不完整也不會崩潰
- 啟動前驗證 .env：缺少或長度異常的 DISCORD_TOKEN 直接明確報錯退出，不再無限重試
- 偵測機器人被移出伺服器（GuildDelete）並記錄；加入新伺服器（GuildCreate）時自動建立預設設定並立即套用全域黑名單

#### 🔒 操作安全
- 面板輸入互斥鎖：同一使用者同時只能有一個「等待輸入」流程，防止重複點擊按鈕導致多個 awaitMessages 疊加干擾
- 自動回應防注入：設定回應時禁止 @everyone／@here，回應長度上限 1900 字元

#### 🧪 測試
- 新增 tests/scamLink.test.js（URL 提取、詐騙／偽官方／IP 直連判定、假冒名稱 27 項）與 tests/duplicateSpam.test.js（重複觸發、窗口重置、cleanup 清理 9 項），連同既有測試全部通過

---

### V0.2.4（2026-09-08）

#### ⚡ 效能與穩定性優化
- 日誌改為「記憶體緩衝 + 防抖寫入」：不再每次動作都同步讀寫整份 `logs.json`，大幅減少 SD 卡寫入次數與事件迴圈阻塞；`SIGTERM`／`SIGINT`／例外發生時會強制寫出未落盤資料
- 黑名單改用記憶體快取，避免每次操作重複讀檔
- `scanAll` 加上重入鎖，防止 30 分鐘定時掃描與啟動掃描重疊
- 監聽 discord.js 的 `error`／`warn` 事件（未監聽的 `error` 事件會直接讓 Node 崩潰）
- RateLimit 豁免導覽按鈕（返回／刷新／翻頁），管理員翻頁不會被誤鎖
- 新增 `tests/scheduleSave.test.js`，與既有測試皆通過（含 2 萬條壓力測試）

#### 🔒 隱私與倉庫整理
- `config.json`／`blacklist.json`／`logs.json` 移出版本控制（執行期自動產生，避免公開倉庫洩漏伺服器 ID 與封鎖紀錄），新增 `*.example.json` 範本
- `package.json` 補上名稱、版本、`start`／`test` 腳本與 Node 版本要求

---

### V0.2.3（2026-09-08）

#### 🐛 修復記憶體洩漏（長時間運作記憶體持續增長）
- 追蹤器（trackers）原本只清理「間隔型」條目，`addStrike`（累犯）、`checkBruteForce`（面板冷卻）、`trackBehavior`（行為追蹤）、`checkRateLimit` 產生的條目會永久殘留，導致記憶體無限增長
- `cleanupTrackers` 現在會依各類型過期語義逐型清理，並以 2 萬條壓力測試驗證可全數清除

#### 🛡️ 防止隨機崩潰
- 新增全域錯誤處理（`unhandledRejection`／`uncaughtException`），不再因為單一 Promise 拒絕就靜默退出，並將錯誤寫入 `crash.log` 供追查
- 登入失敗改為 30 秒後自動重試，不再直接退出
- 修正 `!章魚` 指令與按鈕互動在特殊情境（無 member 物件）下可能拋例外導致崩潰的問題

#### 🔧 修正失效功能
- 修正 `autoDegrade`（自動降級）形同虛設的問題：錯誤計數與請求計數原本從未累加，系統永遠不會進入保護模式，現在會正確統計

#### ✨ 其他
- 修正 `ban()` 使用已棄用的 `deleteMessageDays` 參數（改為 `deleteMessageSeconds`）
- 補上倉庫遺漏的 `package.json`（新 clone 才能 `npm install`）與 `.gitignore`
- 清除設定檔中已移除的舊開關 `commandWhitelist` 殘留

---

### V0.2.2（2026-07-29）

#### 🐛 修復誤判/誤封問題
- XSS 偵測移除常見程式關鍵字誤判，只認真正注入樣式，並略過程式碼區塊
- 惡意檔案偵測移除 `.js` / `.jar`，避免誤封開發者/Minecraft社群正常分享
- 移除「新帳號 <3天 直接永久封鎖」規則，改為僅警報
- 惡意 Rich Presence 偵測比照 XSS 收斂樣式

#### 🛡️ 新增緩衝機制
- XSS、惡意 Rich Presence 由「一次觸發即永久封鎖」改為「10分鐘內累犯第2次才封鎖」，首犯僅刪訊息+禁言10分鐘+警告

#### 📋 補齊稽核缺口
- 撞庫攻擊、邀請濫用封鎖原本未寫入 `logs.json`，已修正統一透過 `banUser()` 記錄
- 黑名單新增來源伺服器、原因、時間戳中繼資料

#### 🔧 修正既有 Bug
- 修正安全設定面板因 Discord 5 列元件上限，導致最後兩項（角色鎖定、頻道監控）永遠無法透過按鈕切換的問題，改為分頁顯示
- 移除完全沒有作用（未被程式碼讀取）的「指令白名單」開關
- 修正 `rateLimit` / `autoDegrade` 開關無論開關狀態都強制執行、形同虛設的問題
- 啟用原本定義但從未被呼叫的暴力破解防護函式（重新命名為「面板冷卻」）

#### ✨ 新增
- 伺服器層級開關 `honorGlobalBlacklist`，可選擇不套用其他伺服器造成的黑名單封鎖

---

### V0.2.1（2026-07-22）
- 修復 `cleanupTrackers` 間歇性崩潰問題
- 加入防呆檢查，避免追蹤器資料為空時噴錯

### V0.2.0（2026-07-22）— 重大更新：完全重構為純防護系統
- 移除頻道保護功能，轉型為全方位自動安全防護系統
- 新增 22 項安全防護、9 項警報系統
- 新增控制面板：安全/警報獨立開關、黑白名單管理（僅開發者）、自動回應、設定匯出
- 新增 `blacklist.json`、`config.json`、`logs.json` 三份資料儲存

### V0.1.2（2026-07-21）
- 開發者專屬管理功能（黑白名單僅開發者可修改）
- 管理員操作日誌
- 白名單功能（使用者/角色不受保護）
- 防呆機制：Ban 權限檢查、管理員跳過、白名單跳過、機器人跳過、ID 格式驗證、操作超時取消

### V0.1.1（2026-07-21）
- 修復 `config.json` 讀取失敗導致保護設定無法持久化的問題
- 新增 `logs.json` 操作日誌
- 統一 `banUser()` 函數集中管理所有 Ban 邏輯

### V0.1.0（2026-07-21）— 初始版本
- 頻道保護、全域黑名單、止損機制、`!章魚` 控制面板、定期掃描、設定持久化

---

## :pray: 銘謝

- **Discord.js** — 提供強大的 Discord API 封裝
- **所有測試者** — 協助找出 bug 並提供反饋
- **開源社群** — 提供各種靈感與支援

機器人頭像來源：網路素材，若有侵權請告知，將立即撤下。

---

## :page_facing_up: 授權

本專案採用 MIT 授權條款 — 詳見 [LICENSE](LICENSE) 檔案

## :lock: 隱私

使用本機器人即表示您同意 [隱私條款](PRIVACY.md)

---

## :warning: 使用風險自負

> 本機器人為輔助管理工具，**不保證 100% 防呆**。
> 因操作不當、誤 Ban、設定錯誤或其他任何原因造成的損失，**開發者不承擔任何責任**。
> 建議正式上線前先在測試伺服器確認各項偵測規則的敏感度是否符合你的社群需求。

---

## :handshake: 貢獻

歡迎提交 Issue 和 Pull Request！

---

Made with :octopus: by octopodiformes