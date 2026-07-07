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
// Portofolio (localStorage)
// ==========================

const PORTFOLIO_KEY = "sahamai_portfolio";

function getPortfolio() {
  try {
    const raw = localStorage.getItem(PORTFOLIO_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function savePortfolio(list) {
  localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(list));
}

function hitungPL(pos, hargaSekarang) {
  const lembar = pos.lots * 100;
  const pl = (hargaSekarang - pos.entryPrice) * lembar;
  const plPersen = ((hargaSekarang - pos.entryPrice) / pos.entryPrice) * 100;
  return { pl, plPersen };
}

function tambahPosisi() {
  const kode = document.getElementById("pfKode").value.trim().toUpperCase();
  const harga = parseFloat(document.getElementById("pfHarga").value);
  const lot = parseInt(document.getElementById("pfLot").value, 10) || 1;

  if (!kode || !harga || harga <= 0) {
    alert("Isi kode saham dan harga beli yang valid dulu.");
    return;
  }

  const list = getPortfolio();
  list.push({
    id: Date.now().toString(),
    kode,
    entryPrice: harga,
    lots: lot,
    entryDate: new Date().toISOString(),
    status: "open",
    lastPrice: harga,
    exitPrice: null,
    exitDate: null
  });
  savePortfolio(list);

  document.getElementById("pfKode").value = "";
  document.getElementById("pfHarga").value = "";
  document.getElementById("pfLot").value = "1";

  renderPortfolio();
}

function tutupPosisi(id) {
  const list = getPortfolio();
  const pos = list.find(p => p.id === id);
  if (!pos) return;

  const defaultHarga = pos.lastPrice || pos.entryPrice;
  const input = prompt(`Harga jual untuk ${pos.kode}?`, defaultHarga);
  if (input === null) return;

  const exitPrice = parseFloat(input);
  if (!exitPrice || exitPrice <= 0) {
    alert("Harga jual tidak valid.");
    return;
  }

  pos.status = "closed";
  pos.exitPrice = exitPrice;
  pos.exitDate = new Date().toISOString();

  savePortfolio(list);
  renderPortfolio();
}

async function refreshHargaPortfolio() {
  const list = getPortfolio();
  const open = list.filter(p => p.status === "open");
  const kodeUnik = [...new Set(open.map(p => p.kode))];

  if (!kodeUnik.length) return;

  const btn = document.getElementById("btnRefreshPortfolio");
  btn.textContent = "Memuat…";

  for (const kode of kodeUnik) {
    try {
      const data = await fetchAnalisa(kode);
      list.forEach(p => {
        if (p.kode === kode && p.status === "open") p.lastPrice = data.close;
      });
    } catch (e) {
      console.error("Gagal update harga", kode, e);
    }
  }

  savePortfolio(list);
  btn.textContent = "Refresh Harga";
  renderPortfolio();
}

function renderPortfolio() {
  const list = getPortfolio();
  const open = list.filter(p => p.status === "open");
  const closed = list.filter(p => p.status === "closed");

  const listEl = document.getElementById("portfolioList");

  if (!open.length) {
    listEl.innerHTML = `<div class="loading">Belum ada posisi aktif. Tambahkan di atas.</div>`;
  } else {
    listEl.innerHTML = open.map(pos => {
      const hargaSekarang = pos.lastPrice || pos.entryPrice;
      const { pl, plPersen } = hitungPL(pos, hargaSekarang);
      const cls = pl >= 0 ? "positive" : "negative";
      const tanda = pl >= 0 ? "+" : "";

      return `
        <div class="portfolio-card">
          <div class="pf-head">
            <span class="pf-kode">${pos.kode}</span>
            <span class="pf-pl ${cls}">${tanda}${Math.round(pl).toLocaleString("id-ID")} (${tanda}${plPersen.toFixed(2)}%)</span>
          </div>
          <div class="pf-detail">
            <span>Beli ${pos.entryPrice.toLocaleString("id-ID")} × ${pos.lots} lot</span>
            <span>Now ${hargaSekarang.toLocaleString("id-ID")}</span>
          </div>
          <div class="pf-actions">
            <button class="btn-ghost" data-close="${pos.id}">Tutup Posisi</button>
          </div>
        </div>
      `;
    }).join("");

    listEl.querySelectorAll("[data-close]").forEach(btn => {
      btn.addEventListener("click", () => tutupPosisi(btn.getAttribute("data-close")));
    });
  }

  renderRecap(closed);
}

function renderRecap(closed) {
  const recapEl = document.getElementById("recapStats");

  if (!closed.length) {
    recapEl.innerHTML = `<div class="loading">Belum ada transaksi yang ditutup.</div>`;
    return;
  }

  let totalPL = 0;
  let menang = 0;

  const rows = closed.slice().reverse().map(pos => {
    const lembar = pos.lots * 100;
    const pl = (pos.exitPrice - pos.entryPrice) * lembar;
    totalPL += pl;
    if (pl > 0) menang++;

    const cls = pl >= 0 ? "positive" : "negative";
    const tanda = pl >= 0 ? "+" : "";

    return `
      <div class="history-row">
        <span>${pos.kode}</span>
        <span>${pos.entryPrice.toLocaleString("id-ID")} → ${pos.exitPrice.toLocaleString("id-ID")}</span>
        <span class="${cls}">${tanda}${Math.round(pl).toLocaleString("id-ID")}</span>
      </div>
    `;
  }).join("");

  const winRate = ((menang / closed.length) * 100).toFixed(1);
  const totalCls = totalPL >= 0 ? "positive" : "negative";
  const totalTanda = totalPL >= 0 ? "+" : "";

  recapEl.innerHTML = `
    <div class="stat-grid">
      <div class="stat">
        <div class="stat-label">Total P/L Realisasi</div>
        <div class="stat-value ${totalCls}">${totalTanda}${Math.round(totalPL).toLocaleString("id-ID")}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Win Rate</div>
        <div class="stat-value">${winRate}% (${menang}/${closed.length})</div>
      </div>
    </div>
    <details class="history-details">
      <summary>Riwayat transaksi (${closed.length})</summary>
      ${rows}
    </details>
  `;
}

document.getElementById("btnTambahPosisi").addEventListener("click", tambahPosisi);
document.getElementById("btnRefreshPortfolio").addEventListener("click", refreshHargaPortfolio);

renderPortfolio();
