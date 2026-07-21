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

Made with :octopus: by octopodiformes
