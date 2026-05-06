const RECENT_KEY = "qr-generator-recent";
const MAX_RECENT = 6;

const state = {
  token: "",
  shortUrl: "",
  clearUpdateExpiry: false,
};

const els = {
  createForm: document.querySelector("#create-form"),
  createUrl: document.querySelector("#create-url"),
  createExpiry: document.querySelector("#create-expiry"),
  clearCreateExpiry: document.querySelector("#clear-create-expiry"),
  emptyState: document.querySelector("#empty-state"),
  resultCard: document.querySelector("#result-card"),
  qrImage: document.querySelector("#qr-image"),
  statusPill: document.querySelector("#status-pill"),
  tokenTitle: document.querySelector("#token-title"),
  shortUrl: document.querySelector("#short-url"),
  originalUrl: document.querySelector("#original-url"),
  copyUrlButton: document.querySelector("#copy-url-button"),
  copyTokenButton: document.querySelector("#copy-token-button"),
  downloadButton: document.querySelector("#download-button"),
  tokenInput: document.querySelector("#token-input"),
  loadButton: document.querySelector("#load-button"),
  analyticsButton: document.querySelector("#analytics-button"),
  deleteButton: document.querySelector("#delete-button"),
  updateForm: document.querySelector("#update-form"),
  updateUrl: document.querySelector("#update-url"),
  updateExpiry: document.querySelector("#update-expiry"),
  clearUpdateExpiry: document.querySelector("#clear-update-expiry"),
  message: document.querySelector("#message"),
  details: document.querySelector("#details"),
  createdAt: document.querySelector("#created-at"),
  updatedAt: document.querySelector("#updated-at"),
  expiresAt: document.querySelector("#expires-at"),
  analytics: document.querySelector("#analytics"),
  totalScans: document.querySelector("#total-scans"),
  scanDays: document.querySelector("#scan-days"),
  recentList: document.querySelector("#recent-list"),
  clearRecentButton: document.querySelector("#clear-recent-button"),
};

renderRecent();

els.createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await withBusy(event.submitter, async () => {
    const payload = { url: els.createUrl.value.trim() };
    const expiry = toIsoDatetime(els.createExpiry.value);
    if (expiry) payload.expires_at = expiry;

    const created = await api("/api/qr/create", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const info = await api(`/api/qr/${encodeURIComponent(created.token)}`);

    showResult({
      token: created.token,
      original_url: created.original_url,
      short_url: created.short_url,
      qr_code_url: created.qr_code_url,
    });
    setUpdateFields(info);
    renderDetails(info);
    addRecent(created.token, created.original_url);
    showMessage("QR code created.", "success");
  });
});

els.loadButton.addEventListener("click", async () => {
  await withBusy(els.loadButton, async () => {
    await loadToken(readToken());
    showMessage("Token loaded.", "success");
  });
});

els.tokenInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    els.loadButton.click();
  }
});

els.updateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await withBusy(event.submitter, async () => {
    const token = readToken();
    const payload = {};
    if (els.updateUrl.value.trim()) payload.url = els.updateUrl.value.trim();
    if (state.clearUpdateExpiry) {
      payload.expires_at = null;
    } else if (els.updateExpiry.value) {
      payload.expires_at = toIsoDatetime(els.updateExpiry.value);
    }

    if (!Object.keys(payload).length) {
      showMessage("Enter a new URL or expiration before updating.", "error");
      return;
    }

    const info = await api(`/api/qr/${encodeURIComponent(token)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });

    state.clearUpdateExpiry = false;
    showResult({ token, original_url: info.original_url });
    setUpdateFields(info);
    renderDetails(info);
    addRecent(token, info.original_url);
    showMessage("QR code updated.", "success");
  });
});

els.deleteButton.addEventListener("click", async () => {
  await withBusy(els.deleteButton, async () => {
    const token = readToken();
    if (!window.confirm(`Delete token ${token}?`)) return;

    await api(`/api/qr/${encodeURIComponent(token)}`, { method: "DELETE" });
    removeRecent(token);
    els.statusPill.textContent = "Deleted";
    els.statusPill.classList.add("deleted");
    els.analytics.classList.add("hidden");
    showMessage("QR code deleted.", "success");
  });
});

els.analyticsButton.addEventListener("click", async () => {
  await withBusy(els.analyticsButton, async () => {
    const token = readToken();
    const analytics = await api(`/api/qr/${encodeURIComponent(token)}/analytics`);
    renderAnalytics(analytics);
    showMessage("Analytics refreshed.", "success");
  });
});

els.copyUrlButton.addEventListener("click", async () => {
  await copyText(state.shortUrl, "Short URL copied.");
});

els.copyTokenButton.addEventListener("click", async () => {
  await copyText(state.token, "Token copied.");
});

els.downloadButton.addEventListener("click", async () => {
  await withBusy(els.downloadButton, async () => {
    const token = readToken();
    const response = await fetch(`/api/qr/${encodeURIComponent(token)}/image`);
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `qr-${token}.png`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showMessage("QR image downloaded.", "success");
  });
});

els.clearCreateExpiry.addEventListener("click", () => {
  els.createExpiry.value = "";
});

els.clearUpdateExpiry.addEventListener("click", () => {
  els.updateExpiry.value = "";
  state.clearUpdateExpiry = true;
  showMessage("Next update will remove the expiration.", "success");
});

els.clearRecentButton.addEventListener("click", () => {
  localStorage.removeItem(RECENT_KEY);
  renderRecent();
});

async function loadToken(token) {
  const info = await api(`/api/qr/${encodeURIComponent(token)}`);
  showResult({ token, original_url: info.original_url });
  setUpdateFields(info);
  renderDetails(info);
  addRecent(token, info.original_url);
}

function showResult(data) {
  const token = data.token;
  const shortUrl = data.short_url || `${window.location.origin}/r/${token}`;
  const qrUrl = data.qr_code_url || `${window.location.origin}/api/qr/${token}/image`;

  state.token = token;
  state.shortUrl = shortUrl;
  els.emptyState.classList.add("hidden");
  els.resultCard.classList.remove("hidden");
  els.statusPill.textContent = "Active";
  els.statusPill.classList.remove("deleted");
  els.tokenTitle.textContent = token;
  els.shortUrl.textContent = shortUrl;
  els.shortUrl.href = shortUrl;
  els.originalUrl.textContent = data.original_url;
  els.qrImage.src = `${qrUrl}?t=${Date.now()}`;
  els.tokenInput.value = token;
}

function setUpdateFields(info) {
  els.updateUrl.value = info.original_url || "";
  els.updateExpiry.value = toLocalDatetime(info.expires_at);
}

function renderDetails(info) {
  els.createdAt.textContent = formatDateTime(info.created_at);
  els.updatedAt.textContent = formatDateTime(info.updated_at);
  els.expiresAt.textContent = info.expires_at ? formatDateTime(info.expires_at) : "Never";
  els.details.classList.remove("hidden");
}

function renderAnalytics(data) {
  const days = data.scans_by_day || [];
  const max = Math.max(1, ...days.map((day) => day.count));
  els.totalScans.textContent = data.total_scans;
  els.scanDays.replaceChildren(
    ...days.map((day) => {
      const row = document.createElement("div");
      row.className = "scan-day";

      const date = document.createElement("span");
      date.textContent = day.date;

      const track = document.createElement("span");
      track.className = "bar-track";
      const fill = document.createElement("span");
      fill.className = "bar-fill";
      fill.style.width = `${Math.max(4, (day.count / max) * 100)}%`;
      track.append(fill);

      const count = document.createElement("strong");
      count.textContent = day.count;

      row.append(date, track, count);
      return row;
    })
  );

  if (!days.length) {
    const empty = document.createElement("p");
    empty.textContent = "No scans recorded yet.";
    els.scanDays.replaceChildren(empty);
  }

  els.analytics.classList.remove("hidden");
}

function renderRecent() {
  const items = getRecent();
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "recent-empty";
    empty.textContent = "No recent QR codes on this device.";
    els.recentList.replaceChildren(empty);
    return;
  }

  els.recentList.replaceChildren(
    ...items.map((item) => {
      const button = document.createElement("button");
      button.className = "recent-item";
      button.type = "button";
      button.addEventListener("click", async () => {
        els.tokenInput.value = item.token;
        await withBusy(button, async () => loadToken(item.token));
      });

      const token = document.createElement("span");
      token.className = "recent-token";
      token.textContent = item.token;

      const url = document.createElement("span");
      url.className = "recent-url";
      url.textContent = item.url;

      const time = document.createElement("span");
      time.className = "recent-time";
      time.textContent = formatRelative(item.saved_at);

      button.append(token, url, time);
      return button;
    })
  );
}

function getRecent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch {
    return [];
  }
}

function addRecent(token, url) {
  const next = [
    { token, url, saved_at: new Date().toISOString() },
    ...getRecent().filter((item) => item.token !== token),
  ].slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  renderRecent();
}

function removeRecent(token) {
  localStorage.setItem(
    RECENT_KEY,
    JSON.stringify(getRecent().filter((item) => item.token !== token))
  );
  renderRecent();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const detail = typeof payload === "object" && payload.detail ? payload.detail : response.statusText;
    throw new Error(`${response.status} ${detail}`);
  }

  return payload;
}

function readToken() {
  const value = els.tokenInput.value.trim() || state.token;
  const token = extractToken(value);
  if (!token) throw new Error("Enter a token first.");
  els.tokenInput.value = token;
  return token;
}

function extractToken(value) {
  if (!value) return "";
  const match = value.match(/\/r\/([^/?#]+)/);
  return decodeURIComponent(match ? match[1] : value);
}

async function copyText(text, successMessage) {
  if (!text) {
    showMessage("Nothing to copy yet.", "error");
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement("input");
    input.value = text;
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
  showMessage(successMessage, "success");
}

function toIsoDatetime(value) {
  return value ? new Date(value).toISOString() : null;
}

function toLocalDatetime(value) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatRelative(value) {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

async function withBusy(button, task) {
  try {
    if (button) button.disabled = true;
    showMessage("");
    await task();
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    if (button) button.disabled = false;
  }
}

function showMessage(text, kind = "") {
  els.message.textContent = text;
  els.message.className = `message ${kind}`.trim();
}
