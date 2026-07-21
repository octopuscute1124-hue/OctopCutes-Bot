# :octopus: OctopCutes 防傳銷機器人

一個專為 Discord 設計的防傳銷/防騷擾機器人，具備全域黑名單與自動封鎖功能。

---

## :sparkles: 功能特色

- :shield: **頻道保護**：指定頻道一發言即 Ban
- :clipboard: **全域黑名單**：JSON 儲存，跨伺服器同步封鎖
- :octagonal_sign: **止損機制**：1秒內2頻道 @everyone/@here 自動 Ban
- :video_game: **直覺操作**：`!章魚` 叫出控制面板，下拉選單輕鬆設定
- :bar_chart: **黑名單查詢**：一鍵查看所有被封鎖帳號
- :arrows_counterclockwise: **定期掃描**：每30分鐘自動掃描所有伺服器
- :floppy_disk: **設定持久化**：重啟機器人保護設定不消失

---

## :rocket: 快速開始

### 安裝

```CMD
git clone https://github.com/octopuscute1124-hue/OctopCutes-Bot.git
cd OctopCutes-Bot
npm install
```

### 設定

1. 複製 `.env.example` 為 `.env`
2. 填入你的 Discord Token

```env
DISCORD_TOKEN=你的機器人Token
```

### 啟動

```bash
node bot.js
```

---

## :book: 指令說明

| 指令 | 說明 | 權限 |
|------|------|------|
| `!章魚` | 開啟控制面板 | 管理員 |

---

## :file_folder: 檔案說明

| 檔案 | 說明 |
|------|------|
| `bot.js` | 主程式 |
| `blacklist.json` | 黑名單儲存 |
| `config.json` | 保護設定儲存 |
| `.env` | 環境變數 |

---

## :pencil: 更新日誌

### V0.1.0 (2026-07-21)

- :tada: 初始版本釋出
- :shield: 頻道保護功能
- :clipboard: 全域黑名單（JSON 儲存）
- :octagonal_sign: 止損機制（1秒2頻道 @everyone/@here）
- :video_game: `!章魚` 控制面板
- :bar_chart: 黑名單查詢
- :arrows_counterclockwise: 定期掃描（30分鐘）
- :floppy_disk: 設定持久化（config.json）
- :hammer: Ban 人時刪除 7 天訊息
- :globe_with_meridians: 啟動時自動掃描所有伺服器
- :mag: 啟動時掃描受保護頻道

## V0.1.1 - 修復設定檔儲存與日誌問題 (2026-07-21)

### 🐛 修復
- 修復 `config.json` 讀取失敗導致保護頻道無法持久化儲存的問題
- 修復 `monitoredChannels` 使用 `Map` 導致儲存格式錯誤的問題
- 優化設定檔讀寫邏輯，改用純物件儲存，提升穩定性

### ✨ 新增
- 設定保護頻道時自動發送警告訊息
- 新增 `logs.json` 操作日誌紀錄（所有 Ban 行為）
- 統一 `banUser()` 函數，集中管理所有 Ban 邏輯

### 📝 備註
- 本次更新後，`config.json` 格式會自動轉換為新版本
- 舊版設定檔會自動兼容，無需手動遷移

---

## :pray: 銘謝

- **Discord.js** - 提供強大的 Discord API 封裝
- **所有測試者** - 協助找出 bug 並提供反饋
- **開源社群** - 提供各種靈感與支援

機器人頭像來源：網路素材，若有侵權請告知，將立即撤下。

---

## :page_facing_up: 授權

本專案採用 MIT 授權條款 - 詳見 [LICENSE](LICENSE) 檔案

## :lock: 隱私

使用本機器人即表示您同意 [隱私條款](PRIVACY.md) 與 [服務條款](TERMS.md)

---

## :handshake: 貢獻

歡迎提交 Issue 和 Pull Request！

---

## ⚠️ 使用風險自負

> 本機器人為輔助管理工具，**不保證 100% 防呆**。  
> 因操作不當、誤 Ban、設定錯誤或其他任何原因造成的損失，**開發者不承擔任何責任**。  
> 使用本機器人即表示您已同意 [服務條款](TERMS.md) 與 [隱私條款](PRIVACY.md)。

---

Made with :octopus: by octopodiformes
