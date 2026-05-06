# QR Code Generator Prototype

## System Requirements

Build a dynamic QR code system where:
- Users submit a long URL and get back a short URL token + QR code image
- The QR code encodes a short URL that redirects (302) to the original URL via your server
- Users can modify the target URL after QR code creation
- Users can delete a QR code (soft delete)
- Users can optionally set an expiration timestamp on create or update
- Deleted or expired links return appropriate HTTP status codes
- URL validation: format check, normalization, malicious URL blocking

## Design Questions

Answer these before you start coding:

### 1. Static vs Dynamic QR Code
Why does this system use dynamic QR codes (encode short URL) instead of static (encode original URL directly)? When would you choose static instead?

**My answer:**
> 首先使用編碼的短網址可以先經過我們的 server 再 redirect 到目標 URL，這樣可以方便我們作一些統計數據或是紀錄。再來，如果 user 修改了目標 URL，我們或許可以讓原本的短網址指向新的 URL，讓原先的 QR code 依然有效。不過原始 URL 跟短網址之間的關係尚需討論，要如何做到保持短網址跟長網址的 1 對 1 關係且可以更新對應。如果是幾乎沒有更新需求以及不希望有第三方轉接的情況，或許 static 是比較好的方法。

**Refined answer:**
> Dynamic 的好處：(1) QR 圖簡短易掃（URL 越長 QR 圖越密、越難掃）、(2) 可在 server 端做 analytics、(3) 印出後仍可改目標 URL。代價是引入 SPOF — server 掛了所有 QR 都失效。
>
> Token 跟 URL 的關係不是 1:1，而是「token → 當下 target URL 的單向 mapping」：同一個長網址被縮 N 次會產生 N 個 token（不同 owner 想要分開的 analytics）；同一個 token 可隨時間更新指向不同 URL。
>
> Static 適合：URL 永不變動（名片、菜單）、高可靠性需求（不能依賴第三方 server）、或編的根本不是 URL（wifi、vCard）。

---

### 2. Token Generation
How will you generate short URL tokens? What happens when two different URLs produce the same token? How does collision probability change as the number of tokens grows?

**My answer:**
> 我會選 hash-based + Base62 或是 UUID 作為 token 的選擇。不用 Base64 是因為 URL 不需要 `+` 以及 `/` 作為符號。如果 token 發生了 collision 則 retry 重新生成 token 直到沒有碰撞。如果要降低碰撞發生的機率，可以讓短網址的長度稍微拉長，直到我們的 user 數量碰撞機率低到一定程度。

**Refined answer:**
> 用 `SHA-256(url + nonce)` → Base62 → 截斷到 7 字元（避開 Base64 的 `+/`）。加 nonce 是為了讓同一個 URL 被不同人縮時產生不同 token，分開 analytics；若想做 dedup 則去掉 nonce 純 hash URL。
>
> Collision 透過 DB 的 UNIQUE constraint 偵測（不能靠應用層先查再寫，會有 race condition），最多 retry 10 次。後果若不處理：後寫入的會覆蓋先寫入的，掃 QR 會跑到別人的網址。
>
> 7 字元 Base62 容量 `≈ 3.5×10¹²`，發到百萬量級碰撞率 `≈ 0.00003%`；接近 birthday paradox 門檻（`√(62^7) ≈ 187 萬`）就升到 8 字元（容量 ×62）。Bitly、TinyURL 都這樣分階段擴張。
>
> 替代方案 — counter-based（auto-increment ID → Base62）：不會碰撞、更省 compute，但 token 可被列舉，不適合公開短網址服務。

---

### 3. Redirect Strategy
Why 302 (temporary) instead of 301 (permanent)? What are the trade-offs for analytics, URL modification, and latency?

**My answer:**
> 如果使用 301 永久定向，可能會被長期 cache 住，導致掃描 QR code 後不會經過我們的 server 而是直接往目標 URL，所以我們 server 上就無法作相關的統計或數據分析。且因為少了經過我們這個第三方 server，如果 user 更新的 URL，因為原始的資料被 cache，所以掃描後依舊是前往舊址。不過好處是少了中間轉介，所以 latency 比 302 更低。

**Refined answer:**
> 用 302。301 會被瀏覽器**極度激進**地 cache（Chrome/Firefox 通常 cache 直到瀏覽器重啟，甚至跨 session 持久化），導致：(1) 掃描不打回 server → 沒 analytics、(2) PATCH 改 URL 後使用者還停留在舊網址、(3) soft delete 後使用者還能進得去（更糟糕）。302 預設不 cache，每次都會打 server。
>
> 302 的代價是每次掃描多 ~50-100ms 網路 RTT，但對 QR 場景完全可接受 — 因為「動態可改 + 可算 analytics」就是這系統存在的理由，用 301 等於把核心功能廢掉。
>
> 補充：307/308 是「嚴格保留 method」的版本（POST 不會被改成 GET），但 QR 永遠是 GET，用不到。SEO 場景下 301 才有意義（傳遞 link equity），但短網址服務不在乎。

---

### 4. URL Normalization
What normalization rules do you need? Why is `http://Example.com/` and `https://example.com` potentially the same URL?

**My answer:**
> 我們需要支援 http 以及 https，還有我們 domain 名稱在 DNS 應該為 lowercase。再來，`.com` 以及 `.com/` 為相同，不過之後的路由則大小寫有差別。

**Refined answer:**
> Normalize 的目的是讓「語意上相同的 URL」收斂到同一個字串，避免同一目的地產生多個 token（會浪費 token 空間、分散 analytics）。
>
> **要做的：**
> - **Hostname lowercase**（DNS case-insensitive）
> - **剝掉預設 port**（`:80` for http、`:443` for https）
> - **丟掉 fragment**（`#xxx` 不會送到 server，留著只污染 hash input）
> - **Trim 空白、reject 控制字元、length ≤ 2048**
> - **Root trailing slash 統一**（`x.com` ≡ `x.com/`）
>
> **不做的（動了會破壞語意）：**
> - **Path 大小寫**（`/About` ≠ `/about` 在 Linux server）
> - **Query 參數順序**（有些簽章驗證 API 對順序敏感）
> - **Path 的 trailing slash**（`/foo` vs `/foo/` 在某些 framework 不同）
> - **Tracking 參數**（`utm_*` 是業務決策，行銷可能就是要靠它區分流量）
>
> http→https 自動升級是個決策點：升級簡化邏輯但會破壞 http-only 站。Scaffold 選激進派強制升級，這個 prototype 跟進。

---

### 5. Error Semantics
What should happen when someone scans a deleted link vs a non-existent link? Should the HTTP status codes be different?

**My answer:**
> 如果是 soft delete 應該回已刪除等資訊告訴 user，而如果從未存在過的則是 404，兩者 status code 應該不同。另外，如果是過期的話，應該類似刪除的 status code，但是顯示過期的訊息。嚴格說起來這兩者應該並非錯誤訊息，而是在 body 的 JSON 內回給 client side。

**Refined answer:**
> 三種狀態 → 兩個 code：
> - 從未存在 → **404 Not Found**
> - 已刪除 / 已過期 → **410 Gone**
>
> **為什麼區分 404 vs 410：**
> - 對爬蟲/搜尋引擎，410 是「不要再來」的明確訊號，404 是曖昧的「暫時找不到」
> - 對監控告警有差，404 飆高可能是被掃，410 飆高是業務正常老化
>
> **Redirect endpoint (`/r/{token}`) vs Info endpoint (`/api/qr/{token}`)：**
> - Redirect 是給瀏覽器/相機 app 看的，**必須**靠 status code 表達狀態 — 瀏覽器不會 render JSON body，「200 + JSON 說已刪除」會讓使用者看到一片空白
> - Info endpoint 是給程式讀的，可以選 `200 + body 帶 status: "deleted"` 給更多資訊；簡單一點直接 410 也行
>
> **資安考量：** 區分 404/410 等於洩漏「token 是否曾經存在」。對短網址這個風險很低（token 本來就公開），多數系統選擇區分。但敏感場景（醫療、財務 share link）會選擇全部回 404 以避免 access oracle。
>
> **過期是否算永久（410）的爭議：** 410 嚴格定義是「永久消失」，但 spec 允許 PATCH 延長 `expires_at`，所以過期可能復活。務實派統一回 410（99% 使用者不會續期），嚴謹派過期回 404、刪除回 410。這個 prototype 走務實派。

## Verification

Your prototype should pass all of these:

```bash
# Create a QR code
curl -X POST http://localhost:8000/api/qr/create \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
# → 200, returns {"token": "...", "short_url": "...", "qr_code_url": "...", "original_url": "..."}

# Redirect
curl -o /dev/null -w "%{http_code}" http://localhost:8000/r/{token}
# → 302

# Get info
curl http://localhost:8000/api/qr/{token}
# → 200, returns token metadata

# Update target URL
curl -X PATCH http://localhost:8000/api/qr/{token} \
  -H "Content-Type: application/json" \
  -d '{"url": "https://new-url.com"}'
# → 200

# Redirect now goes to new URL
curl -o /dev/null -w "%{redirect_url}" http://localhost:8000/r/{token}
# → https://new-url.com

# Delete
curl -X DELETE http://localhost:8000/api/qr/{token}
# → 200

# Redirect after delete
curl -o /dev/null -w "%{http_code}" http://localhost:8000/r/{token}
# → 410

# Non-existent token
curl -o /dev/null -w "%{http_code}" http://localhost:8000/r/INVALID
# → 404

# QR code image
# (create a new one first, then)
curl -o /dev/null -w "%{http_code} %{content_type}" http://localhost:8000/api/qr/{token}/image
# → 200 image/png

# Analytics
curl http://localhost:8000/api/qr/{token}/analytics
# → 200, returns {"token": "...", "total_scans": N, "scans_by_day": [...]}
```

## Suggested Tech Stack

Python + FastAPI recommended, but you may use any language/framework.
