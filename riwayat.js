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
    labelEl.textContent = "🟡 Jendela Beli Sore — Siapkan Entry Overnight Sebelum Tutup";
  } else if (minutesNow >= marketOpen && minutesNow < buyWindowStart) {
    barEl.classList.add("market-open");
    labelEl.textContent = "Market Berjalan — Belum Masuk Jendela Beli Sore";
  } else if (minutesNow >= preMarket &&minutesNow < marketOpen) {
    barEl.classList.add("market-open");
    labelEl.textContent = "Pra-market — Bursa Belum Buka";
  } else {
    barEl.classList.add("overnight");
    labelEl.textContent = "🌙 Market Tutup - Pastikan Screener Di Jalan Pada Waktu 15:30-15:45";
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
// Render: ringkasan kalibrasi beli sore -> jual pagi/close
// ==========================

function renderOverallOpportunity(o) {
  const el = document.getElementById("summaryOpportunity");
  if (!el) return;

  if (!o || o.total_labeled === 0) {
    el.innerHTML = `<div class="empty-state">Belum ada data yang sudah dilabel Tahap 2 (close). Tunggu cron /api/label-outcomes-close jalan beberapa hari dulu.</div>`;
    return;
  }

  el.innerHTML = `
    <div class="summary-grid">
      <div class="summary-stat">
        <div class="stat-label">Total Prediksi Dilabel (close)</div>
        <div class="stat-value">${o.total_labeled.toLocaleString("id-ID")}</div>
      </div>
      <div class="summary-stat">
        <div class="stat-label">Win Rate (target +3% sesi 1 / +2% close)</div>
        <div class="stat-value ${pctClass(o.win_rate)}">${o.win_rate ?? "–"}%</div>
      </div>
      <div class="summary-stat">
        <div class="stat-label">Avg Return (tahan sampai close)</div>
        <div class="stat-value ${retClass(o.avg_return_pct)}">${fmtPct(o.avg_return_pct)}</div>
      </div>
      <div class="summary-stat">
        <div class="stat-label">Avg Max Gain (titik terbaik sesi 1/H+1)</div>
        <div class="stat-value ${retClass(o.avg_max_gain_pct)}">${fmtPct(o.avg_max_gain_pct)}</div>
      </div>
    </div>
  `;
}

function renderEligibleVsNot(data) {
  const el = document.getElementById("eligibleVsNot");
  if (!el) return;
  if (!data) {
    el.innerHTML = `<div class="empty-state">Belum ada data.</div>`;
    return;
  }

  const rows = [
    { label: "⭐ Eligible (lolos semua hard-check)", ...data.eligible },
    { label: "Tidak Eligible", ...data.not_eligible }
  ];

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

// Status hasil strategi beli sore -> jual pagi/close, basis
// next_day_success (lihat catatan di engine/evaluationStats.js &
// api/label-outcomes-close.js) — BUKAN gap_up_realized (itu proxy lama
// berbasis open H+1, dipakai di sinyal umum, bukan strategi ini).
function statusPill(row) {
  if (row.next_day_success === null || row.next_day_success === undefined) {
    return `<span class="result-pill pending">Belum dilabel</span>`;
  }
  return row.next_day_success
    ? `<span class="result-pill win">Kena Target</span>`
    : `<span class="result-pill loss">Meleset</span>`;
}

function opportunityPill(row) {
  const label = row.next_day_opportunity_label;
  if (!label) return `<span class="pattern-pill">–</span>`;
  const cls = label.toLowerCase();
  const star = row.next_day_opportunity_eligible ? " ⭐" : "";
  return `<span class="opp-pill ${cls}">${label}${star}</span>`;
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
        <td>${opportunityPill(r)}</td>
        <td>${r.signal ?? "–"}</td>
        <td>${r.score ?? "–"}</td>
        <td>${r.next_day_entry_quality_score ?? "–"} ${r.next_day_entry_quality_label ? `(${r.next_day_entry_quality_label})` : ""}</td>
        <td>${r.close ?? "–"}</td>
        <td>${r.actual_next_high ?? "–"}</td>
        <td>${r.actual_next_close ?? "–"}</td>
        <td class="${retClass(r.next_day_max_gain_from_close_pct)}">${fmtPct(r.next_day_max_gain_from_close_pct)}</td>
        <td class="${retClass(r.next_day_close_return_from_close_pct)}">${fmtPct(r.next_day_close_return_from_close_pct)}</td>
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
            <th>Tanggal</th><th>Kode</th><th>Opportunity</th><th>Signal</th><th>Score</th><th>Entry Quality</th>
            <th>Close (beli sore)</th><th>High H+1</th><th>Close H+1</th>
            <th>Max Gain% (sesi 1)</th><th>Return% (sampai close)</th>
            <th>Regime</th><th>Pola</th><th>Hasil</th>
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
document.getElementById("btnSyncModel").addEventListener("click", async () => {
  const date = document.getElementById("dateFilter").value;
  const kode = document.getElementById("kodeFilter").value.trim().toUpperCase();

  if (!date && !kode) {
    alert("Pilih tanggal scan atau kode saham terlebih dahulu. Untuk sinkronisasi data 13 Agustus, pilih 2026-08-13.");
    return;
  }

  const target = date ? `tanggal ${date}` : `kode ${kode}`;
  if (!confirm(`Sinkronkan ulang score, signal, dan Next-Day Opportunity untuk ${target} menggunakan scorer aktif?`)) return;

  const btn = document.getElementById("btnSyncModel");
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "⏳ Sinkronisasi…";

  try {
    const params = new URLSearchParams({ target: "model-sync", manual: "1" });
    if (date) params.set("date", date);
    if (kode) params.set("kode", kode);

    const res = await fetch(`/api/relabel-high-low?${params.toString()}`);
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.message || "Sinkronisasi gagal.");

    alert(`Sinkronisasi selesai. ${json.processed} baris diproses; ${json.changedScore} score berubah dan ${json.changedSignal} signal berubah.`);
    await loadSummary();
    await loadTable();
  } catch (e) {
    alert(`Sinkronisasi gagal: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
});

document.getElementById("btnRefresh").addEventListener("click", loadSummary);
document.getElementById("btnLoadTable").addEventListener("click", loadTable);
document.getElementById("btnExportCsv").addEventListener("click", exportCsv);

// DRAFT (21 Agustus 2026, atas instruksi user): isi TANGGAL SCAN dengan
// tanggal hari ini (WIB) secara default begitu halaman dibuka — dulu
// kosong, jadi orang tidak langsung sadar field itu untuk filter tanggal.
// Pakai Intl dgn timeZone Asia/Jakarta (bukan local device time) supaya
// konsisten walau device user di zona waktu lain.
function todayWibDateInputValue() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const y = parts.find(p => p.type === "year").value;
  const m = parts.find(p => p.type === "month").value;
  const d = parts.find(p => p.type === "day").value;
  return `${y}-${m}-${d}`;
}

const dateFilterEl = document.getElementById("dateFilter");
if (dateFilterEl && !dateFilterEl.value) {
  dateFilterEl.value = todayWibDateInputValue();
}

loadSummary();
loadTable();
