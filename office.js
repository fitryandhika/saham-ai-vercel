// ==========================================================
// Kantor Virtual — Tim Fund Manager AI
// ==========================================================
// Halaman ini TIDAK menambah endpoint API baru (project sudah pas
// di batas 12 serverless function Vercel Hobby plan — lihat catatan
// di README/percakapan sebelumnya). Semua data diambil dari endpoint
// yang sudah ada: /api/macro-latest, /api/analyze, /api/scan.
//
// "5 ruangan" cuma lapisan presentasi (chat log per ruangan + panel
// laporan akhir) di atas hasil engine yang sama persis dipakai di
// halaman Analisa/Dashboard — bukan model/skoring baru.

// ==========================
// Jam WIB & ticker (sama seperti halaman lain)
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

async function loadRegimeBadge() {
  const badgeEl = document.getElementById("regimeBadge");
  const ihsgEl = document.getElementById("tickerIhsg");
  if (!badgeEl) return;

  try {
    const res = await fetch("/api/macro-latest");
    const json = await res.json();

    if (!json.available) {
      badgeEl.textContent = "⚪ Regime belum ada data";
      return;
    }

    const regime = json.market_regime || "NEUTRAL";
    badgeEl.className = "regime-badge " + (
      regime === "RISK_ON" ? "risk-on" : regime === "RISK_OFF" ? "risk-off" : "neutral"
    );
    badgeEl.textContent = (
      regime === "RISK_ON" ? "🟢 RISK-ON" : regime === "RISK_OFF" ? "🔴 RISK-OFF" : "⚪ NEUTRAL"
    );

    if (json.ihsg_close) {
      const chg = json.ihsg_change_pct;
      const chgText = chg != null
        ? ` <span class="chg ${chg >= 0 ? "positive" : "negative"}">${chg >= 0 ? "+" : ""}${chg}%</span>`
        : "";
      ihsgEl.innerHTML = `IHSG ${json.ihsg_close.toLocaleString("id-ID", { maximumFractionDigits: 2 })}${chgText}`;
    }
  } catch (e) {
    badgeEl.textContent = "⚪ Regime gagal dimuat";
  }
}

loadRegimeBadge();

// ==========================
// Watchlist (sama key dengan halaman Analisa)
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

function renderWatchlistChips() {
  const el = document.getElementById("officeWatchlistChips");
  const list = getWatchlist();
  el.innerHTML = list.map(kode =>
    `<span class="chip" data-kode="${kode}"><span class="chip-label">${kode}</span></span>`
  ).join("");

  el.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.getElementById("officeKode").value = chip.dataset.kode;
    });
  });
}

renderWatchlistChips();

// ==========================
// Mode toggle (1 saham vs portofolio)
// ==========================

let currentMode = "single";

document.getElementById("modeSingleBtn").addEventListener("click", () => setMode("single"));
document.getElementById("modePortfolioBtn").addEventListener("click", () => setMode("portfolio"));

function setMode(mode) {
  currentMode = mode;
  document.getElementById("modeSingleBtn").classList.toggle("active", mode === "single");
  document.getElementById("modePortfolioBtn").classList.toggle("active", mode === "portfolio");
  document.getElementById("modeSingleFields").style.display = mode === "single" ? "" : "none";
  document.getElementById("modePortfolioFields").style.display = mode === "portfolio" ? "" : "none";
}

// ==========================
// Input dana — auto format ribuan
// ==========================

const danaInput = document.getElementById("officeDana");

danaInput.addEventListener("input", () => {
  const digits = danaInput.value.replace(/\D/g, "");
  danaInput.value = digits ? Number(digits).toLocaleString("id-ID") : "";
});

function getDanaValue() {
  const digits = danaInput.value.replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

// ==========================
// Denah ruangan
// ==========================

const ROOMS = [
  { id: "briefing", number: "01", name: "Ruang Briefing", role: "Kepala Kantor — mencatat permintaan" },
  { id: "makro", number: "02", name: "Lab Riset Makro", role: "Macro Strategist — arah market" },
  { id: "analis", number: "03", name: "Meja Analis", role: "Chief Analyst — sinyal teknikal" },
  { id: "risiko", number: "04", name: "Ruang Manajemen Risiko", role: "Risk Manager — exhaustion, distribusi, sizing" },
  { id: "keputusan", number: "05", name: "Ruang Keputusan", role: "Portfolio Manager — keputusan & alokasi akhir" }
];

function renderFloor() {
  const el = document.getElementById("officeFloor");
  el.innerHTML = ROOMS.map(r => `
    <article class="office-room" id="room-${r.id}">
      <div class="office-room-head">
        <span class="office-room-title"><span class="office-room-number">${r.number}</span> ${r.name}</span>
        <span class="office-room-status" id="status-${r.id}">Idle</span>
      </div>
      <div class="office-room-role">${r.role}</div>
      <div class="office-room-log" id="log-${r.id}">
        <div class="office-room-empty">Menunggu permintaan…</div>
      </div>
    </article>
  `).join("");
}

renderFloor();

function setRoomStatus(id, status) {
  const roomEl = document.getElementById(`room-${id}`);
  const statusEl = document.getElementById(`status-${id}`);
  roomEl.classList.remove("active", "done");
  if (status === "active") {
    roomEl.classList.add("active");
    statusEl.textContent = "Berjalan…";
  } else if (status === "done") {
    roomEl.classList.add("done");
    statusEl.textContent = "Selesai";
  } else {
    statusEl.textContent = "Idle";
  }
}

function logToRoom(id, text, variant = "") {
  const logEl = document.getElementById(`log-${id}`);
  const empty = logEl.querySelector(".office-room-empty");
  if (empty) empty.remove();
  const line = document.createElement("div");
  line.className = "office-log-line" + (variant ? ` ${variant}` : "");
  line.textContent = text;
  logEl.appendChild(line);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fmtRp(n) {
  return "Rp" + Math.round(n).toLocaleString("id-ID");
}

// ==========================
// Panggil API yang sudah ada
// ==========================

async function fetchMacro() {
  const res = await fetch("/api/macro-latest");
  return res.json();
}

async function fetchAnalyze(kode) {
  const res = await fetch("/api/analyze?kode=" + encodeURIComponent(kode));
  const json = await res.json();
  if (!json.success) throw new Error(json.message || "Analisa gagal.");
  return json.data;
}

async function fetchScan(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch("/api/scan" + (qs ? `?${qs}` : ""));
  const json = await res.json();
  if (json.skipped) return json;
  if (!json.success) throw new Error(json.error || json.message || "Scan gagal.");
  return json;
}

// ==========================
// Exposure factor dari regime — dipakai Portfolio Manager di
// Ruang Keputusan supaya arah makro benar-benar mempengaruhi
// berapa besar dana yang dianjurkan masuk ke saham vs tetap cash,
// bukan cuma badge dekoratif di header.
// ==========================

function exposureFromRegime(regime) {
  if (regime === "RISK_ON") return { factor: 0.9, note: "market kondusif, tapi tetap sisakan buffer cash 10%." };
  if (regime === "RISK_OFF") return { factor: 0.5, note: "market risk-off, separuh dana dianjurkan tetap cash sampai kondisi membaik." };
  return { factor: 0.75, note: "market netral, porsi cash ditambah sebagai kehati-hatian standar." };
}

// ==========================
// Sorting kandidat — sama seperti rankedForNextDay di script.js
// ==========================

function rankCandidates(list) {
  return [...list].sort((a, b) => {
    const aE = a?.nextDayOpportunity?.eligible ?? false;
    const bE = b?.nextDayOpportunity?.eligible ?? false;
    if (aE !== bE) return Number(bE) - Number(aE);

    const aS = a?.nextDayOpportunity?.opportunityScore ?? -1;
    const bS = b?.nextDayOpportunity?.opportunityScore ?? -1;
    if (aS !== bS) return bS - aS;

    return (b.score ?? -1) - (a.score ?? -1);
  });
}

function isHighRisk(d) {
  const exLabel = d?.exhaustion?.label || "";
  const distLabel = d?.distribution?.label || "";
  return exLabel === "SANGAT LELAH" || distLabel === "DISTRIBUSI KUAT" || d?.liquidity?.illiquid;
}

// ==========================
// Alur utama — jalan lewat 5 ruangan
// ==========================

const btn = document.getElementById("btnKonsultasi");

btn.addEventListener("click", runOffice);

async function runOffice() {
  const dana = getDanaValue();
  const reportEl = document.getElementById("officeReport");
  reportEl.innerHTML = "";

  renderFloor();

  if (!dana || dana < 100000) {
    setRoomStatus("briefing", "active");
    logToRoom("briefing", "⚠️ Isi dulu jumlah dana (minimal Rp100.000) sebelum konsultasi.", "bad");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Sedang berjalan ke ruangan…";

  try {
    // ---------- Ruang 1: Briefing ----------
    setRoomStatus("briefing", "active");
    await delay(300);

    const mode = currentMode;
    const kode = document.getElementById("officeKode").value.trim().toUpperCase();
    const jumlahTarget = Number(document.getElementById("officeJumlah").value);
    const murahOnly = document.getElementById("officeMurahOnly").checked;

    logToRoom("briefing", `Klien membawa dana ${fmtRp(dana)}.`);
    logToRoom("briefing",
      mode === "single"
        ? `Permintaan: analisa kelayakan beli saham ${kode || "(kode belum diisi)"}.`
        : `Permintaan: susun portofolio ~${jumlahTarget} saham dari kandidat Next-Day Screener.`
    );

    if (mode === "single" && !kode) {
      logToRoom("briefing", "⚠️ Kode saham belum diisi, konsultasi dihentikan.", "bad");
      setRoomStatus("briefing", "done");
      return;
    }

    setRoomStatus("briefing", "done");
    await delay(400);

    // ---------- Ruang 2: Lab Riset Makro ----------
    setRoomStatus("makro", "active");
    const macro = await fetchMacro();
    const regime = macro.available ? (macro.market_regime || "NEUTRAL") : "NEUTRAL";
    const exposure = exposureFromRegime(regime);

    if (macro.available) {
      logToRoom("makro", `Market regime saat ini: ${regime.replace("_", "-")} (skor ${macro.market_regime_score}).`,
        regime === "RISK_OFF" ? "warn" : regime === "RISK_ON" ? "good" : "");
      if (Array.isArray(macro.regime_reasons) && macro.regime_reasons.length) {
        logToRoom("makro", "Alasan: " + macro.regime_reasons.slice(0, 2).join("; "));
      }
      if (macro.ihsg_close) {
        logToRoom("makro", `IHSG terakhir ${Number(macro.ihsg_close).toLocaleString("id-ID")}${macro.ihsg_change_pct != null ? ` (${macro.ihsg_change_pct >= 0 ? "+" : ""}${macro.ihsg_change_pct}%)` : ""}.`);
      }
    } else {
      logToRoom("makro", "Data macro snapshot belum tersedia — regime dinetralkan, tidak menghukum atau menguntungkan.", "warn");
    }
    logToRoom("makro", `Rekomendasi eksposur ke saham: ~${Math.round(exposure.factor * 100)}% dari dana (${exposure.note})`);
    setRoomStatus("makro", "done");
    await delay(400);

    // ---------- Ruang 3: Meja Analis ----------
    setRoomStatus("analis", "active");

    let singleResult = null;
    let candidates = [];

    if (mode === "single") {
      singleResult = await fetchAnalyze(kode);
      logToRoom("analis", `${kode}: skor ${singleResult.score}, signal ${singleResult.signal}, verdict multi-hari "${singleResult.verdict}".`);
      logToRoom("analis", `Next-Day Opportunity: ${singleResult.nextDayOpportunity?.opportunityLabel ?? "-"} (skor ${singleResult.nextDayOpportunity?.opportunityScore ?? "-"}), eligible: ${singleResult.nextDayOpportunity?.eligible ? "ya" : "tidak"}.`);
    } else {
      const scanParams = { minScore: "55", highConviction: "false" };
      if (murahOnly) scanParams.maxPrice = "300";
      const scan = await fetchScan(scanParams);

      if (scan.skipped) {
        logToRoom("analis", `⏸️ ${scan.message || "Hari ini bukan hari bursa, screener dilewati."}`, "warn");
        setRoomStatus("analis", "done");
        return;
      }

      const ranked = rankCandidates(scan.data || []);
      candidates = ranked.slice(0, Math.max(jumlahTarget * 2, jumlahTarget + 3));

      logToRoom("analis", `${scan.data.length} saham lolos filter awal dari ${scan.scanned} yang dipindai.`);
      logToRoom("analis", `Kandidat teratas: ${candidates.slice(0, jumlahTarget).map(c => c.kode).join(", ") || "(tidak ada)"}.`);
    }

    setRoomStatus("analis", "done");
    await delay(400);

    // ---------- Ruang 4: Manajemen Risiko ----------
    setRoomStatus("risiko", "active");

    if (mode === "single") {
      const d = singleResult;
      logToRoom("risiko", `Risk level: ${d.riskLevel}. ATR (volatilitas): ${d.atr.toLocaleString("id-ID")}. Risk/Reward ke TP2: 1:${d.riskRewardLevels?.tp2 ?? "-"}.`);
      logToRoom("risiko", `Exhaustion: ${d.exhaustion?.label ?? "-"}. Distribution: ${d.distribution?.label ?? "-"}.`,
        isHighRisk(d) ? "warn" : "");
      if (d.warnings && d.warnings.length && d.warnings[0] !== "Tidak ada peringatan penting.") {
        d.warnings.slice(0, 2).forEach(w => logToRoom("risiko", "⚠️ " + w, "warn"));
      }
    } else {
      const flagged = candidates.filter(isHighRisk);
      logToRoom("risiko", `${flagged.length} dari ${candidates.length} kandidat ditandai berisiko tinggi (exhaustion/distribusi tinggi atau tidak likuid).`,
        flagged.length ? "warn" : "");
      candidates = candidates.filter(c => !isHighRisk(c));
      logToRoom("risiko", `Kandidat yang lolos filter risiko: ${candidates.slice(0, jumlahTarget).map(c => c.kode).join(", ") || "(tidak ada)"}.`);
    }

    setRoomStatus("risiko", "done");
    await delay(400);

    // ---------- Ruang 5: Keputusan ----------
    setRoomStatus("keputusan", "active");

    const investable = dana * exposure.factor;

    if (mode === "single") {
      renderSingleDecision(singleResult, dana, investable, regime);
    } else {
      renderPortfolioDecision(candidates.slice(0, jumlahTarget), dana, investable, regime);
    }

    setRoomStatus("keputusan", "done");

  } catch (e) {
    logToRoom("keputusan", "Gagal: " + e.message, "bad");
    setRoomStatus("keputusan", "done");
  } finally {
    btn.disabled = false;
    btn.textContent = "Konsultasi ke Kantor";
  }
}

// ==========================
// Sizing & panel laporan — 1 saham
// ==========================

function renderSingleDecision(d, dana, investable, regime) {
  const reportEl = document.getElementById("officeReport");

  const isAvoid = d.liquidity?.illiquid ||
    ["SELL", "STRONG SELL"].includes(d.signal) ||
    isHighRisk(d);

  logToRoom("keputusan", `Keputusan untuk ${d.kode} dengan dana ${fmtRp(investable)} (dari total ${fmtRp(dana)}).`);

  if (isAvoid) {
    logToRoom("keputusan", `🔴 TAHAN — ${d.kode} tidak direkomendasikan untuk entry saat ini. Seluruh dana disarankan tetap cash.`, "bad");

    reportEl.innerHTML = `
      <div class="office-report-panel">
        <div class="office-report-title">📋 Laporan Ruang Keputusan — ${d.kode}</div>
        <div class="office-report-sub">Regime market: ${regime.replace("_", "-")} · ${new Date().toLocaleString("id-ID")}</div>
        <div class="office-verdict-line avoid">
          🔴 TAHAN. Skor ${d.score} / signal ${d.signal}${isHighRisk(d) ? ", terindikasi exhaustion/distribusi tinggi" : ""}.
          Kantor menyarankan seluruh ${fmtRp(dana)} tetap cash sampai setup lebih meyakinkan.
        </div>
      </div>
    `;
    return;
  }

  const entry = d.close;
  const stopLoss = d.stopLoss;
  const riskPerShare = Math.max(entry - stopLoss, entry * 0.01);
  const riskBudget = investable * 0.02; // maks 2% risiko dari dana yang diinvestasikan

  const sharesByRisk = Math.floor(riskBudget / riskPerShare);
  const sharesByCapital = Math.floor(investable / entry);
  const shares = Math.max(0, Math.min(sharesByRisk, sharesByCapital));
  const lots = Math.floor(shares / 100);
  const actualShares = lots * 100;
  const totalCost = actualShares * entry;
  const sisaDana = dana - totalCost;

  if (lots === 0) {
    logToRoom("keputusan", `⚠️ Dana yang bisa dipakai (${fmtRp(investable)}) belum cukup untuk 1 lot ${d.kode} @${fmtRp(entry)}.`, "warn");
    reportEl.innerHTML = `
      <div class="office-report-panel">
        <div class="office-report-title">📋 Laporan Ruang Keputusan — ${d.kode}</div>
        <div class="office-report-sub">Regime market: ${regime.replace("_", "-")} · ${new Date().toLocaleString("id-ID")}</div>
        <div class="office-verdict-line warn">
          ⚠️ Dana belum cukup untuk 1 lot (${fmtRp(entry * 100)} per lot @ harga ${fmtRp(entry)}).
          Naikkan dana atau pilih saham dengan harga lebih rendah.
        </div>
      </div>
    `;
    return;
  }

  logToRoom("keputusan", `🟢 BELI ${lots} lot (${actualShares} lembar) ${d.kode} @${fmtRp(entry)} = ${fmtRp(totalCost)}. Sisa cash ${fmtRp(sisaDana)}.`, "good");

  reportEl.innerHTML = `
    <div class="office-report-panel">
      <div class="office-report-title">📋 Laporan Ruang Keputusan — ${d.kode}</div>
      <div class="office-report-sub">Regime market: ${regime.replace("_", "-")} · Risiko dibatasi ~2% dari dana yang diinvestasikan · ${new Date().toLocaleString("id-ID")}</div>

      <div class="office-report-stats">
        <div class="stat"><div class="stat-label">Entry</div><div class="stat-value">${fmtRp(entry)}</div></div>
        <div class="stat"><div class="stat-label">Stop Loss</div><div class="stat-value">${fmtRp(stopLoss)}</div></div>
        <div class="stat"><div class="stat-label">TP1</div><div class="stat-value">${fmtRp(d.takeProfitLevels.tp1)}</div></div>
        <div class="stat"><div class="stat-label">TP2</div><div class="stat-value">${fmtRp(d.takeProfitLevels.tp2)}</div></div>
      </div>

      <div class="office-report-stats">
        <div class="stat"><div class="stat-label">Jumlah</div><div class="stat-value">${lots} lot (${actualShares} lbr)</div></div>
        <div class="stat"><div class="stat-label">Total Modal</div><div class="stat-value">${fmtRp(totalCost)}</div></div>
        <div class="stat"><div class="stat-label">Sisa Cash</div><div class="stat-value">${fmtRp(sisaDana)}</div></div>
        <div class="stat"><div class="stat-label">Risk/Reward</div><div class="stat-value">1:${d.riskRewardLevels?.tp2 ?? "-"}</div></div>
      </div>

      <div class="office-verdict-line buy">
        🟢 BELI ${lots} lot ${d.kode}. Pasang Stop Loss di ${fmtRp(stopLoss)}, target bertahap TP1/TP2/TP3.
        Ukuran posisi sudah dibatasi supaya kalau kena SL, kerugian ≈2% dari dana yang diinvestasikan.
      </div>
    </div>
  `;
}

// ==========================
// Sizing & panel laporan — portofolio
// ==========================

function renderPortfolioDecision(list, dana, investable, regime) {
  const reportEl = document.getElementById("officeReport");

  if (!list.length) {
    logToRoom("keputusan", "🔴 Tidak ada kandidat yang lolos sampai Ruang Keputusan. Seluruh dana tetap cash.", "bad");
    reportEl.innerHTML = `
      <div class="office-report-panel">
        <div class="office-report-title">📋 Laporan Ruang Keputusan — Portofolio</div>
        <div class="office-report-sub">Regime market: ${regime.replace("_", "-")} · ${new Date().toLocaleString("id-ID")}</div>
        <div class="office-verdict-line avoid">🔴 Tidak ada kandidat yang cukup layak & aman saat ini. Kantor menyarankan seluruh ${fmtRp(dana)} tetap cash dulu.</div>
      </div>
    `;
    return;
  }

  // Alokasi equal-weight, tapi kalau 1 slot tidak cukup untuk 1 lot,
  // sisa dananya digulir ke kandidat berikutnya (bukan sekadar hilang).
  let remaining = investable;
  let remainingSlots = list.length;
  const rows = [];

  list.forEach((d) => {
    const perSlot = remaining / remainingSlots;
    const lots = Math.floor(perSlot / d.close / 100);
    const shares = lots * 100;
    const cost = shares * d.close;

    if (lots > 0) {
      rows.push({
        kode: d.kode,
        entry: d.close,
        lots,
        shares,
        cost,
        signal: d.signal,
        score: d.score,
        stopLoss: d.stopLoss,
        tp1: d.takeProfitLevels?.tp1
      });
      remaining -= cost;
    }
    remainingSlots -= 1;
  });

  const totalInvested = rows.reduce((sum, r) => sum + r.cost, 0);
  const sisaDana = dana - totalInvested;

  if (!rows.length) {
    logToRoom("keputusan", "⚠️ Dana per-saham terlalu kecil untuk beli 1 lot pun. Naikkan dana atau kurangi target jumlah saham.", "warn");
    reportEl.innerHTML = `
      <div class="office-report-panel">
        <div class="office-report-title">📋 Laporan Ruang Keputusan — Portofolio</div>
        <div class="office-report-sub">Regime market: ${regime.replace("_", "-")} · ${new Date().toLocaleString("id-ID")}</div>
        <div class="office-verdict-line warn">⚠️ Dana per-saham terlalu kecil untuk 1 lot pun di kandidat manapun. Coba naikkan dana atau kurangi target jumlah saham.</div>
      </div>
    `;
    return;
  }

  logToRoom("keputusan", `🟢 Alokasi ke ${rows.length} saham, total modal ${fmtRp(totalInvested)}, sisa cash ${fmtRp(sisaDana)}.`, "good");

  const tableRows = rows.map(r => `
    <tr>
      <td>${r.kode}</td>
      <td>${fmtRp(r.entry)}</td>
      <td>${r.lots} lot</td>
      <td>${fmtRp(r.cost)}</td>
      <td>${((r.cost / dana) * 100).toFixed(1)}%</td>
      <td>${fmtRp(r.stopLoss)}</td>
      <td>${r.signal} · ${r.score}</td>
    </tr>
  `).join("");

  reportEl.innerHTML = `
    <div class="office-report-panel">
      <div class="office-report-title">📋 Laporan Ruang Keputusan — Portofolio</div>
      <div class="office-report-sub">Regime market: ${regime.replace("_", "-")} · Alokasi setara-bobot di antara kandidat yang lolos risiko · ${new Date().toLocaleString("id-ID")}</div>

      <div class="office-report-stats">
        <div class="stat"><div class="stat-label">Jumlah Saham</div><div class="stat-value">${rows.length}</div></div>
        <div class="stat"><div class="stat-label">Total Modal</div><div class="stat-value">${fmtRp(totalInvested)}</div></div>
        <div class="stat"><div class="stat-label">Sisa Cash</div><div class="stat-value">${fmtRp(sisaDana)}</div></div>
        <div class="stat"><div class="stat-label">Eksposur Saham</div><div class="stat-value">${((totalInvested / dana) * 100).toFixed(0)}%</div></div>
      </div>

      <div class="office-alloc-wrap">
        <table class="office-alloc-table">
          <thead>
            <tr><th>Kode</th><th>Entry</th><th>Lot</th><th>Modal</th><th>Bobot</th><th>Stop Loss</th><th>Signal</th></tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>

      <div class="office-verdict-line buy">
        🟢 Portofolio ${rows.length} saham dengan bobot setara, sisa ${fmtRp(sisaDana)} tetap cash sebagai buffer sesuai arah regime market saat ini.
        Pasang Stop Loss di masing-masing level yang tertera.
      </div>
    </div>
  `;
}
