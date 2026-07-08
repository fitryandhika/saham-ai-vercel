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
  const barEl = document.getElementById("windowBar");
  const labelEl = document.getElementById("windowLabel");

  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  clockEl.textContent = `${hh}:${mm} WIB`;

  const minutesNow = hour * 60 + minute;

  const preMarket = 8 * 60;
  const marketOpen = 9 * 60;
  const buyWindowStart = 14 * 60;
  const marketClose = 15 * 60 + 30;

  barEl.className = "window-bar";

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
// Watchlist (localStorage)
// ==========================

const WATCHLIST_KEY = "sahamai_watchlist";

function getWatchlist() {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    return raw ? JSON.parse(raw) : ["BBCA", "BBRI", "TLKM"];
  } catch (e) {
    return ["BBCA", "BBRI", "TLKM"];
  }
}

function saveWatchlist(list) {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
}

function renderChips() {
  const chipsEl = document.getElementById("chips");
  const list = getWatchlist();

  chipsEl.innerHTML = list.map(kode => `
    <span class="chip" data-kode="${kode}">
      <span class="chip-label">${kode}</span>
      <span class="remove" data-remove="${kode}">✕</span>
    </span>
  `).join("");

  chipsEl.querySelectorAll(".chip-label").forEach(el => {
    el.addEventListener("click", () => {
      document.getElementById("kode").value = el.textContent;
      analisaSatu(el.textContent);
    });
  });

  chipsEl.querySelectorAll(".remove").forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const kode = el.getAttribute("data-remove");
      const updated = getWatchlist().filter(k => k !== kode);
      saveWatchlist(updated);
      renderChips();
    });
  });
}

document.getElementById("btnAddWatch").addEventListener("click", () => {
  const kode = document.getElementById("kode").value.trim().toUpperCase();
  if (!kode) return;

  const list = getWatchlist();
  if (!list.includes(kode)) {
    list.push(kode);
    saveWatchlist(list);
    renderChips();
  }
});

renderChips();

// ==========================
// Render kartu hasil
// ==========================

function verdictClass(verdict) {
  if (verdict.includes("Layak dibeli")) return "buy";
  if (verdict.includes("Belum layak")) return "avoid";
  return "";
}

function trendClass(trend) {
  if (trend === "BULLISH") return "bullish";
  if (trend === "BEARISH") return "bearish";
  return "sideways";
}

function renderCard(d) {
  const vClass = verdictClass(d.verdict);
  const tClass = trendClass(d.marketTrend);

  const warningsHtml = (d.warnings && d.warnings.length)
    ? `<div class="warnings">
        <ul>${d.warnings.map(w => `<li>${w}</li>`).join("")}</ul>
       </div>`
    : "";

  return `
    <div class="card">

      <div class="card-head">
        <span class="card-kode">${d.kode}</span>
        <span class="card-close">${d.close.toLocaleString("id-ID")}</span>
      </div>

      <div class="badge-row">
        <span class="badge ${tClass}">${d.marketTrend}</span>
        <span class="badge sideways">Risiko ${d.riskLevel}</span>
        <span class="badge sideways">Entry ${d.entry}</span>
      </div>

      <div class="verdict-box ${vClass}">
        <div class="verdict-label">Verdict — Beli Sore / Jual Pagi</div>
        <div class="verdict-text">${d.verdict}</div>
      </div>

      <div class="stat-grid">
        <div class="stat">
          <div class="stat-label">Gap Outlook</div>
          <div class="stat-value">${d.gap.outlook} (${d.gap.probability})</div>
        </div>
        <div class="stat">
          <div class="stat-label">Signal / Score</div>
          <div class="stat-value">${d.signal} · ${d.score}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Confidence</div>
          <div class="stat-value">${d.confidence}%</div>
        </div>
        <div class="stat">
          <div class="stat-label">Momentum</div>
          <div class="stat-value">${d.momentum.strength}</div>
        </div>
      </div>

      <div class="risk-row">
        <div class="risk-item">
          <span class="risk-label">Stop Loss</span>
          ${d.stopLoss.toLocaleString("id-ID")}
        </div>
        <div class="risk-item">
          <span class="risk-label">ATR (Volatilitas)</span>
          ${d.atr.toLocaleString("id-ID")}
        </div>
      </div>

      <div class="tp-grid">
        <div class="tp-item">
          <span class="tp-label">TP1</span>
          <span class="tp-value">${d.takeProfitLevels.tp1.toLocaleString("id-ID")}</span>
          <span class="tp-rr">RR 1:${d.riskRewardLevels.tp1}</span>
        </div>
        <div class="tp-item">
          <span class="tp-label">TP2</span>
          <span class="tp-value">${d.takeProfitLevels.tp2.toLocaleString("id-ID")}</span>
          <span class="tp-rr">RR 1:${d.riskRewardLevels.tp2}</span>
        </div>
        <div class="tp-item">
          <span class="tp-label">TP3</span>
          <span class="tp-value">${d.takeProfitLevels.tp3.toLocaleString("id-ID")}</span>
          <span class="tp-rr">RR 1:${d.riskRewardLevels.tp3}</span>
        </div>
      </div>

      ${warningsHtml}

      ${renderFundamentalSection(d.fundamental)}

    </div>
  `;
}

function renderFundamentalSection(f) {
  if (!f || f.label === "DATA TIDAK TERSEDIA") {
    return "";
  }

  const fClass = f.label === "FUNDAMENTAL KUAT" ? "buy"
    : f.label === "FUNDAMENTAL LEMAH" ? "avoid" : "";

  const m = f.metrics || {};

  const row = (label, value, suffix = "") =>
    value != null
      ? `<div class="stat">
           <div class="stat-label">${label}</div>
           <div class="stat-value">${value.toLocaleString("id-ID", { maximumFractionDigits: 2 })}${suffix}</div>
         </div>`
      : "";

  return `
    <div class="verdict-box ${fClass}" style="margin-top:12px;">
      <div class="verdict-label">Fundamental</div>
      <div class="verdict-text">${f.label} · Skor ${f.score}</div>
    </div>
    <div class="stat-grid">
      ${row("PE Ratio", m.trailingPE, "x")}
      ${row("PBV", m.priceToBook, "x")}
      ${row("ROE", m.returnOnEquity, "%")}
      ${row("Debt/Equity", m.debtToEquity, "%")}
      ${row("Dividend Yield", m.dividendYield, "%")}
    </div>
  `;
}

// ==========================
// Panggil API
// ==========================

async function fetchAnalisa(kode) {
  const res = await fetch("/api/analyze?kode=" + kode);
  const json = await res.json();

  if (!json.success) {
    throw new Error(json.message || "Analisis gagal.");
  }

  return json.data;
}

async function analisaSatu(kode) {
  const hasilEl = document.getElementById("hasil");
  hasilEl.innerHTML = `<div class="loading">Menganalisa ${kode}…</div>`;

  try {
    const data = await fetchAnalisa(kode);
    hasilEl.innerHTML = renderCard(data);
  } catch (e) {
    hasilEl.innerHTML = `<div class="error">Gagal menganalisa ${kode}: ${e.message}</div>`;
    console.error(e);
  }
}

async function analisaSemua() {
  const list = getWatchlist();
  const hasilEl = document.getElementById("hasil");

  if (!list.length) {
    hasilEl.innerHTML = `<div class="loading">Watchlist masih kosong. Tambahkan kode saham dulu.</div>`;
    return;
  }

  hasilEl.innerHTML = `<div class="loading">Menganalisa ${list.length} saham di watchlist…</div>`;

  const cards = [];

  for (const kode of list) {
    try {
      const data = await fetchAnalisa(kode);
      cards.push({ kode, data });
    } catch (e) {
      cards.push({ kode, error: e.message });
    }
  }

  // Urutkan: probabilitas gap up tertinggi di atas
  cards.sort((a, b) => {
    const pa = a.data ? parseFloat(a.data.gap.probability) : -1;
    const pb = b.data ? parseFloat(b.data.gap.probability) : -1;
    return pb - pa;
  });

  hasilEl.innerHTML = cards.map(c =>
    c.data
      ? renderCard(c.data)
      : `<div class="error">Gagal menganalisa ${c.kode}: ${c.error}</div>`
  ).join("");
}

document.getElementById("btnAnalisa").addEventListener("click", () => {
  const kode = document.getElementById("kode").value.trim().toUpperCase();
  if (kode) analisaSatu(kode);
});

document.getElementById("btnAnalisaSemua").addEventListener("click", analisaSemua);

// ==========================
// Screener Saham Murah (<500)
// ==========================
//
// PENTING: daftar ini adalah kandidat kode saham dari sektor yang
// secara historis punya rentang harga rendah-menengah — BUKAN
// klaim bahwa harganya di bawah 500 saat ini. Harga & likuiditas
// berubah tiap hari, jadi filter close<500 tetap dicek LIVE lewat
// /api/analyze saat scan berjalan, bukan dari daftar ini.
// Silakan tambah/kurangi kode sesuai riset & kenyamanan kamu sendiri.

const UNIVERSE_MURAH = [
  // Konstruksi & properti BUMN/swasta
  "WIKA", "WSKT", "ADHI", "PTPP", "WEGE", "TOTL", "NRCA", "ACST", "WTON",
  "BSDE", "PWON", "SMRA", "APLN", "KIJA", "BEST", "DMAS", "MTLA", "GPRA",
  "ASRI", "BKSL", "DILD", "MDLN", "PPRO",

  // Tambang & energi kapitalisasi kecil-menengah
  "DOID", "BSSR", "MBAP", "TOBA", "GEMS", "INDY", "ELSA", "ENRG", "RUIS",
  "ESSA", "MEDC",

  // Perbankan kecil-menengah
  "BJTM", "BJBR", "BBTN", "BEKS", "BABP", "BBHI", "BNBA", "BMAS", "AGRO",
  "BVIC", "INPC", "MAYA", "NOBU", "PNBN", "BSIM",

  // Retail, konsumer, media
  "RALS", "ACES", "ERAA", "MPPA", "HERO", "RANC", "MNCN", "SCMA", "MSKY",
  "VIVA", "FILM",

  // Pelayaran & logistik
  "TMAS", "SMDR", "WINS", "HITS", "BULL", "TPMA",

  // Perkebunan
  "LSIP", "SGRO", "SIMP", "DSNG", "TBLA",

  // Farmasi & kesehatan
  "KAEF", "INAF"
];

async function screenerSahamMurah() {
  const hasilEl = document.getElementById("hasil");
  const btn = document.getElementById("btnScreenerMurah");

  btn.disabled = true;
  hasilEl.innerHTML = `<div class="loading">Screening ${UNIVERSE_MURAH.length} saham (harga &lt;500 & sinyal Strong Buy)… ini bisa makan waktu 1-2 menit.</div>`;

  const lolos = [];
  const gagal = [];
  let selesai = 0;

  for (const kode of UNIVERSE_MURAH) {
    try {
      const data = await fetchAnalisa(kode);
      if (data.close < 500 && data.signal === "STRONG BUY") {
        lolos.push(data);
      }
    } catch (e) {
      gagal.push(kode);
    }

    selesai++;
    hasilEl.innerHTML = `<div class="loading">Screening… ${selesai}/${UNIVERSE_MURAH.length} saham dicek, ${lolos.length} lolos sejauh ini.</div>`;
  }

  lolos.sort((a, b) => parseFloat(b.gap.probability) - parseFloat(a.gap.probability));

  btn.disabled = false;

  const ringkasan = `<div class="loading">${lolos.length} dari ${UNIVERSE_MURAH.length} saham lolos (harga &lt;500, sinyal Strong Buy).${gagal.length ? ` (${gagal.length} kode gagal diambil datanya)` : ""}</div>`;

  if (!lolos.length) {
    hasilEl.innerHTML = `<div class="loading">Tidak ada saham murah yang memenuhi sinyal Strong Buy saat ini. Coba lagi nanti atau perluas daftar kandidat.</div>`;
    return;
  }

  hasilEl.innerHTML = ringkasan + lolos.map(renderCard).join("");
}

document.getElementById("btnScreenerMurah").addEventListener("click", screenerSahamMurah);
