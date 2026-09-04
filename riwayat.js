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
    labelEl.textContent = "🌙 Market Tutup - Pastikan Screener di Jalankan Pada Waktu 15:30-15:45";
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
        <div class="stat-label">Akurasi prediksi (target +5%)</div>
        <div class="stat-value ${retClass(overall.lift_5pct)}">${overall.hit_rate_5pct ?? "–"}%</div>
        <div class="stat-note">dari ${(overall.total_prediksi ?? 0).toLocaleString("id-ID")} prediksi prioritas</div>
      </div>
      <div class="summary-stat">
        <div class="stat-label">Lift vs pasar</div>
        <div class="stat-value ${retClass(overall.lift_5pct)}">${overall.lift_5pct === null || overall.lift_5pct === undefined ? "–" : `${overall.lift_5pct >= 0 ? "+" : ""}${overall.lift_5pct} pp`}</div>
        <div class="stat-note">pasar ${overall.base_rate_5pct ?? "–"}% menyentuh +5%</div>
      </div>
      <div class="summary-stat">
        <div class="stat-label">Rata-rata puncak H+1</div>
        <div class="stat-value ${retClass(overall.avg_peak_pct)}">${fmtPct(overall.avg_peak_pct)}</div>
        <div class="stat-note">kalau ditahan sampai close: ${fmtPct(overall.avg_close_return_pct)}</div>
      </div>
      <div class="summary-stat">
        <div class="stat-label">Baris berlabel / total scan</div>
        <div class="stat-value">${overall.total_labeled.toLocaleString("id-ID")}</div>
        <div class="stat-note">dari ${overall.total_scan.toLocaleString("id-ID")} scan</div>
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

  // Di bawah 10 prediksi, hit rate harian tidak bisa dibaca — satu
  // saham saja menggeser angkanya belasan poin. Baris seperti itu tetap
  // ditampilkan (supaya tidak terlihat seperti data hilang) tapi diberi
  // tanda, bukan diwarnai seolah bermakna.
  const MIN_PREDIKSI = 10;

  // Model V4 dilatih dari data sampai 1 September 2026. Tanggal sampai
  // batas itu IN-SAMPLE: model sudah "melihat" hasilnya saat dikalibrasi,
  // jadi lift di hari-hari itu pasti terlihat lebih bagus dari performa
  // sebenarnya. Ini bukan kecurangan, cuma sifat data latih — tapi kalau
  // tidak ditandai, backfill akan terbaca seperti bukti keberhasilan.
  // Yang menentukan model bagus atau tidak adalah tanggal SETELAHNYA.
  const MODEL_FIT_UNTIL = "2026-09-01";

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

      if (!r.jumlah_prediksi) {
        return `
          <div class="trend-row">
            <span>${r.tanggal}</span>
            <div class="trend-bar-wrap"><div class="trend-bar" style="width:0%"></div></div>
            <span class="trend-pending">Tidak ada prediksi prioritas hari ini</span>
          </div>
        `;
      }

      const hit = r.hit_rate_5pct ?? 0;
      const thin = r.jumlah_prediksi < MIN_PREDIKSI;
      const inSample = r.tanggal <= MODEL_FIT_UNTIL;

      const liftText = Number.isFinite(Number(r.lift_5pct))
        ? `${r.lift_5pct >= 0 ? "+" : ""}${r.lift_5pct} vs pasar ${r.base_rate_5pct}%`
        : "";

      const detail = thin
        ? `${r.jumlah_prediksi} prediksi — sampel terlalu kecil`
        : `${r.jumlah_prediksi} prediksi · ${liftText}`;

      const sampleTag = inSample
        ? `<span class="in-sample-tag" title="Tanggal ini termasuk data latih model V4 — lift di sini lebih bagus dari performa sebenarnya">data latih</span>`
        : "";

      // PENTING: warna diambil dari LIFT, bukan dari hit rate.
      // pctClass() memberi hijau hanya di atas 50%, dan itu ambang yang
      // salah untuk metrik ini — hari terbaik model pun cuma sekitar
      // 42%, jadi semua hari akan tampil merah seolah selalu gagal.
      // Yang menentukan bagus/tidaknya adalah apakah prediksi
      // mengalahkan base rate pasar hari itu.
      const toneClass = thin ? "trend-pending" : retClass(r.lift_5pct);

      return `
        <div class="trend-row${inSample ? " is-in-sample" : ""}">
          <span>${r.tanggal}${sampleTag}</span>
          <div class="trend-bar-wrap"><div class="trend-bar" style="width:${hit}%"></div></div>
          <span class="${toneClass}">${r.hit_rate_5pct ?? "–"}%
            <small class="trend-secondary">${detail}</small>
          </span>
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

  // Bintang dulu dipasang dari next_day_opportunity_eligible, yang
  // sebelum V4 hanya bernilai true untuk HIGH — jadi MODERATE yang
  // sebenarnya punya setup tampil polos. Sekarang tier yang menentukan.
  const tier = row.next_day_conviction_tier;
  const star = tier === "PRIMARY" ? " ⭐" : tier === "SECONDARY" ? " ·" : "";

  const p5 = Number(row.next_day_opportunity_probability_5pct);
  // V4 mengganti target 10% dengan 8%; baris lama masih pakai kolom
  // 10pct, jadi dua-duanya dibaca supaya riwayat lama tetap terbaca.
  const p8 = Number(row.next_day_opportunity_probability_8pct);
  const p10 = Number(row.next_day_opportunity_probability_10pct);

  const p5Text = Number.isFinite(p5) ? `P5 ${p5.toFixed(0)}%` : "";
  const bigText = Number.isFinite(p8)
    ? ` · P8 ${p8.toFixed(0)}%`
    : Number.isFinite(p10)
      ? ` · P10 ${p10.toFixed(0)}%`
      : "";

  return `<span class="opp-pill ${cls}" title="${row.next_day_opportunity_setup_detail ?? ""}">${label}${star}<br><small>${p5Text}${bigText}</small></span>`;
}

function fadeRiskPill(row) {
  const risk = row.next_day_fade_risk;
  if (!risk) return `<span class="pattern-pill">–</span>`;

  const cls = risk === "HIGH" ? "low" : risk === "MODERATE" ? "watch" : "moderate";
  const plan = row.next_day_exit_plan === "JUAL_DI_TARGET"
    ? "jual di target"
    : row.next_day_exit_plan === "BOLEH_TAHAN_SAMPAI_CLOSE"
      ? "boleh ditahan"
      : row.next_day_exit_plan === "JUAL_SEPARUH_DI_TARGET"
        ? "jual separuh"
        : "";

  return `<span class="opp-pill ${cls}">${risk}${plan ? `<br><small>${plan}</small>` : ""}</span>`;
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

// ==========================
// Watchlist Besok — tombol ➕ per baris
// ==========================
// Key sama dengan yang dipakai watchlist.js, supaya item yang
// ditambahkan dari sini langsung muncul di halaman Watchlist Besok.

const WATCHLIST_KEY = "sahamai_watchlist_besok";

function addToWatchlist(kode, scanDate, closePrice) {
  let list = [];
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    list = raw ? JSON.parse(raw) : [];
  } catch (e) {
    list = [];
  }

  list.unshift({
    id: `${kode}_${scanDate}_${Date.now()}`,
    kode: String(kode).toUpperCase().trim(),
    scan_date: scanDate,
    entry_price: Number(closePrice) || null,
    added_at: new Date().toISOString(),
    status: "WATCHING",
    exit_price: null,
    exit_time: null,
    last: null
  });

  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
}

function renderHistoryTable(rows) {
  const el = document.getElementById("historyTableWrap");

  if (!rows || rows.length === 0) {
    const dateEl = document.getElementById("dateFilter");
    const activeDate = dateEl?.value || "";
    el.innerHTML = activeDate
      ? `<div class="empty-state">
           Tidak ada data scan untuk tanggal ${activeDate}.
           <br><button class="btn-mini" id="btnShowAllDates" style="margin-top:8px">Tampilkan semua tanggal</button>
         </div>`
      : `<div class="empty-state">Tidak ada data untuk filter ini.</div>`;
    return;
  }

  const body = rows
    .map((r) => `
      <tr>
        <td>${r.scan_date}</td>
        <td><strong>${r.kode}</strong></td>
        <td>${opportunityPill(r)}</td>
        <td>${r.signal ?? "–"}${r.distribution_flag ? ` <span class="distribution-flag" title="Peluang naik rendah dan ada indikasi jual besar-besaran">⚠ Distribusi Terdeteksi</span>` : ""}</td>
        <td>${r.score ?? "–"}</td>
        <td>${r.next_day_entry_quality_score ?? "–"} ${r.next_day_entry_quality_label ? `(${r.next_day_entry_quality_label})` : ""}</td>
        <td>${r.close ?? "–"}</td>
        <td>${r.actual_next_high ?? "–"}</td>
        <td>${r.actual_next_close ?? "–"}</td>
        <td class="${retClass(r.next_day_max_gain_from_close_pct)}">${fmtPct(r.next_day_max_gain_from_close_pct)}</td>
        <td class="${retClass(r.next_day_close_return_from_close_pct)}">${fmtPct(r.next_day_close_return_from_close_pct)}</td>
        <td>${fadeRiskPill(r)}</td>
        <td>${regimeBadge(r.market_regime)}</td>
        <td>${patternBadges(r)}</td>
        <td>${statusPill(r)}</td>
        <td><button class="btn-mini btn-add-watchlist" data-kode="${r.kode}" data-scandate="${r.scan_date}" data-close="${r.close ?? ""}" title="Tambah ke Watchlist Besok">➕</button></td>
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
            <th>Max Gain% (peak H+1)</th><th>Return% (sampai close)</th>
            <th>Fade Risk</th>
            <th>Regime</th><th>Pola</th><th>Hasil</th><th>Aksi</th>
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

// ==========================
// Filter tabel riwayat (3 September 2026)
// ==========================
//
// MASALAH YANG DIPERBAIKI: tabel dulu selalu memanggil
// /api/history?view=table&limit=100 diurutkan tanggal terbaru. Satu
// hari scan berisi ±400 emiten, jadi 100 baris itu potongan sembarang
// dari SATU hari yang sama — tidak mungkin mencari "yang skornya
// tinggi" atau "yang besoknya naik >5%" tanpa export CSV dulu.
//
// Semua filter di bawah dikirim ke server (PostgREST), bukan disaring
// di browser, supaya HP tidak perlu menarik ribuan baris.

const PAGE_SIZE = 100;
let tableOffset = 0;
let tableRows = [];

function readTableFilters() {
  const val = (id) => document.getElementById(id)?.value?.trim() || "";
  return {
    kode: val("kodeFilter").toUpperCase(),
    tier: val("tierFilter"),
    opportunity: val("oppFilter"),
    minOpportunityScore: val("minOppFilter"),
    entryDecision: val("entryFilter"),
    outcome: val("outcomeFilter"),
    pattern: val("patternFilter"),
    sort: val("sortFilter") || "date",
    date: val("dateFilter"),
    sinceDate: val("sinceFilter"),
    untilDate: val("untilFilter"),
    onlyLabeled: val("labeledFilter")
  };
}

function buildTableParams(extra = {}) {
  const f = readTableFilters();
  const params = new URLSearchParams({ view: "table" });

  if (f.kode) params.set("kode", f.kode);
  if (f.tier) params.set("tier", f.tier);
  if (f.opportunity) params.set("opportunity", f.opportunity);
  if (f.minOpportunityScore) params.set("minOpportunityScore", f.minOpportunityScore);
  if (f.entryDecision) params.set("entryDecision", f.entryDecision);
  if (f.outcome) params.set("outcome", f.outcome);
  if (f.pattern) params.set("pattern", f.pattern);
  if (f.sort && f.sort !== "date") params.set("sort", f.sort);
  if (f.date) params.set("date", f.date);
  if (!f.date && f.sinceDate) params.set("sinceDate", f.sinceDate);
  if (!f.date && f.untilDate) params.set("untilDate", f.untilDate);
  if (f.onlyLabeled === "true") params.set("onlyLabeled", "true");

  for (const [k, v] of Object.entries(extra)) params.set(k, String(v));
  return params;
}

function updateRowCountNotice({ shown, total, hasMore }) {
  const el = document.getElementById("rowCountNotice");
  if (!el) return;

  if (!total) {
    el.textContent = "Tidak ada baris yang cocok dengan filter ini.";
    return;
  }

  el.textContent = shown < total
    ? `Menampilkan ${shown} dari ${total} baris yang cocok.`
    : `Menampilkan seluruh ${total} baris yang cocok.`;

  const more = document.getElementById("btnLoadMore");
  if (more) more.style.display = hasMore ? "" : "none";
}

async function loadTable({ append = false } = {}) {
  const el = document.getElementById("historyTableWrap");

  if (!append) {
    tableOffset = 0;
    tableRows = [];
    el.innerHTML = `<div class="empty-state">Memuat…</div>`;
  }

  const params = buildTableParams({ limit: PAGE_SIZE, offset: tableOffset });

  try {
    const payload = await fetchJSON(`/api/history?${params.toString()}`);
    const rows = payload.data || [];

    tableRows = append ? tableRows.concat(rows) : rows;
    tableOffset = tableRows.length;

    renderHistoryTable(tableRows);
    updateRowCountNotice({
      shown: tableRows.length,
      total: payload.total ?? tableRows.length,
      hasMore: payload.hasMore === true
    });
  } catch (e) {
    el.innerHTML = `<div class="empty-state">Gagal memuat tabel: ${e.message}</div>`;
  }
}

function resetTableFilters() {
  ["kodeFilter", "tierFilter", "oppFilter", "minOppFilter", "entryFilter",
   "outcomeFilter", "patternFilter", "dateFilter", "sinceFilter",
   "untilFilter", "labeledFilter"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const sortEl = document.getElementById("sortFilter");
  if (sortEl) sortEl.value = "date";
  showTableDateNotice("");
  loadTable();
}

function exportCsv() {
  // Export mengikuti PERSIS filter yang sedang aktif di layar. Tanpa
  // &limit, endpoint menarik semua baris yang cocok lewat loop paginasi.
  window.location.href = `/api/history?${buildTableParams({ format: "csv" }).toString()}`;
}

// Setiap select memuat ulang tabel begitu diubah — di HP, menekan
// "Terapkan Filter" setelah tiap pilihan terasa berulang. Input teks
// (kode) sengaja di-debounce, bukan per-ketikan, supaya tidak
// menembak request tiap huruf.
["tierFilter", "oppFilter", "minOppFilter", "entryFilter",
 "outcomeFilter", "patternFilter", "sortFilter", "labeledFilter"].forEach((id) => {
  document.getElementById(id)?.addEventListener("change", () => loadTable());
});

let kodeDebounce = null;
document.getElementById("kodeFilter")?.addEventListener("input", () => {
  clearTimeout(kodeDebounce);
  kodeDebounce = setTimeout(() => loadTable(), 400);
});

["sinceFilter", "untilFilter"].forEach((id) => {
  document.getElementById(id)?.addEventListener("change", () => loadTable());
});

document.getElementById("dateFilter")?.addEventListener("change", () => {
  showTableDateNotice("");
  loadTable();
});

document.getElementById("btnLoadMore")?.addEventListener("click", () => {
  loadTable({ append: true });
});

document.getElementById("btnResetFilter")?.addEventListener("click", resetTableFilters);

// Tombol di empty-state: kosongkan filter tanggal lalu muat ulang, supaya
// user tidak perlu menghapus isi input tanggal secara manual di HP.
document.addEventListener("click", (e) => {
  if (!e.target.closest("#btnShowAllDates")) return;
  const dateEl = document.getElementById("dateFilter");
  if (dateEl) dateEl.value = "";
  showTableDateNotice("");
  loadTable();
});
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

// ==========================
// Backfill V4 ke seluruh riwayat
// ==========================
//
// /api/relabel-high-low?target=model-sync menghitung ulang score dan
// Next-Day Opportunity dari kolom snapshot yang SUDAH tersimpan di baris
// itu — tanpa fetch Yahoo sama sekali. Jadi seluruh riwayat bisa
// dinilai ulang pakai aturan V4, tidak perlu menunggu scan baru.
//
// Dijalankan SATU TANGGAL PER REQUEST, bukan sekaligus: fungsi Vercel
// dibatasi 60 detik (maxDuration di api/relabel-high-low.js) dan satu
// hari saja sudah ±400 baris. Melempar 13.000 baris dalam satu request
// akan timeout di tengah jalan dan meninggalkan data setengah jadi.
async function backfillAllDates() {
  const btn = document.getElementById("btnBackfillV4");
  const oldText = btn.textContent;

  if (!confirm(
    "Hitung ulang seluruh riwayat dengan aturan Opportunity V4?\n\n" +
    "Ini MENIMPA kolom score, signal dan Next-Day Opportunity di semua " +
    "baris — kolom hasil aktual (actual_next_*, max gain, return) tidak " +
    "disentuh. Prosesnya beberapa menit, jangan tutup halaman."
  )) return;

  btn.disabled = true;

  try {
    // Daftar tanggal diambil dari ringkasan yang sudah dimuat halaman ini,
    // bukan endpoint baru.
    const { data } = await fetchJSON(`/api/history?view=summary`);
    const dates = (data?.by_date || []).map((r) => r.tanggal).sort().reverse();

    if (!dates.length) {
      alert("Tidak ada tanggal scan yang bisa diproses.");
      return;
    }

    let processed = 0;
    let changed = 0;
    const failedDates = [];

    for (let i = 0; i < dates.length; i++) {
      btn.textContent = `⏳ ${i + 1}/${dates.length} · ${dates[i]}`;
      try {
        const res = await fetch(`/api/relabel-high-low?target=model-sync&manual=1&date=${dates[i]}`);
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.message || `HTTP ${res.status}`);
        processed += json.processed || 0;
        changed += json.changedOpportunity || 0;
      } catch (e) {
        // Satu tanggal gagal tidak menghentikan sisanya — dicatat dan
        // dilaporkan di akhir supaya bisa diulang per tanggal.
        failedDates.push(dates[i]);
      }
    }

    alert(
      `Selesai. ${processed} baris dihitung ulang, ${changed} label Opportunity berubah.` +
      (failedDates.length
        ? `\n\nGagal di ${failedDates.length} tanggal: ${failedDates.slice(0, 8).join(", ")}` +
          `\nUlangi per tanggal lewat filter "Tanggal scan (persis)" lalu tombol Sinkronkan Score.`
        : "")
    );

    await loadSummary();
    await loadTable();
  } catch (e) {
    alert(`Backfill gagal: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

document.getElementById("btnBackfillV4")?.addEventListener("click", backfillAllDates);

document.getElementById("btnRefresh").addEventListener("click", loadSummary);
document.getElementById("btnLoadTable").addEventListener("click", () => loadTable());
document.getElementById("btnExportCsv").addEventListener("click", exportCsv);

// Isi TANGGAL SCAN secara default begitu halaman dibuka, supaya orang
// langsung sadar field itu untuk filter tanggal.
//
// PENTING (perbaikan): dulu default-nya dipaksa ke tanggal HARI INI (WIB).
// Padahal cron /api/scan baru jalan ~16:40 WIB dan tidak jalan di akhir
// pekan/libur bursa — jadi setiap kali halaman dibuka pagi/siang, atau
// Sabtu/Minggu, filter tanggal menunjuk ke hari yang memang belum punya
// baris sama sekali, dan tabel selalu tampil "Tidak ada data untuk filter
// ini" walau database-nya penuh. Sekarang tanggal default diambil dari
// TANGGAL SCAN TERAKHIR yang benar-benar ada di database.
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

// Ambil tanggal scan paling baru yang ada di database. Query diurutkan
// scan_date.desc di dataLogService, jadi cukup minta 1 baris.
async function fetchLatestScanDate() {
  try {
    const { data } = await fetchJSON(`/api/history?view=table&limit=1`);
    return data && data.length ? data[0].scan_date : null;
  } catch (e) {
    return null;
  }
}

function showTableDateNotice(text) {
  const el = document.getElementById("tableDateNotice");
  if (!el) return;
  if (!text) {
    el.style.display = "none";
    el.textContent = "";
    return;
  }
  el.style.display = "";
  el.textContent = text;
}

// Bootstrap tabel: tentukan tanggal default dari data nyata, baru muat tabel.
async function initHistoryTable() {
  const dateEl = document.getElementById("dateFilter");
  const wrap = document.getElementById("historyTableWrap");
  if (!dateEl) return;

  if (wrap) wrap.innerHTML = `<div class="empty-state">Memuat…</div>`;

  // Kalau user sudah sempat mengisi sendiri (mis. reload dengan value
  // tersimpan browser), hormati pilihannya dan langsung muat.
  if (dateEl.value) {
    await loadTable();
    return;
  }

  const latest = await fetchLatestScanDate();

  if (!latest) {
    // Belum ada data sama sekali — biarkan kosong supaya loadTable()
    // menampilkan seluruh baris terbaru lintas tanggal (bukan 0 baris).
    dateEl.value = "";
    await loadTable();
    return;
  }

  dateEl.value = latest;

  const today = todayWibDateInputValue();
  if (latest !== today) {
    showTableDateNotice(
      `Scan untuk ${today} belum tersedia — menampilkan data scan terakhir: ${latest}.`
    );
  } else {
    showTableDateNotice("");
  }

  await loadTable();
}

loadSummary();
initHistoryTable();

// Delegated click handler untuk tombol ➕ tambah ke Watchlist Besok
// (event delegation di document supaya tetap jalan walau tabel
// di-render ulang tiap ganti filter).
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-add-watchlist");
  if (!btn) return;

  const kode = btn.dataset.kode;
  const scanDate = btn.dataset.scandate;
  const close = btn.dataset.close;

  addToWatchlist(kode, scanDate, close);

  const original = btn.textContent;
  btn.textContent = "✅";
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = original;
    btn.disabled = false;
  }, 1200);
});
