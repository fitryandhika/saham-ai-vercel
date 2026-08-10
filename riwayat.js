// ==========================
// Jam WIB & Jendela Trading (sama seperti script.js/portfolio.js/dashboard.js)
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

function patternBadges(row) {
  const badges = [];
  if (row.reversal_candidate) badges.push(`<span class="pattern-pill reversal">🔄 Reversal</span>`);
  if (row.capitulation_bounce_candidate) badges.push(`<span class="pattern-pill reversal">⚡ Capitulation</span>`);
  return badges.length ? badges.join(" ") : "–";
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
        <td>${r.actual_next_high ?? "–"}</td>
        <td class="${retClass(r.max_gain_from_open_pct)}">${fmtPct(r.max_gain_from_open_pct)}</td>
        <td class="${retClass(r.next_day_return_pct)}">${fmtPct(r.next_day_return_pct)}</td>
        <td>${regimeBadge(r.market_regime)}</td>
        <td>${patternBadges(r)}</td>
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
            <th>Close</th><th>Next Open</th><th>High</th><th>Max Gain%</th><th>Return</th><th>Regime</th><th>Pola</th><th>Hasil</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

// ==========================
// Filter periode (pill 7/30/90 hari / semua)
// ==========================
//
// Pill cuma cara cepat untuk mengisi #sinceDate (input tanggal manual
// yang sudah ada) — bukan mekanisme terpisah, supaya /api/history
// ?sinceDate=... yang sudah ada dari awal tetap satu-satunya sumber
// kebenaran filter, tidak ada 2 state yang bisa tidak sinkron.

function setActivePill(days) {
  document.querySelectorAll(".period-pill").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.days === days);
  });
}

function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

document.getElementById("periodFilter").addEventListener("click", (e) => {
  const btn = e.target.closest(".period-pill");
  if (!btn) return;

  const days = btn.dataset.days;
  setActivePill(days);

  const sinceDateInput = document.getElementById("sinceDate");
  sinceDateInput.value = days ? daysAgoIso(Number(days)) : "";

  loadSummary();
});

// Kalau user isi tanggal manual sendiri (bukan lewat pill), matikan
// highlight pill supaya tidak menyesatkan seolah masih di preset 30/90
// hari padahal sudah custom.
document.getElementById("sinceDate").addEventListener("change", () => {
  setActivePill(null);
});

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
  const pattern = document.getElementById("patternFilter")?.value || "";
  const date = document.getElementById("dateFilter")?.value || "";
  const params = new URLSearchParams({ view: "table", limit: "100" });
  if (kode) params.set("kode", kode);
  if (pattern) params.set("pattern", pattern);
  if (date) params.set("date", date);

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

document.getElementById("patternFilter")?.addEventListener("change", loadTable);
document.getElementById("dateFilter")?.addEventListener("change", loadTable);
document.getElementById("btnRefresh").addEventListener("click", loadSummary);
document.getElementById("btnLoadTable").addEventListener("click", loadTable);
document.getElementById("btnExportCsv").addEventListener("click", exportCsv);

loadSummary();
loadTable();
