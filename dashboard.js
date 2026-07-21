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
            <th>Close</th><th>Next Open</th><th>Return</th><th>Hasil</th>
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
