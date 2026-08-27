// ==========================
// Jam WIB & Jendela Trading (sama seperti halaman lain)
// ==========================

function getJakartaParts() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(now);

  const hour = Number(parts.find(p => p.type === "hour").value);
  const minute = Number(parts.find(p => p.type === "minute").value);

  return { hour, minute };
}

function updateClockAndWindow() {
  const { hour, minute } = getJakartaParts();

  const clockEl = document.getElementById("clock");
  const barEl = document.getElementById("tickerBar");
  const labelEl = document.getElementById("windowLabel");

  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  clockEl.textContent = `${hh}:${mm} WIB`;

  const minutesNow = hour * 60 + minute;

  const preMarket = 8 * 60;
  const marketOpen = 9 * 60;
  const buyWindowStart = 14 * 60;
  const marketClose = 15 * 60 + 30;

  barEl.className = "ticker-bar";

  if (minutesNow >= buyWindowStart && minutesNow < marketClose) {
    barEl.classList.add("buy-window");
    labelEl.textContent = "🟡 Jendela Beli Sore — Siapkan Entry Overnight Sebelum Tutup";
  } else if (minutesNow >= marketOpen && minutesNow < buyWindowStart) {
    barEl.classList.add("market-open");
    labelEl.textContent = "Market Berjalan — Pantau Watchlist Besok";
  } else if (minutesNow >= preMarket && minutesNow < marketOpen) {
    barEl.classList.add("market-open");
    labelEl.textContent = "Pra-market — Bursa Belum Buka";
  } else {
    barEl.classList.add("overnight");
    labelEl.textContent = "🌙 Market Tutup";
  }
}

updateClockAndWindow();
setInterval(updateClockAndWindow, 30000);

// ==========================
// Badge Regime Market + Ticker IHSG
// ==========================

async function loadRegimeBadge() {
  const badgeEl = document.getElementById("regimeBadge");
  const ihsgEl = document.getElementById("tickerIhsg");
  if (!badgeEl) return;

  try {
    const res = await fetch("/api/macro-latest");
    const json = await res.json();

    if (ihsgEl) {
      if (json.available && json.ihsg_close) {
        const chg = json.ihsg_change_pct;
        const chgClass = chg > 0 ? "positive" : chg < 0 ? "negative" : "";
        const chgText = chg === null || chg === undefined
          ? ""
          : ` <span class="chg ${chgClass}">${chg > 0 ? "▲" : chg < 0 ? "▼" : "•"} ${Math.abs(chg)}%</span>`;
        ihsgEl.innerHTML = `IHSG ${json.ihsg_close.toLocaleString("id-ID", { maximumFractionDigits: 2 })}${chgText}`;
      } else {
        ihsgEl.textContent = "IHSG —";
      }
    }

    if (!json.success || !json.available) {
      badgeEl.className = "regime-badge neutral";
      badgeEl.textContent = "⚪ Regime market: belum ada data";
      return;
    }

    const regime = json.market_regime;
    const score = json.market_regime_score;

    if (regime === "RISK_ON") {
      badgeEl.className = "regime-badge risk-on";
      badgeEl.textContent = `🟢 Risk-On (${score})`;
    } else if (regime === "RISK_OFF") {
      badgeEl.className = "regime-badge risk-off";
      badgeEl.textContent = `🔴 Risk-Off (${score})`;
    } else {
      badgeEl.className = "regime-badge neutral";
      badgeEl.textContent = `⚪ Netral (${score})`;
    }
  } catch (e) {
    badgeEl.className = "regime-badge neutral";
    badgeEl.textContent = "⚪ Regime market: gagal dimuat";
  }
}

loadRegimeBadge();

// ==========================
// Watchlist Besok (localStorage)
// ==========================
// Key sama dipakai juga oleh riwayat.js (tombol ➕ di tabel Riwayat AI)
// supaya nambah item bisa langsung dari halaman itu tanpa endpoint baru.

const WATCHLIST_KEY = "sahamai_watchlist_besok";

function loadWatchlist() {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveWatchlist(list) {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
}

function addWatchlistItem({ kode, scan_date, entry_price }) {
  const list = loadWatchlist();

  list.unshift({
    id: `${kode}_${scan_date}_${Date.now()}`,
    kode: kode.toUpperCase().trim(),
    scan_date,
    entry_price: Number(entry_price) || null,
    added_at: new Date().toISOString(),
    status: "WATCHING",
    exit_price: null,
    exit_time: null,
    last: null
  });

  saveWatchlist(list);
  return list;
}

// ==========================
// Fetch realtime + verdict engine
// ==========================

async function fetchExitReasoning(kode) {
  const res = await fetch(`/api/health?realtime=${encodeURIComponent(kode)}`);
  const json = await res.json();

  if (!json.success) {
    throw new Error(json.message || "Gagal ambil data realtime.");
  }

  return json;
}

async function refreshAllWatching() {
  const list = loadWatchlist();
  const watching = list.filter(i => i.status === "WATCHING");

  for (const item of watching) {
    try {
      const data = await fetchExitReasoning(item.kode);

      item.last = {
        currentPrice: data.exitReasoning?.currentPrice ?? (data.candles?.at(-1)?.close ?? null),
        verdict: data.exitReasoning?.verdict ?? "BELUM_CUKUP_DATA",
        label: data.exitReasoning?.label ?? "Data Belum Cukup",
        score: data.exitReasoning?.score ?? null,
        reasons: data.exitReasoning?.reasons ?? [],
        vwap: data.exitReasoning?.vwap ?? null,
        sessionHigh: data.exitReasoning?.sessionHigh ?? null,
        distanceFromHighPct: data.exitReasoning?.distanceFromHighPct ?? null,
        minutesSinceHigh: data.exitReasoning?.minutesSinceHigh ?? null,
        volumeTrendPct: data.exitReasoning?.volumeTrendPct ?? null,
        source: data.source,
        lagMinutes: data.lagMinutes,
        fetchedAt: new Date().toISOString()
      };
    } catch (e) {
      item.last = {
        error: e?.message || String(e),
        fetchedAt: new Date().toISOString()
      };
    }
  }

  saveWatchlist(list);
  renderWatchlist();
}

// ==========================
// Render
// ==========================

function fmtPct(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function verdictClass(verdict) {
  if (verdict === "HOLD") return "hold";
  if (verdict === "WASPADA") return "waspada";
  if (verdict === "EXIT") return "exit";
  return "unknown";
}

function renderActiveCard(item) {
  const last = item.last;
  const entry = item.entry_price;

  const currentPrice = last?.currentPrice ?? null;
  const changeFromEntryPct = (currentPrice && entry) ? ((currentPrice - entry) / entry) * 100 : null;

  const verdict = last?.verdict ?? null;
  const vClass = verdictClass(verdict);
  const vLabel = last?.label ?? "Belum di-update — tekan \"Update Harga\"";

  const reasons = last?.reasons ?? [];

  return `
    <div class="watchlist-card" data-id="${item.id}">
      <div class="watchlist-card-head">
        <div>
          <div class="watchlist-kode">${item.kode}</div>
          <div class="watchlist-meta">Entry ${entry ?? "–"} · scan ${item.scan_date}</div>
        </div>
        <span class="watchlist-verdict ${vClass}">${vLabel}</span>
      </div>

      <div class="watchlist-price-row">
        <div>
          <div class="watchlist-price-current">${currentPrice ?? "–"}</div>
          <div class="watchlist-meta">Harga sekarang</div>
        </div>
        <div class="watchlist-price-change ${changeFromEntryPct > 0 ? "positive" : changeFromEntryPct < 0 ? "negative" : ""}">
          ${fmtPct(changeFromEntryPct)}
        </div>
      </div>

      ${last && !last.error ? `
      <div class="watchlist-stats">
        <div class="watchlist-stat">
          <div class="watchlist-stat-label">VWAP</div>
          <div class="watchlist-stat-value">${last.vwap ?? "–"}</div>
        </div>
        <div class="watchlist-stat">
          <div class="watchlist-stat-label">High Sesi</div>
          <div class="watchlist-stat-value">${last.sessionHigh ?? "–"}</div>
        </div>
        <div class="watchlist-stat">
          <div class="watchlist-stat-label">Jarak dr High</div>
          <div class="watchlist-stat-value">${last.distanceFromHighPct !== null ? fmtPct(-last.distanceFromHighPct) : "–"}</div>
        </div>
      </div>
      <ul class="watchlist-reasons">
        ${reasons.map(r => `<li>${r}</li>`).join("")}
      </ul>
      ` : last?.error ? `<p class="disclaimer">Gagal update: ${last.error}</p>` : `<p class="disclaimer">Tekan "🔄 Update Harga" untuk ambil data real-time & verdict.</p>`}

      <div class="watchlist-card-actions">
        <button class="btn-primary btn-sell" data-id="${item.id}">Tandai Sudah Dijual</button>
        <button class="btn-ghost btn-remove" data-id="${item.id}">Hapus</button>
      </div>
    </div>
  `;
}

function renderSoldCard(item) {
  const entry = item.entry_price;
  const exit = item.exit_price;
  const pl = (entry && exit) ? ((exit - entry) / entry) * 100 : null;

  return `
    <div class="watchlist-card" data-id="${item.id}">
      <div class="watchlist-card-head">
        <div>
          <div class="watchlist-kode">${item.kode}</div>
          <div class="watchlist-meta">Entry ${entry ?? "–"} → Exit ${exit ?? "–"} · scan ${item.scan_date}</div>
        </div>
        <span class="watchlist-price-change ${pl > 0 ? "positive" : pl < 0 ? "negative" : ""}">${fmtPct(pl)}</span>
      </div>
      <span class="watchlist-sold-badge">Dijual ${item.exit_time ? new Date(item.exit_time).toLocaleString("id-ID") : ""}</span>
      <div class="watchlist-card-actions" style="margin-top:10px;">
        <button class="btn-ghost btn-remove" data-id="${item.id}">Hapus dari Riwayat</button>
      </div>
    </div>
  `;
}

function renderWatchlist() {
  const list = loadWatchlist();

  const active = list.filter(i => i.status === "WATCHING");
  const sold = list.filter(i => i.status === "SOLD");

  const activeEl = document.getElementById("watchlistActive");
  const soldEl = document.getElementById("watchlistSold");

  activeEl.innerHTML = active.length
    ? active.map(renderActiveCard).join("")
    : `<div class="empty-state">Belum ada saham yang dipantau. Tambahkan dari Riwayat AI atau form di atas.</div>`;

  soldEl.innerHTML = sold.length
    ? sold.map(renderSoldCard).join("")
    : `<div class="empty-state">Belum ada transaksi yang ditutup.</div>`;

  // Aksi: jual
  activeEl.querySelectorAll(".btn-sell").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const current = loadWatchlist();
      const item = current.find(i => i.id === id);
      if (!item) return;

      const suggested = item.last?.currentPrice ?? item.entry_price ?? "";
      const exitPriceStr = prompt(`Harga jual ${item.kode}:`, suggested);
      if (exitPriceStr === null) return;

      const exitPrice = Number(exitPriceStr);
      if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
        alert("Harga tidak valid.");
        return;
      }

      item.status = "SOLD";
      item.exit_price = exitPrice;
      item.exit_time = new Date().toISOString();

      saveWatchlist(current);
      renderWatchlist();
    });
  });

  // Aksi: hapus (dari kedua section)
  document.querySelectorAll(".btn-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const current = loadWatchlist().filter(i => i.id !== id);
      saveWatchlist(current);
      renderWatchlist();
    });
  });
}

// ==========================
// Form tambah manual
// ==========================

document.getElementById("btnTambahWatchlist").addEventListener("click", () => {
  const kode = document.getElementById("wlKode").value.trim();
  const harga = document.getElementById("wlHarga").value.trim();
  const tanggal = document.getElementById("wlTanggal").value || new Date().toISOString().slice(0, 10);

  if (!kode) {
    alert("Kode saham wajib diisi.");
    return;
  }

  addWatchlistItem({ kode, scan_date: tanggal, entry_price: harga });

  document.getElementById("wlKode").value = "";
  document.getElementById("wlHarga").value = "";
  document.getElementById("wlTanggal").value = "";

  renderWatchlist();
});

document.getElementById("btnRefreshWatchlist").addEventListener("click", async () => {
  const btn = document.getElementById("btnRefreshWatchlist");
  btn.disabled = true;
  btn.textContent = "Memuat…";

  try {
    await refreshAllWatching();
  } finally {
    btn.disabled = false;
    btn.textContent = "🔄 Update Harga";
  }
});

renderWatchlist();
