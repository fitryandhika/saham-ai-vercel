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
// Badge Regime Market (layer makro)
// ==========================
// Baca /api/macro-latest (read-only, tidak fetch FRED/Yahoo ulang) lalu
// tampilkan sebagai badge kecil di bawah windowBar. Best-effort — kalau
// gagal/belum ada data, badge tetap netral, tidak mengganggu fitur lain.

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

function nextDayDecisionMeta(d) {
  const n = getNextDayOpportunityMeta(d);

  if (n.score === null) {
    return {
      className: "avoid",
      label: "Next-Day Opportunity",
      text: "Data Next-Day belum tersedia.",
      note: "Jangan gunakan Signal/Score lama sebagai alasan entry."
    };
  }

  if (!n.eligible) {
    return {
      className: "avoid",
      label: "Next-Day Opportunity · H+1",
      text: "🔴 TIDAK ADA SETUP H+1 YANG VALID",
      note: n.blockers.length ? `Penghambat: ${n.blockers.join(", ")}.` : "Setup H+1 belum memenuhi hard-check."
    };
  }

  if (n.entryDecision === "BUY_NOW" && n.entryEligible) {
    return {
      className: "buy",
      label: "Trade Decision · Beli Sore / Jual Pagi",
      text: "🟢 PRIORITAS — BUY SORE",
      note: "Opportunity H+1 kuat dan kualitas harga saat ini masih layak untuk entry."
    };
  }

  if (n.entryDecision === "WAIT_PULLBACK") {
    return {
      className: "monitor",
      label: "Trade Decision · Beli Sore / Jual Pagi",
      text: "🟡 WAIT PULLBACK — JANGAN KEJAR",
      note: "Peluang H+1 masih ada, tetapi harga sekarang sudah terlalu agresif untuk entry langsung."
    };
  }

  if (n.entryDecision === "WATCH") {
    return {
      className: "monitor",
      label: "Trade Decision · Beli Sore / Jual Pagi",
      text: "🟡 PANTAU — ENTRY BELUM IDEAL",
      note: "Opportunity ada, tetapi kualitas entry belum cukup baik."
    };
  }

  return {
    className: "avoid",
    label: "Trade Decision · Beli Sore / Jual Pagi",
    text: "🔴 JANGAN ENTRY — CHASE RISK TINGGI",
    note: "Peluang H+1 boleh tetap tinggi, tetapi harga sekarang tidak layak dikejar."
  };
}

function trendClass(trend) {
  if (trend === "BULLISH") return "bullish";
  if (trend === "BEARISH") return "bearish";
  return "sideways";
}

// ==========================
// ARA/ARB — batas Auto Rejection Atas/Bawah BEI
// ==========================
// Aturan per Surat Keputusan Direksi BEI No. Kep-00003/BEI/04-2025,
// efektif 8 April 2025: ARA berjenjang per fraksi harga, ARB flat 15%
// untuk semua rentang harga. Ini estimasi INFORMASIONAL dari harga
// close (bukan acuan resmi order matching — cek aplikasi sekuritas
// untuk angka pasti, terutama untuk saham baru IPO yang batasnya beda).
function getAraArb(close) {
  let araPct;
  if (close <= 200) araPct = 0.35;
  else if (close <= 5000) araPct = 0.25;
  else araPct = 0.20;

  const arbPct = 0.15;

  return {
    araPct,
    arbPct,
    ara: Math.round(close * (1 + araPct)),
    arb: Math.round(close * (1 - arbPct))
  };
}

function renderAraArb(close) {
  if (typeof close !== "number" || close <= 0) return "";

  const { araPct, arbPct, ara, arb } = getAraArb(close);

  return `
    <div class="aa-box">
      <div class="aa-title">Estimasi Batas ARA/ARB Sesi Berikutnya</div>
      <div class="aa-bar-wrap"><div class="aa-marker"></div></div>
      <div class="aa-labels">
        <span class="aa-arb">
          <span class="aa-value">${arb.toLocaleString("id-ID")}</span>
          <span class="aa-pct">ARB -${Math.round(arbPct * 100)}%</span>
        </span>
        <span class="aa-ara">
          <span class="aa-value">${ara.toLocaleString("id-ID")}</span>
          <span class="aa-pct">ARA +${Math.round(araPct * 100)}%</span>
        </span>
      </div>
      <div class="aa-note">Dihitung dari close hari ini (${close.toLocaleString("id-ID")}) — estimasi, bukan acuan resmi order matching.</div>
    </div>
  `;
}


function getNextDayOpportunityMeta(d) {
  const n = d?.nextDayOpportunity;
  if (!n || typeof n !== "object") {
    return {
      score: null, label: "UNAVAILABLE", expectedMoveBand: "UNAVAILABLE", setup: "NONE",
      eligible: false, entryEligible: false, entryQualityScore: null, entryQualityLabel: "UNAVAILABLE",
      chaseRisk: "UNAVAILABLE", entryDecision: "NO_SETUP", tradeDecision: "NO_SETUP", blockers: [],
      volumeAcceleration: null, volumeRatio: null, breakoutDistance: null, rsLabel: null,
      opportunityProbability: null
    };
  }

  return {
    score: Number.isFinite(Number(n.opportunityScore)) ? Number(n.opportunityScore) : null,
    label: String(n.opportunityLabel || "WATCH").toUpperCase(),
    expectedMoveBand: String(n.expectedMoveBand || n.opportunityLabel || "WATCH").toUpperCase(),
    setup: String(n.coreSetup || "NONE").replaceAll("_", " "),
    eligible: n.eligible === true,
    entryEligible: n.entryEligible === true,
    entryQualityScore: Number.isFinite(Number(n.entryQualityScore)) ? Number(n.entryQualityScore) : null,
    entryQualityLabel: String(n.entryQualityLabel || "UNAVAILABLE").toUpperCase(),
    chaseRisk: String(n.chaseRisk || "LOW").toUpperCase(),
    entryDecision: String(n.entryDecision || "NO_SETUP").toUpperCase(),
    tradeDecision: String(n.tradeDecision || "NO_SETUP").toUpperCase(),
    blockers: Array.isArray(n.blockers) ? n.blockers : [],
    volumeAcceleration: Number.isFinite(Number(n.inputs?.volumeAccelerationPercent)) ? Number(n.inputs.volumeAccelerationPercent) : null,
    volumeRatio: Number.isFinite(Number(n.inputs?.volumeRatio)) ? Number(n.inputs.volumeRatio) : null,
    breakoutDistance: Number.isFinite(Number(n.inputs?.breakoutDistancePercent)) ? Number(n.inputs.breakoutDistancePercent) : null,
    rsLabel: n.inputs?.relativeStrengthLabel || null,
    // Ditambahkan 22 Agustus 2026 — lihat estimateOpportunityProbability()
    // di engine/nextDayOpportunity.js. Estimasi peluang aktual berdasar
    // data historis, BUKAN opportunityScore mentah yang cuma hasil
    // penjumlahan poin.
    opportunityProbability: Number.isFinite(Number(n.opportunityProbability)) ? Number(n.opportunityProbability) : null
  };
}

function nextDayOpportunityClass(label) {
  if (label === "HIGH") return "high";
  if (label === "MODERATE") return "moderate";
  if (label === "WATCH") return "watch";
  if (label === "LOW" || label === "AVOID") return "low";
  return "unavailable";
}

function renderNextDayOpportunity(d) {
  const n = getNextDayOpportunityMeta(d);
  const cls = nextDayOpportunityClass(n.label);

  if (n.score === null) {
    return `
      <div class="nextday-box unavailable">
        <div class="nextday-head">
          <div>
            <div class="nextday-kicker">Next-Day Opportunity</div>
            <div class="nextday-title">Data belum tersedia</div>
          </div>
          <span class="nextday-score">—</span>
        </div>
        <div class="nextday-warning">
          Jangan mengambil keputusan beli dari Score/Signal lama saja.
        </div>
      </div>
    `;
  }

  // FIX (22 Agustus 2026): dulu teks headline ini MURNI dari entryDecision
  // (Entry Quality/Chase Risk — jawab "harga sekarang layak dibeli?"),
  // TIDAK mempertimbangkan n.label (Opportunity — jawab "besok berpotensi
  // naik tinggi?") sama sekali. Akibatnya saham dengan Opportunity RENDAH
  // (WATCH/LOW) tapi Entry Quality bagus tetap dibilang "PRIORITAS — BUY
  // SORE" (kelihatan seperti vonis kuat, padahal cuma "harga sekarang
  // wajar", bukan "besok pasti naik") — user report kasus ASRI (score 39
  // WATCH tapi headline PRIORITAS BUY SORE) vs VERN (score 92 HIGH tapi
  // headline cuma PANTAU). Sekarang headline mempertimbangkan DUA-duanya.
  const opportunityGoodEnough = n.label === "HIGH" || n.label === "MODERATE";

  const decision = n.entryDecision === "BUY_NOW" && n.entryEligible && opportunityGoodEnough
    ? "PRIORITAS — BUY SORE"
    : n.entryDecision === "BUY_NOW" && n.entryEligible && !opportunityGoodEnough
      ? "ENTRY OK, TAPI OPPORTUNITY RENDAH"
      : n.entryDecision === "WAIT_PULLBACK"
        ? "WAIT PULLBACK — JANGAN KEJAR"
        : n.entryDecision === "WATCH"
          ? "PANTAU — ENTRY BELUM IDEAL"
          : n.eligible
            ? "JANGAN ENTRY — CHASE RISK TINGGI"
            : "TIDAK ADA SETUP H+1 VALID";

  const decisionIcon = n.entryDecision === "BUY_NOW" && n.entryEligible && opportunityGoodEnough
    ? "🟢"
    : n.entryDecision === "BUY_NOW" || n.entryDecision === "WAIT_PULLBACK" || n.entryDecision === "WATCH"
      ? "🟡"
      : "🔴";

  const blockers = n.blockers.length
    ? `<div class="nextday-blockers"><strong>Penghambat:</strong> ${n.blockers.join(", ")}</div>`
    : "";

  const setup = n.setup === "NONE" ? "Belum ada setup inti" : n.setup;

  const fmt = (v, suffix = "") =>
    v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}${suffix}`;

  return `
    <div class="nextday-box ${cls}">
      <div class="nextday-head">
        <div>
          <div class="nextday-kicker">Next-Day Opportunity · Close H → H+1</div>
          <div class="nextday-title">${decisionIcon} ${decision}</div>
        </div>
        <div class="nextday-score-wrap">
          <span class="nextday-score">${n.score}</span>
          <span class="nextday-label">${n.label}</span>
        </div>
      </div>

      <div class="nextday-grid">
        <div>
          <span>Expected Band</span>
          <strong>${n.expectedMoveBand}</strong>
        </div>
        <div>
          <span>Setup</span>
          <strong>${setup}</strong>
        </div>
        <div>
          <span>Vol. Acceleration</span>
          <strong>${fmt(n.volumeAcceleration, "%")}</strong>
        </div>
        <div>
          <span>Volume Ratio</span>
          <strong>${n.volumeRatio === null ? "—" : `${n.volumeRatio.toFixed(2)}×`}</strong>
        </div>
        <div>
          <span>Jarak Resistance</span>
          <strong>${fmt(n.breakoutDistance, "%")}</strong>
        </div>
        <div>
          <span>Relative Strength</span>
          <strong>${n.rsLabel || "—"}</strong>
        </div>
        <div>
          <span>Opportunity H+1</span>
          <strong>${n.eligible ? "VALID — " + n.label : "TIDAK VALID"}</strong>
        </div>
        <!-- Entry Quality BUKAN skor prediksi return (22 Agustus 2026,
             atas instruksi user) — ini gauge chase-risk/timing entry
             ("apakah harga sekarang masih layak dibeli", bukan "berapa
             peluang saham ini naik"). Sengaja TIDAK ditampilkan sebagai
             angka bare "75 · FAIR" lagi (bisa dikira skor prediksi yang
             sejajar dengan Opportunity Score di atas) — label kualitatif
             (FAIR/GOOD/POOR) sekarang jadi yang utama, angka jadi info
             sekunder kecil. -->
        <div>
          <span>Entry Quality (timing, bukan prediksi)</span>
          <strong>${n.entryQualityLabel === "UNAVAILABLE" ? "—" : n.entryQualityLabel}</strong>
          ${n.entryQualityScore === null ? "" : `<small style="display:block;color:var(--muted);font-weight:400;">skor internal: ${n.entryQualityScore}</small>`}
        </div>
        <div>
          <span>Chase Risk</span>
          <strong>${n.chaseRisk}</strong>
        </div>
      </div>

      ${blockers}

      ${renderSimpleReason(d, n)}
    </div>
  `;
}

// Ditambahkan 21 Agustus 2026 (atas instruksi user), menggantikan teks
// metodologi "Aturan baru" yang dianggap terlalu teknis — sekarang
// menjelaskan ALASAN SEDERHANA kenapa saham ini menarik secara teknikal,
// dibangun dari data yang sama (breakout, volume, relative strength, tren)
// supaya orang awam gampang paham tanpa perlu ngerti istilah scoring.
function renderSimpleReason(d, n) {
  const reasons = [];

  if (d.breakout && d.breakout.isBreakout) {
    reasons.push(
      `harga baru saja <strong>menembus level resistance</strong> dengan volume ${n.volumeRatio ? n.volumeRatio.toFixed(1) + "x" : "tinggi"} dari rata-rata — tanda minat beli sedang kuat`
    );
  } else if (n.breakoutDistance !== null && n.breakoutDistance < 0 && n.breakoutDistance >= -12) {
    reasons.push(
      `harga masih dekat di bawah level resistance (${Math.abs(n.breakoutDistance).toFixed(1)}% lagi) — berpotensi tembus kalau momentumnya lanjut`
    );
  }

  if (d.marketTrend === "BULLISH") {
    reasons.push(`tren harga beberapa hari terakhir sedang <strong>naik (bullish)</strong>`);
  }

  if (d.relativeStrength && (d.relativeStrength.label === "OUTPERFORM" || d.relativeStrength.label === "JAUH OUTPERFORM")) {
    reasons.push(`pergerakannya lebih kuat dibanding IHSG & sektornya (${d.relativeStrength.label.toLowerCase()}) — artinya saham ini lebih diminati dibanding saham lain saat ini`);
  }

  if (n.volumeAcceleration !== null && n.volumeAcceleration >= 20) {
    reasons.push(`volume transaksinya sedang naik cepat (+${n.volumeAcceleration.toFixed(0)}%) — tanda makin banyak yang tertarik beli`);
  }

  const intro = reasons.length
    ? `Saham ini menarik secara teknikal karena ${reasons.join("; ")}.`
    : `Belum ada alasan teknikal kuat yang menonjol untuk saham ini saat ini — sinyalnya masih lemah/campuran.`;

  return `
    <div class="nextday-note">
      ${intro}
      Ini bukan jaminan — tetap cek Entry Quality & Chase Risk di atas sebelum entry, dan gunakan stop loss.
    </div>
  `;
}

function renderNextDaySummary(json) {
  const s = json?.nextDayOpportunityStats;
  if (!s) return "";

  return `
    <div class="nextday-summary">
      <div class="nextday-summary-title">🎯 Next-Day Screener · Fokus Close H → High/Close H+1</div>
      <div class="nextday-summary-grid">
        <div class="summary-high"><strong>${s.high ?? 0}</strong><span>HIGH</span></div>
        <div class="summary-moderate"><strong>${s.moderate ?? 0}</strong><span>MODERATE</span></div>
        <div class="summary-watch"><strong>${s.low ?? 0}</strong><span>LOW</span></div>
        <div class="summary-eligible"><strong>${s.eligible ?? 0}</strong><span>H+1 VALID</span></div>
        <div class="summary-eligible"><strong>${s.entryEligible ?? 0}</strong><span>BUY SORE</span></div>
      </div>
      <div class="nextday-summary-note">
        H+1 HIGH hanya berarti peluang continuation menarik. Prioritas BUY SORE ditentukan lagi oleh Entry Quality dan Chase Risk, sehingga saham yang sudah terlalu tinggi tidak otomatis dikejar.
      </div>
    </div>
  `;
}

function renderCard(d) {
  const n = getNextDayOpportunityMeta(d);
  const nextDayDecision = nextDayDecisionMeta(d);
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
        <span class="badge ${n.label === "HIGH" && n.eligible ? "bullish" : "sideways"}">H+1 ${n.label}</span>
        <span class="badge ${n.entryQualityLabel === "GOOD" ? "bullish" : n.entryQualityLabel === "POOR" || n.entryQualityLabel === "AVOID" ? "bearish" : "sideways"}">Entry ${n.entryQualityLabel}</span>
        <span class="badge ${n.chaseRisk === "HIGH" || n.chaseRisk === "EXTREME" ? "bearish" : "sideways"}">Chase ${n.chaseRisk}</span>
        <span class="badge sideways">Timing teknikal · ${d.entry}</span>
        ${d.breakout && d.breakout.isBreakout ? `<span class="badge bullish">🚀 ${d.breakout.level === "STRONG_BREAKOUT" ? "Strong Breakout" : "Breakout"}</span>` : ""}
        ${d.relativeStrength && (d.relativeStrength.label === "OUTPERFORM" || d.relativeStrength.label === "JAUH OUTPERFORM") ? `<span class="badge bullish">RS ${d.relativeStrength.label}</span>` : ""}
        ${d.relativeStrength && (d.relativeStrength.label === "UNDERPERFORM" || d.relativeStrength.label === "JAUH UNDERPERFORM") ? `<span class="badge bearish">RS ${d.relativeStrength.label}</span>` : ""}
        ${d.sector ? `<span class="badge sideways">${d.sector}</span>` : ""}
        ${d.reversalCandidate ? `<span class="badge reversal">🔄 Reversal Candidate</span>` : ""}
        ${d.capitulationBounceCandidate ? `<span class="badge reversal">⚡ Capitulation Bounce</span>` : ""}
      </div>

      ${renderNextDayOpportunity(d)}

      <!-- DIHAPUS atas instruksi user (21 Agustus 2026): Trade Decision,
           Outlook Multi-Hari, Gap/Signal/Confidence/Momentum grid, dan
           Stop Loss/ATR row — dianggap redundan/membingungkan karena
           sudah terwakili di kartu Next-Day Opportunity di atasnya.
           TP1-3 dan estimasi ARA/ARB di bawah TETAP ada, tidak disentuh.

      <div class="verdict-box ${nextDayDecision.className}">
        <div class="verdict-label">${nextDayDecision.label}</div>
        <div class="verdict-text">${nextDayDecision.text}</div>
        <div class="verdict-note">${nextDayDecision.note}</div>
      </div>

      <div class="legacy-verdict multi-day-outlook">
        <span>OUTLOOK MULTI-HARI · indikator teknikal</span>
        <strong>${d.verdict}</strong>
        <small>Menilai kecenderungan beberapa hari berdasarkan tren, MA/EMA, MACD, RSI, momentum, volume, breakout dan relative strength. Bukan prediksi khusus besok dan bukan sinyal entry H+1.</small>
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
      -->

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

      ${renderAraArb(d.close)}

      ${/* DIHAPUS atas instruksi user (21 Agustus 2026): daftar bullet
          warning teknikal (STRONG BUY rawan profit-taking, RSI overbought,
          ATR tinggi, fundamental tidak tersedia, dst). warningsHtml tetap
          dihitung di atas (dipertahankan kalau nanti mau dipakai lagi),
          cuma tidak dirender di sini lagi. */ ""}

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
// Batch Scanner — Semua Emiten (server-side)
// ==========================
//
// Dulu: loop di browser, fetch /api/analyze satu-satu per kode
// (ratusan request sekuensial, lambat & tidak bisa hitung Relative
// Strength vs sektor). Sekarang: satu request ke /api/scan yang
// memindai seluruh universe di server secara paralel, dengan
// breakout detector, closing strength, volume acceleration, dan
// relative strength vs IHSG/sektor sudah terhitung di tiap hasil.

const HARGA_MURAH_MAX = 300;
const SKOR_MIN = 65; // harus sinkron dengan label tombol "skor ≥65" di HTML

async function fetchScan(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch("/api/scan" + (qs ? `?${qs}` : ""));
  const json = await res.json();

  if (json.skipped) {
    return json;
  }

  if (!json.success) {
    console.error("Scan error detail:", json.error, json.stack);
    throw new Error(json.error || json.message || "Batch scan gagal.");
  }

  return json;
}

function renderScanSummary(json, label) {
  const gagal = json.failed
    ? ` (${json.failed} kode gagal diambil datanya)`
    : "";
  const universeNote = json.excludedFromUniverse
    ? ` ${json.excludedFromUniverse} kode lain di watchlist manual tidak ikut di-scan sama sekali (gugur di filter likuiditas mingguan sebelum sempat dicek skornya).`
    : "";

  return `
    ${renderNextDaySummary(json)}
    <div class="loading">
      ${label}: ${json.data.length} dari ${json.scanned} saham lolos filter.
      ${json.breakoutCount} kode breakout terdeteksi.${gagal}${universeNote}
    </div>
  `;
}

async function batchScanSemua() {
  const hasilEl = document.getElementById("hasil");
  const btn = document.getElementById("btnScreenerMurah");

  btn.disabled = true;
  hasilEl.innerHTML = `<div class="loading">Memindai seluruh emiten di server… ini bisa makan waktu beberapa puluh detik.</div>`;

  try {
    // highConviction: signal BUY/STRONG BUY + entry NOW + gap outlook naik +
    // closing strength sehat + volume tidak LOW harus SEPAKAT bareng —
    // jauh lebih ketat daripada cuma cek skor mentah.
    const json = await fetchScan({
      maxPrice: HARGA_MURAH_MAX,
      minScore: SKOR_MIN,
      highConviction: "true"
    });

    btn.disabled = false;

    if (json.skipped) {
      hasilEl.innerHTML = `
        <div class="nextday-summary">
          <div class="nextday-summary-title">⏸️ Screener belum dijalankan</div>
          <div class="nextday-summary-note">
            ${json.message || "Hari ini bukan hari bursa."}
            Gunakan screener pada hari perdagangan agar data Close H benar-benar merepresentasikan penutupan terakhir.
          </div>
        </div>
      `;
      return;
    }

    if (!json.data.length) {
      const universeNote = json.excludedFromUniverse
        ? ` (${json.excludedFromUniverse} kode lain sempat dicek tapi sudah gugur di tahap universe/likuiditas mingguan sebelum sampai ke filter skor — lihat log kalau mau tahu kode apa saja.)`
        : "";
      hasilEl.innerHTML = `<div class="loading">Tidak ada saham murah (&lt;${HARGA_MURAH_MAX}) dengan skor ≥${SKOR_MIN} & sinyal konsisten saat ini. Coba lagi nanti — filter ini memang ketat.${universeNote}</div>`;
      return;
    }

    // UPDATE 21 Agustus 2026 — respons ke laporan user: 6 kode HIGH di
    // ringkasan (renderNextDaySummary) susah dicari di daftar, karena
    // urutan lama pakai decisionRank (BUY_NOW/WAIT_PULLBACK/WATCH/AVOID)
    // sebagai kunci utama. Itu artinya kode ber-label HIGH tapi
    // entryDecision-nya WAIT_PULLBACK/WATCH (harga sudah naik duluan,
    // chase risk tinggi — lihat catatan "Opportunity vs Entry Quality"
    // di engine/nextDayOpportunity.js) malah TENGGELAM di bawah kode
    // MODERATE/LOW yang kebetulan entryDecision-nya BUY_NOW.
    //
    // Sekarang diurutkan dari opportunity SCORE tertinggi ke terendah
    // dulu (ini yang bikin label HIGH/MODERATE/LOW), baru decisionRank
    // & base score dipakai cuma sebagai tie-breaker kalau skornya sama
    // persis. Jadi 6 kode HIGH akan selalu tampil paling atas, sesuai
    // urutan yang diminta user — Entry Quality/Chase Risk tetap terlihat
    // di tiap card, cuma bukan lagi kunci urutan utama.
    const rankedForNextDay = [...json.data].sort((a, b) => {
      const aN = getNextDayOpportunityMeta(a);
      const bN = getNextDayOpportunityMeta(b);

      if ((aN.score ?? -1) !== (bN.score ?? -1)) {
        return (bN.score ?? -1) - (aN.score ?? -1);
      }

      const decisionRank = { BUY_NOW: 4, WAIT_PULLBACK: 3, WATCH: 2, AVOID: 1, NO_SETUP: 0 };
      const aRank = decisionRank[aN.entryDecision] ?? 0;
      const bRank = decisionRank[bN.entryDecision] ?? 0;
      if (aRank !== bRank) return bRank - aRank;

      return (b.score ?? -1) - (a.score ?? -1);
    });

    hasilEl.innerHTML =
      renderScanSummary(json, `Next-Day Scan (<${HARGA_MURAH_MAX}, Score ≥${SKOR_MIN})`) +
      rankedForNextDay.map(renderCard).join("");

  } catch (e) {
    btn.disabled = false;
    hasilEl.innerHTML = `<div class="loading">Batch scan gagal: ${e.message} (detail lengkap ada di console browser)</div>`;
  }
}

document.getElementById("btnScreenerMurah").addEventListener("click", batchScanSemua);
