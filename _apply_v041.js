// V0.4.1 套用：人工駁回・誤學矯正（防反彈記憶＋再現警示）
const fs = require('fs');
let s = fs.readFileSync('bot.js', 'utf8').replace(/\r\n/g, '\n');
let n = 0;

function rep(tag, oldStr, newStr) {
    if (!s.includes(oldStr)) { console.error(`❌ ${tag} 找不到`); process.exit(1); }
    s = s.replace(oldStr, () => newStr);
    n++;
    console.log(`✅ ${tag}`);
}

// ===== A：scam_remove 升級為「駁回」——記錄 rejectedDomains（人工裁定誤學）=====
rep('A 駁回記錄',
`                    } else {
                        const domain = input.toLowerCase();
                        if (!blNow.scamDomains.includes(domain)) return i.followUp({ content: \`ℹ️ \\\`\${domain}\\\` 不在清單\`, flags: 64 });
                        blNow.scamDomains = blNow.scamDomains.filter(d => d !== domain);
                        delete blNow.scamDomainMeta[domain];
                        saveBlacklist(blNow);
                        logAdmin(i, '刪除詐騙域名', domain);
                        await i.followUp({ content: \`✅ 已刪除：\\\`\${domain}\\\`\`, flags: 64 });
                    }`,
`                    } else {
                        const domain = input.toLowerCase();
                        if (!blNow.scamDomains.includes(domain)) return i.followUp({ content: \`ℹ️ \\\`\${domain}\\\` 不在清單\`, flags: 64 });
                        // V0.4.1：駁回記錄——管理者裁定為誤學，7 天內不再自動提升（防反彈）
                        blNow.rejectedDomains = blNow.rejectedDomains || {};
                        blNow.rejectedDomains[domain] = { at: Date.now(), by: i.user.tag, guildId: gid };
                        if (typeof logAction === 'function') logAction('SCAM_REJECT', { domain, by: i.user.tag, guildId: gid });
                        blNow.scamDomains = blNow.scamDomains.filter(d => d !== domain);
                        delete blNow.scamDomainMeta[domain];
                        saveBlacklist(blNow);
                        logAdmin(i, '駁回詐騙域名（防反彈 7 天）', domain);
                        await i.followUp({ content: \`✅ 已駁回：\\\`\${domain}\\\`（7 天內不再自動提升）\`, flags: 64 });
                    }`);

// ===== B：recordScamCandidate 爆發提升——駁回冷卻中不提升＋過冷卻再現警示 =====
rep('B 爆發提升防反彈',
`    // V0.3.9：爆發式即時提升——多來源共識且 count≥3 立即升級為正式詐騙域名（不等每日學習回合）
    // 釣魚域名在爆發期（短時間多伺服器/多人中招）需要即時封鎖，延遲 24h 會讓更多人受害
    if (st.count >= 3 && (st.sources || []).length >= 2) {
        const blNow = loadBlacklist();
        blNow.scamDomains = blNow.scamDomains || [];
        blNow.scamDomainMeta = blNow.scamDomainMeta || {};
        if (!blNow.scamDomains.includes(host) && !OFFICIAL_DOMAINS.some(o => host === o || host.endsWith('.' + o))) {
            blNow.scamDomains.push(host);
            blNow.scamDomainMeta[host] = { reports: st.count, hits: 0, addedAt: Date.now(), source: '自主學習', learnedAt: Date.now(), sources: st.sources || [], confirmed: true };
            if (typeof logAction === 'function') logAction('SCAM_LEARN', { domain: host, reports: st.count, confirmed: true, immediate: true });
            console.log(\`🧠 自主學習（即時）: \${host} 多來源共識 \${st.count} 次，立即加入詐騙域名\`);
            delete cand[host];
            saveBlacklist(blNow);
            return;
        }
    }`,
`    // V0.3.9：爆發式即時提升——多來源共識且 count≥3 立即升級為正式詐騙域名（不等每日學習回合）
    // 釣魚域名在爆發期（短時間多伺服器/多人中招）需要即時封鎖，延遲 24h 會讓更多人受害
    if (st.count >= 3 && (st.sources || []).length >= 2) {
        const blNow = loadBlacklist();
        blNow.scamDomains = blNow.scamDomains || [];
        blNow.scamDomainMeta = blNow.scamDomainMeta || [];
        // V0.4.1：人工駁回防反彈——管理者駁回的域名 7 天內不自動提升（人工裁定優先於機器學習）
        const rejMap = blNow.rejectedDomains || {};
        if (rejMap[host] && Date.now() - rejMap[host].at < 7 * 86400000) {
            delete cand[host]; // 駁回冷卻中：清掉候選，避免每日回合誤升
            saveBlacklist(blNow);
            return;
        }
        if (!blNow.scamDomains.includes(host) && !OFFICIAL_DOMAINS.some(o => host === o || host.endsWith('.' + o))) {
            // V0.4.1：過冷卻再現警示——曾被駁回的域名再次大量出現，提醒管理者評估（可能是新型態或誤判持續）
            if (rejMap[host] && typeof logAction === 'function') logAction('SCAM_REJECTED_AGAIN', { domain: host, reports: st.count });
            blNow.scamDomains.push(host);
            blNow.scamDomainMeta[host] = { reports: st.count, hits: 0, addedAt: Date.now(), source: '自主學習', learnedAt: Date.now(), sources: st.sources || [], confirmed: true };
            if (typeof logAction === 'function') logAction('SCAM_LEARN', { domain: host, reports: st.count, confirmed: true, immediate: true });
            console.log(\`🧠 自主學習（即時）: \${host} 多來源共識 \${st.count} 次，立即加入詐騙域名\`);
            delete cand[host];
            saveBlacklist(blNow);
            return;
        }
    }`);

// ===== C：learnScamDomains 每日提升——駁回冷卻中跳過＋過冷卻再現警示 =====
rep('C 每日提升防反彈',
`    // 1) 自動提升：來源多樣性門檻——多伺服器共識（sources≥2）命中 ≥3 提升；單一來源需 ≥5（防單一伺服器灌水誤學）
    for (const [host, st] of Object.entries(candidates)) {
        const multiSource = st.sources && st.sources.length >= 2;
        if (((multiSource && st.count >= 3) || (!multiSource && st.count >= 5))
            && !bl.scamDomains.includes(host) && !OFFICIAL_DOMAINS.some(o => host === o || host.endsWith('.' + o))) {
            bl.scamDomains.push(host);
            bl.scamDomainMeta[host] = { reports: st.count, hits: 0, addedAt: now, source: '自主學習', learnedAt: now, sources: st.sources || [], confirmed: !!multiSource };
            logAction('SCAM_LEARN', { domain: host, reports: st.count, confirmed: !!multiSource });
            console.log(\`🧠 自主學習: \${host} 被命中 \${st.count} 次（\${multiSource ? '多伺服器確認' : '單一來源'}），已加入詐騙域名\`);
            learned++;
            delete candidates[host];
            continue;
        }`,
`    // 1) 自動提升：來源多樣性門檻——多伺服器共識（sources≥2）命中 ≥3 提升；單一來源需 ≥5（防單一伺服器灌水誤學）
    for (const [host, st] of Object.entries(candidates)) {
        // V0.4.1：人工駁回防反彈——駁回 7 天內不自動提升（人工裁定優先於機器學習）
        const rejMap2 = bl.rejectedDomains || {};
        if (rejMap2[host] && now - rejMap2[host].at < 7 * 86400000) {
            delete candidates[host]; // 駁回冷卻中：清掉候選，冷卻後重新觀察
            continue;
        }
        const multiSource = st.sources && st.sources.length >= 2;
        if (((multiSource && st.count >= 3) || (!multiSource && st.count >= 5))
            && !bl.scamDomains.includes(host) && !OFFICIAL_DOMAINS.some(o => host === o || host.endsWith('.' + o))) {
            // V0.4.1：過冷卻再現警示——曾被駁回的域名再次達標提升
            if (rejMap2[host] && typeof logAction === 'function') logAction('SCAM_REJECTED_AGAIN', { domain: host, reports: st.count });
            bl.scamDomains.push(host);
            bl.scamDomainMeta[host] = { reports: st.count, hits: 0, addedAt: now, source: '自主學習', learnedAt: now, sources: st.sources || [], confirmed: !!multiSource };
            logAction('SCAM_LEARN', { domain: host, reports: st.count, confirmed: !!multiSource });
            console.log(\`🧠 自主學習: \${host} 被命中 \${st.count} 次（\${multiSource ? '多伺服器確認' : '單一來源'}），已加入詐騙域名\`);
            learned++;
            delete candidates[host];
            continue;
        }`);

fs.writeFileSync('bot.js', s.replace(/\n/g, '\r\n'));
console.log(`✅ V0.4.1 修改完成（${n} 處）`);
