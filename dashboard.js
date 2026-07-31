// ==========================
// Jam WIB & Jendela Trading (sama seperti script.js/portfolio.js)
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
// Helpers
// ==========================

function fmtPct(n) {
  if (n === null || n === undefined) return "–";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function pctClass(n) {
  if (n === null || n === undefined) return "";
  return n >= 50 ? "positive" : "negative";
}

function retClass(n) {
  if (n === null || n === undefined) return "";
  return n >= 0 ? "positive" : "negative";
}

async function fetchJSON(url) {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.success) throw new Error(json.message || json.error || "Request gagal");
  return json;
}

// ==========================
// Render: ringkasan overall
// ==========================

function renderOverall(overall) {
  const el = document.getElementById("summaryOverall");

  if (!overall || overall.total_labeled === 0) {
    el.innerHTML = `<div class="empty-state">Belum ada data yang sudah dilabel. Tunggu cron /api/scan &amp; /api/label-outcomes jalan beberapa hari dulu.</div>`;
    return;
  }

  el.innerHTML = `
    <div class="summary-grid">
      <div class="summary-stat">
        <div class="stat-label">Total Prediksi Dilabel</div>
        <div class="stat-value">${overall.total_labeled.toLocaleString("id-ID")}</div>
      </div>
      <div class="summary-stat">
        <div class="stat-label">Win Rate</div>
        <div class="stat-value ${pctClass(overall.win_rate)}">${overall.win_rate ?? "–"}%</div>
      </div>
      <div class="summary-stat">
        <div class="stat-label">Rata-rata Return Next-Day</div>
        <div class="stat-value ${retClass(overall.avg_return_pct)}">${fmtPct(overall.avg_return_pct)}</div>
      </div>
      <div class="summary-stat">
        <div class="stat-label">Total Scan (semua, termasuk belum dilabel)</div>
        <div class="stat-value">${overall.total_scan.toLocaleString("id-ID")}</div>
      </div>
    </div>
  `;
}

// ==========================
// Render: mini-table (by_signal / by_score_bucket / by_breakout_level)
// ==========================

function renderMiniTable(containerId, rows, labelKey, labelHeader) {
  const el = document.getElementById(containerId);

  if (!rows || rows.length === 0) {
    el.innerHTML = `<div class="empty-state">Belum ada data.</div>`;
    return;
  }

  const head = `
    <div class="mini-table-row head">
      <span>${labelHeader}</span>
      <span>Jumlah</span>
      <span>Win Rate</span>
      <span>Avg Return</span>
    </div>
  `;

  const body = rows
    .map((r) => `
      <div class="mini-table-row">
        <span>${r[labelKey]}</span>
        <span>${r.jumlah}</span>
        <span class="win-rate ${pctClass(r.win_rate)}">${r.win_rate ?? "–"}%</span>
        <span class="${retClass(r.avg_return_pct)}">${fmtPct(r.avg_return_pct)}</span>
      </div>
    `)
    .join("");

  el.innerHTML = head + body;
}

// ==========================
// Render: High Conviction vs Baseline
// ==========================

function renderHcVsBaseline(data) {
  const el = document.getElementById("hcVsBaseline");
  if (!data) {
    el.innerHTML = `<div class="empty-state">Belum ada data.</div>`;
    return;
  }

  const rows = [
    { label: "Baseline (signal BUY/STRONG BUY)", ...data.baseline },
    { label: "High Conviction (filter penuh)", ...data.high_conviction }
  ];

  renderMiniTableFromObjects("hcVsBaseline", rows);
}

function renderMiniTableFromObjects(containerId, rows) {
  const el = document.getElementById(containerId);
  const head = `
    <div class="mini-table-row head">
      <span>Kelompok</span>
      <span>Jumlah</span>
      <span>Win Rate</span>
      <span>Avg Return</span>
    </div>
  `;
  const body = rows
    .map((r) => `
      <div class="mini-table-row">
        <span>${r.label}</span>
        <span>${r.jumlah}</span>
        <span class="win-rate ${pctClass(r.win_rate)}">${r.win_rate ?? "–"}%</span>
        <span class="${retClass(r.avg_return_pct)}">${fmtPct(r.avg_return_pct)}</span>
      </div>
    `)
    .join("");
  el.innerHTML = head + body;
}

// ==========================
// Render: tren harian
// ==========================

function renderByDate(rows) {
  const el = document.getElementById("byDate");

  if (!rows || rows.length === 0) {
    el.innerHTML = `<div class="empty-state">Belum ada data.</div>`;
    return;
  }

  // Urutkan terbaru dulu untuk ditampilkan, maksimal 30 hari terakhir
  const recent = [...rows].reverse().slice(0, 30);

  el.innerHTML = recent
    .map((r) => {
      if (r.pending) {
        return `
          <div class="trend-row">
            <span>${r.tanggal}</span>
            <div class="trend-bar-wrap"><div class="trend-bar" style="width:0%"></div></div>
            <span class="trend-pending">Menunggu pelabelan (${r.total_scan} scan)</span>
          </div>
        `;
      }
      const wr = r.win_rate ?? 0;
      return `
        <div class="trend-row">
          <span>${r.tanggal}</span>
          <div class="trend-bar-wrap"><div class="trend-bar" style="width:${wr}%"></div></div>
          <span class="${pctClass(r.win_rate)}">${r.win_rate ?? "–"}% (${r.jumlah})</span>
        </div>
      `;
    })
    .join("");
}

// ==========================
// Render: tabel riwayat mentah
// ==========================

function statusPill(row) {
  if (row.gap_up_realized === null || row.gap_up_realized === undefined) {
    return `<span class="result-pill pending">Belum dilabel</span>`;
  }
  return row.gap_up_realized
    ? `<span class="result-pill win">Gap Up</span>`
    : `<span class="result-pill loss">Tidak Gap Up</span>`;
}

function regimeBadge(regime) {
  if (regime === "RISK_ON") {
    return `<span class="regime-pill risk-on">🟢 Risk-On</span>`;
  }
  if (regime === "RISK_OFF") {
    return `<span class="regime-pill risk-off">🔴 Risk-Off</span>`;
  }
  if (regime === "NEUTRAL") {
    return `<span class="regime-pill neutral">⚪ Netral</span>`;
  }
  return `<span class="regime-pill unknown">–</span>`;
}

function renderHistoryTable(rows) {
  const el = document.getElementById("historyTableWrap");

  if (!rows || rows.length === 0) {
    el.innerHTML = `<div class="empty-state">Tidak ada data untuk filter ini.</div>`;
    return;
  }

  const body = rows
    .map((r) => `
      <tr>
        <td>${r.scan_date}</td>
        <td><strong>${r.kode}</strong></td>
        <td>${r.signal ?? "–"}</td>
        <td>${r.score ?? "–"}</td>
        <td>${r.close ?? "–"}</td>
        <td>${r.actual_next_open ?? "–"}</td>
        <td class="${retClass(r.next_day_return_pct)}">${fmtPct(r.next_day_return_pct)}</td>
        <td>${regimeBadge(r.market_regime)}</td>
        <td>${statusPill(r)}</td>
      </tr>
    `)
    .join("");

  el.innerHTML = `
    <div class="history-table-scroll">
      <table class="history-table">
        <thead>
          <tr>
            <th>Tanggal</th><th>Kode</th><th>Signal</th><th>Score</th>
            <th>Close</th><th>Next Open</th><th>Return</th><th>Regime</th><th>Hasil</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

// ==========================
// Load data
// ==========================

async function loadSummary() {
  const sinceDate = document.getElementById("sinceDate").value;
  const url = sinceDate ? `/api/history?view=summary&sinceDate=${sinceDate}` : `/api/history?view=summary`;

  try {
    const { data } = await fetchJSON(url);
    renderOverall(data.overall);
    renderMiniTable("bySignal", data.by_signal, "signal", "Signal");
    renderMiniTable("byScoreBucket", data.by_score_bucket, "bucket", "Bucket Skor");
    renderMiniTable("byBreakout", data.by_breakout_level, "breakout_level", "Breakout Level");
    renderHcVsBaseline(data.high_conviction_vs_baseline);
    renderByDate(data.by_date);
  } catch (e) {
    document.getElementById("summaryOverall").innerHTML =
      `<div class="empty-state">Gagal memuat ringkasan: ${e.message}</div>`;
  }
}

async function loadTable() {
  const kode = document.getElementById("kodeFilter").value.trim();
  const params = new URLSearchParams({ view: "table", limit: "100" });
  if (kode) params.set("kode", kode);

  const el = document.getElementById("historyTableWrap");
  el.innerHTML = `<div class="empty-state">Memuat…</div>`;

  try {
    const { data } = await fetchJSON(`/api/history?${params.toString()}`);
    renderHistoryTable(data);
  } catch (e) {
    el.innerHTML = `<div class="empty-state">Gagal memuat tabel: ${e.message}</div>`;
  }
}

function exportCsv() {
  const kode = document.getElementById("kodeFilter").value.trim();
  const date = document.getElementById("dateFilter").value;

  const params = new URLSearchParams({ view: "table", format: "csv" });
  if (kode) params.set("kode", kode);
  if (date) params.set("date", date);

  // Navigasi langsung (bukan fetch) supaya browser yang urus proses
  // download & Content-Disposition filename, termasuk di HP.
  window.location.href = `/api/history?${params.toString()}`;
}

document.getElementById("btnRefresh").addEventListener("click", loadSummary);
document.getElementById("btnLoadTable").addEventListener("click", loadTable);
document.getElementById("btnExportCsv").addEventListener("click", exportCsv);

loadSummary();
loadTable();

// ==========================================================
// Widget: Grafik IHSG (SVG line chart, tanpa library eksternal)
// ==========================================================

let currentIhsgPeriod = "1bln";

function buildLineChartSvg(values, { width = 600, height = 180, positive = true } = {}) {
  if (!values || values.length < 2) return "";

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padX = 4;
  const padY = 10;
  const w = width - padX * 2;
  const h = height - padY * 2;

  const points = values.map((v, i) => {
    const x = padX + (i / (values.length - 1)) * w;
    const y = padY + h - ((v - min) / range) * h;
    return [x, y];
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L${points.at(-1)[0].toFixed(2)},${height - padY} L${points[0][0].toFixed(2)},${height - padY} Z`;

  const stroke = positive ? "#22C55E" : "#EF4444";
  const fillId = positive ? "ihsgFillPos" : "ihsgFillNeg";
  const fillTop = positive ? "rgba(34,197,94,.35)" : "rgba(239,68,68,.35)";

  return `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="${fillId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${fillTop}" />
          <stop offset="100%" stop-color="rgba(0,0,0,0)" />
        </linearGradient>
      </defs>
      <path d="${areaPath}" fill="url(#${fillId})" stroke="none" />
      <path d="${linePath}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
    </svg>
  `;
}

async function loadIhsgChart(period) {
  const statsEl = document.getElementById("ihsgChartStats");
  const chartEl = document.getElementById("ihsgChartWrap");

  try {
    const json = await fetchJSON(`/api/dashboard-data?type=ihsg&period=${period}`);

    const chg = json.changeFromPrevPct;
    const chgClass = chg > 0 ? "positive" : chg < 0 ? "negative" : "";
    const chgIcon = chg > 0 ? "▲" : chg < 0 ? "▼" : "•";

    statsEl.innerHTML = `
      <span class="ihsg-value">${json.latest?.toLocaleString("id-ID", { maximumFractionDigits: 2 }) ?? "–"}</span>
      <span class="ihsg-chg ${chgClass}">${chgIcon} ${fmtPct(chg)}</span>
      <span class="hint-text" style="margin:0;">Periode: ${fmtPct(json.changeFromStartPct)}</span>
    `;

    const positive = (json.changeFromStartPct ?? 0) >= 0;
    chartEl.innerHTML = buildLineChartSvg(json.values, { positive });
  } catch (e) {
    statsEl.innerHTML = "";
    chartEl.innerHTML = `<div class="empty-state">Gagal memuat grafik IHSG: ${e.message}</div>`;
  }
}

document.querySelectorAll("#ihsgPeriodSwitch .period-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#ihsgPeriodSwitch .period-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentIhsgPeriod = btn.dataset.period;
    loadIhsgChart(currentIhsgPeriod);
  });
});

// ==========================================================
// Widget: Arus Dana Asing
// ==========================================================

async function loadForeignFlow() {
  const el = document.getElementById("foreignFlowWrap");

  try {
    const res = await fetch("/api/dashboard-data?type=flow");
    const json = await res.json();

    if (!json.success) throw new Error(json.message || "Gagal memuat");

    if (!json.available) {
      el.innerHTML = `<div class="empty-state">${json.message}</div>`;
      return;
    }

    const dirMap = {
      INFLOW: { cls: "inflow", icon: "🟢", label: "Estimasi Net Inflow" },
      OUTFLOW: { cls: "outflow", icon: "🔴", label: "Estimasi Net Outflow" },
      NEUTRAL: { cls: "neutral", icon: "⚪", label: "Netral / Tidak Jelas Arah" }
    };

    const d = dirMap[json.direction] || dirMap.NEUTRAL;
    const badgeLabel = json.mode === "actual"
      ? (json.direction === "INFLOW" ? "Net Inflow (data aktual)" : "Net Outflow (data aktual)")
      : d.label;

    const reasons = (json.reasons || [])
      .map((r) => `<li>${r}</li>`)
      .join("");

    el.innerHTML = `
      <div class="flow-badge ${d.cls}">${d.icon} ${badgeLabel}</div>
      <ul class="flow-reasons">${reasons}</ul>
      <div class="flow-note">${json.note || ""}</div>
    `;
  } catch (e) {
    el.innerHTML = `<div class="empty-state">Gagal memuat arus dana asing: ${e.message}</div>`;
  }
}

// ==========================================================
// Widget: Kondisi Pasar Asia
// ==========================================================

async function loadAsiaMarkets() {
  const el = document.getElementById("asiaMarketsWrap");

  try {
    const res = await fetch("/api/dashboard-data?type=asia");
    const json = await res.json();
    if (!json.success) throw new Error(json.message || "Gagal memuat");

    const rows = json.data
      .map((m) => {
        if (m.status !== "ok" || m.changePct === null) {
          return `
            <div class="asia-row">
              <div class="asia-name"><strong>${m.name}</strong><span>${m.country}</span></div>
              <div class="asia-num"><span class="asia-close">–</span></div>
            </div>
          `;
        }
        const cls = m.changePct > 0 ? "positive" : m.changePct < 0 ? "negative" : "flat";
        const icon = m.changePct > 0 ? "▲" : m.changePct < 0 ? "▼" : "•";
        return `
          <div class="asia-row">
            <div class="asia-name"><strong>${m.name}</strong><span>${m.country}</span></div>
            <div class="asia-num">
              <div class="asia-close">${m.close.toLocaleString("id-ID")}</div>
              <div class="asia-chg ${cls}">${icon} ${Math.abs(m.changePct)}%</div>
            </div>
          </div>
        `;
      })
      .join("");

    el.innerHTML = `<div class="asia-list">${rows}</div>`;
  } catch (e) {
    el.innerHTML = `<div class="empty-state">Gagal memuat kondisi pasar Asia: ${e.message}</div>`;
  }
}

// ==========================================================
// Widget: Top 10 Emiten <300
// ==========================================================

function signalPillClass(signal) {
  if (signal === "STRONG BUY") return "strong-buy";
  if (signal === "BUY") return "buy";
  if (signal === "SELL" || signal === "STRONG SELL") return "sell";
  return "hold";
}

async function loadTopEmiten() {
  const btn = document.getElementById("btnLoadTopEmiten");
  const el = document.getElementById("topEmitenWrap");

  btn.disabled = true;
  btn.textContent = "Memindai…";
  el.innerHTML = `<div class="empty-state">Memindai seluruh emiten &lt;Rp300 di server, mohon tunggu…</div>`;

  try {
    const res = await fetch("/api/scan?maxPrice=300");
    const json = await res.json();

    btn.disabled = false;
    btn.textContent = "Muat Ulang";

    if (json.skipped) {
      el.innerHTML = `<div class="empty-state">${json.message}</div>`;
      return;
    }

    if (!json.success) throw new Error(json.message || "Scan gagal");

    const top10 = (json.data || []).slice(0, 10);

    if (!top10.length) {
      el.innerHTML = `<div class="empty-state">Tidak ada emiten &lt;Rp300 yang lolos saat ini.</div>`;
      return;
    }

    const head = `
      <div class="emiten-row head">
        <span>#</span><span>Kode</span><span>Harga</span><span>Skor</span><span>Signal</span>
      </div>
    `;

    const rows = top10
      .map((d, i) => `
        <div class="emiten-row">
          <span class="emiten-rank">${i + 1}</span>
          <span class="emiten-kode">${d.kode}<small>${d.entry === "NOW" ? "Entry: Now" : "Entry: " + (d.entry || "–")}</small></span>
          <span>${d.close ?? "–"}</span>
          <span>${d.score ?? "–"}</span>
          <span class="signal-pill ${signalPillClass(d.signal)}">${d.signal ?? "–"}</span>
        </div>
      `)
      .join("");

    el.innerHTML = `<div class="emiten-list">${head}${rows}</div>`;
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "Muat Data";
    el.innerHTML = `<div class="empty-state">Gagal memindai emiten: ${e.message}</div>`;
  }
}

document.getElementById("btnLoadTopEmiten").addEventListener("click", loadTopEmiten);

// ==========================================================
// Widget: Berita Penting
// ==========================================================

function newsAgeLabel(pubDate) {
  if (!pubDate) return "";
  const d = new Date(pubDate);
  if (isNaN(d.getTime())) return "";
  const hours = Math.round((Date.now() - d.getTime()) / (1000 * 60 * 60));
  if (hours < 1) return "Baru saja";
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.round(hours / 24)} hari lalu`;
}

async function loadMarketNews() {
  const el = document.getElementById("marketNewsWrap");

  try {
    const res = await fetch("/api/dashboard-data?type=news");
    const json = await res.json();
    if (!json.success) throw new Error(json.message || "Gagal memuat");

    if (!json.data.length) {
      el.innerHTML = `<div class="empty-state">Belum ada berita terbaru.</div>`;
      return;
    }

    const rows = json.data
      .map((n) => `
        <a class="news-row" href="${n.link || "#"}" target="_blank" rel="noopener noreferrer">
          <div class="news-title">${n.title}</div>
          <div class="news-meta">${n.source} · ${newsAgeLabel(n.pubDate)}</div>
        </a>
      `)
      .join("");

    el.innerHTML = `<div class="news-list">${rows}</div>`;
  } catch (e) {
    el.innerHTML = `<div class="empty-state">Gagal memuat berita: ${e.message}</div>`;
  }
}

// ==========================================================
// Init widget baru
// ==========================================================

loadIhsgChart(currentIhsgPeriod);
loadForeignFlow();
loadAsiaMarkets();
loadMarketNews();
