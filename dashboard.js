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
    labelEl.textContent = "🌙 Market Tutup - Pastikan Screener Di Jalan Pada Waktu 15:30-15:45";
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
// Scan health banner
// ==========================
// Ditambahkan 21 Agustus 2026 setelah insiden scan 20 Agustus kosong
// (baru ketahuan sehari kemudian lewat Riwayat AI). Cek /api/dashboard-data
// ?type=scanhealth setiap buka Dashboard, tampilkan banner merah kalau
// scan hari bursa terakhir masih 0 baris sesudah jam 17:00 WIB.
async function loadScanHealth() {
  const el = document.getElementById("scanHealthBanner");
  if (!el) return;

  try {
    const res = await fetch("/api/dashboard-data?type=scanhealth");
    const json = await res.json();
    if (!json.success) return;

    const { checkDate, warning } = json.data;
    if (warning) {
      el.style.display = "flex";
      el.innerHTML = `⚠️ Scan untuk ${checkDate} belum ada datanya — cron kemungkinan gagal/belum jalan. Cek log Vercel atau jalankan <code>/api/scan?force=true</code> manual.`;
    } else {
      el.style.display = "none";
    }
  } catch (e) {
    // Best-effort — jangan ganggu dashboard kalau cek ini sendiri gagal.
  }
}

loadScanHealth();

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

// Bangun daftar alasan POSITIF kenapa emiten ini layak dilihat sekarang,
// diurutkan dari sinyal yang paling kuat dasarnya. Dua alasan teratas
// (capitulationBounceCandidate & reversalCandidate) sengaja menyebutkan
// angka validasi historisnya secara eksplisit — supaya jelas alasannya
// BUKAN cuma skor AI biasa, tapi memang pola yang sama dengan yang
// ditemukan dari analisis 5.692 baris scan_history (7 Agustus 2026).
// Lihat catatan lengkap di engine/scorer.js & engine/gapCalibration.js.
function buildReasons(d) {
  const reasons = [];

  if (d.capitulationBounceCandidate) {
    reasons.push({
      icon: "⚡",
      text: "Pola Capitulation Bounce: RSI netral (40–55), MACD masih negatif, saham lagi underperform pasar — tapi closing strength masih kuat. Pola PERSIS SAMA ditemukan pada 41 dari 103 saham yang historisnya naik >5% besoknya walau H-1 masih HOLD/SELL. Divalidasi balik ke seluruh histori: rata-rata gain intraday 2,45% vs baseline 1,76%."
    });
  }

  if (d.reversalCandidate) {
    reasons.push({
      icon: "🔄",
      text: "Pola Reversal Candidate: RSI netral, MACD negatif, tapi harga masih di atas SMA50 dan closing strength menunjukkan pembeli mulai masuk — indikasi tren turun mulai kehabisan tenaga."
    });
  }

  if (d.breakout?.isBreakout) {
    const pct = typeof d.breakout.distancePercent === "number" ? ` (+${d.breakout.distancePercent.toFixed(1)}% dari level breakout)` : "";
    reasons.push({ icon: "🚀", text: `${d.breakout.level === "STRONG_BREAKOUT" ? "Strong breakout" : "Breakout"} dari resistance${pct}.` });
  }

  if (d.relativeStrength && (d.relativeStrength.label === "OUTPERFORM" || d.relativeStrength.label === "JAUH OUTPERFORM")) {
    reasons.push({ icon: "📈", text: `${d.relativeStrength.label === "JAUH OUTPERFORM" ? "Jauh outperform" : "Outperform"} IHSG — lebih kuat dari pasar secara umum.` });
  }

  if (d.volumeAcceleration?.accelerating) {
    reasons.push({ icon: "📊", text: "Volume beli makin deras dibanding hari-hari sebelumnya (akselerasi volume positif)." });
  }

  if (typeof d.gap?.probability !== "undefined" && d.gap?.calibrationApplied && parseFloat(String(d.gap.probability)) >= 60) {
    reasons.push({ icon: "🌅", text: `Probabilitas gap up besok pagi ${d.gap.probability}, berdasarkan ${d.gap.bucketSampleCount ?? "banyak"} kejadian historis serupa.` });
  }

  if (typeof d.riskReward === "number" && d.riskReward >= 2) {
    reasons.push({ icon: "⚖️", text: `Risk/reward menarik (1:${d.riskReward.toFixed(1)}).` });
  }

  return reasons;
}

function renderEmitenCard(d, i) {
  const reasons = buildReasons(d);
  const hasStrongSignal = reasons.length > 0;

  const badges = `
    ${d.capitulationBounceCandidate ? `<span class="pattern-pill">⚡ Capitulation Bounce</span>` : ""}
    ${d.reversalCandidate ? `<span class="pattern-pill">🔄 Reversal Candidate</span>` : ""}
    ${d.breakout?.isBreakout ? `<span class="pattern-pill">🚀 Breakout</span>` : ""}
    ${d.relativeStrength && (d.relativeStrength.label === "OUTPERFORM" || d.relativeStrength.label === "JAUH OUTPERFORM") ? `<span class="pattern-pill">📈 RS ${d.relativeStrength.label}</span>` : ""}
  `;

  // "Kenapa layak dibeli sekarang": rangkai maks 2 alasan teratas jadi
  // penjelasan singkat. Kalau tidak ada sinyal kuat sama sekali (cuma
  // lolos filter harga & skor biasa), jujur tampilkan itu — jangan
  // dipaksakan seolah-olah ada alasan kuat padahal tidak ada.
  const explanation = hasStrongSignal
    ? `<div class="emiten-reason">${reasons.slice(0, 2).map(r => `<div class="reason-line"><span class="reason-icon">${r.icon}</span>${r.text}</div>`).join("")}</div>`
    : `<div class="emiten-reason emiten-reason-weak">Lolos filter harga &amp; skor, tapi belum ada pola kuat (breakout/RS/reversal/capitulation) yang terdeteksi — masuk kategori HOLD, bukan sinyal beli kuat.</div>`;

  return `
    <div class="emiten-card">
      <div class="emiten-card-head">
        <span class="emiten-rank">${i + 1}</span>
        <span class="emiten-kode">${d.kode}<small>${d.entry === "NOW" ? "Entry: Now" : "Entry: " + (d.entry || "–")}</small></span>
        <span class="emiten-close">${d.close ?? "–"}</span>
        <span class="emiten-score">${d.score ?? "–"}</span>
        <span class="signal-pill ${signalPillClass(d.signal)}">${d.signal ?? "–"}</span>
      </div>
      ${badges.trim() ? `<div class="emiten-badges">${badges}</div>` : ""}
      ${explanation}
    </div>
  `;
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

    const cards = top10.map((d, i) => renderEmitenCard(d, i)).join("");

    el.innerHTML = `<div class="emiten-list">${cards}</div>`;
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
