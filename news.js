// ==========================
// Jam WIB & Jendela Trading
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
    labelEl.textContent = "🟡 Jendela Beli Sore — siapkan entry overnight sebelum tutup";
  } else if (minutesNow >= marketOpen && minutesNow < buyWindowStart) {
    barEl.classList.add("market-open");
    labelEl.textContent = "Market berjalan — belum masuk jendela beli sore";
  } else if (minutesNow >= preMarket && minutesNow < marketOpen) {
    barEl.classList.add("market-open");
    labelEl.textContent = "Pra-market — bursa belum buka";
  } else {
    barEl.classList.add("overnight");
    labelEl.textContent = "🌙 Market tutup — evaluasi posisi untuk jual pagi";
  }
}

updateClockAndWindow();
setInterval(updateClockAndWindow, 30000);


// ==========================
// Badge Regime Market + Ticker IHSG (layer makro)
// ==========================
// Sama seperti script.js — baca /api/macro-latest (read-only), isi
// ticker IHSG & badge regime di header. Best-effort, tidak mengganggu
// fitur lain kalau gagal/belum ada data.

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
// Ambil & Render Berita
// ==========================

function waktuRelatif(pubDate) {
  if (!pubDate) return "";
  const published = new Date(pubDate);
  if (isNaN(published.getTime())) return "";

  const diffMs = Date.now() - published.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours < 1) {
    const menit = Math.max(1, Math.round(diffHours * 60));
    return `${menit} menit lalu`;
  }
  if (diffHours < 24) {
    return `${Math.round(diffHours)} jam lalu`;
  }
  const hari = Math.round(diffHours / 24);
  return `${hari} hari lalu`;
}

async function fetchNews(kode) {
  const res = await fetch("/api/news?kode=" + encodeURIComponent(kode));
  const json = await res.json();

  if (!json.success) {
    throw new Error(json.message || "Gagal mengambil berita.");
  }

  return json.data;
}

function renderSummary(kode, data) {
  const el = document.getElementById("newsSummary");

  if (!data.total) {
    el.innerHTML = "";
    return;
  }

  const sumberChips = data.sumberList
    .map(s => `<span class="chip">${s}</span>`)
    .join("");

  el.innerHTML = `
    <section class="panel">
      <label class="panel-label">${data.total} berita ${kode} dari ${data.sumberCount} sumber</label>
      <div class="chips">${sumberChips}</div>
    </section>
  `;
}

function renderNews(data) {
  const el = document.getElementById("newsResult");

  if (!data.items.length) {
    el.innerHTML = `<div class="loading">Tidak ada berita ditemukan untuk kode ini dalam 14 hari terakhir.</div>`;
    return;
  }

  el.innerHTML = data.items.map(item => `
    <a class="card news-card" href="${item.link || '#'}" target="_blank" rel="noopener noreferrer">
      <div class="news-source-row">
        <span class="badge sideways">${item.source}</span>
        <span class="news-time">${waktuRelatif(item.pubDate)}</span>
      </div>
      <div class="news-title">${item.title}</div>
    </a>
  `).join("");
}

async function cariNews() {
  const kode = document.getElementById("newsKode").value.trim().toUpperCase();

  if (!kode) {
    alert("Isi kode saham dulu, contoh: BBCA");
    return;
  }

  const resultEl = document.getElementById("newsResult");
  const summaryEl = document.getElementById("newsSummary");
  summaryEl.innerHTML = "";
  resultEl.innerHTML = `<div class="loading">Mencari berita ${kode}…</div>`;

  try {
    const data = await fetchNews(kode);
    renderSummary(kode, data);
    renderNews(data);
  } catch (e) {
    resultEl.innerHTML = `<div class="error">${e.message}</div>`;
  }
}

document.getElementById("btnCariNews").addEventListener("click", cariNews);

document.getElementById("newsKode").addEventListener("keydown", (e) => {
  if (e.key === "Enter") cariNews();
});

// Auto-isi dari watchlist terakhir kalau ada, biar tidak kosong pas buka halaman
(function autoFillFromWatchlist() {
  try {
    const watchlist = JSON.parse(localStorage.getItem("sahamai_watchlist") || "[]");
    if (watchlist.length) {
      document.getElementById("newsKode").value = watchlist[0];
    }
  } catch (e) {
    // abaikan, biarkan kosong
  }
})();
