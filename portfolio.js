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
    labelEl.textContent = "🟡 Jendela Beli Sore — Siapkan Entry Overnight Sebelum Tutup";
  } else if (minutesNow >= marketOpen && minutesNow < buyWindowStart) {
    barEl.classList.add("market-open");
    labelEl.textContent = "Market Berjalan — Belum Masuk Jendela Beli Sore";
  } else if (minutesNow >= preMarket && minutesNow < marketOpen) {
    barEl.classList.add("market-open");
    labelEl.textContent = "Pra-market — Bursa Belum Buka";
  } else {
    barEl.classList.add("overnight");
    labelEl.textContent = "Market Tutup - Pastikan Screener Di Jalan Pada Waktu 15:30-15:45";
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
// Panggil API (dipakai untuk refresh harga)
// ==========================

async function fetchAnalisa(kode) {
  const res = await fetch("/api/analyze?kode=" + kode);
  const json = await res.json();

  if (!json.success) {
    throw new Error(json.message || "Analisis gagal.");
  }

  return json.data;
}

// ==========================
// Portofolio (localStorage)
// ==========================

const PORTFOLIO_KEY = "sahamai_portfolio";
const FEE_KEY = "sahamai_fees";

// Default mengikuti kisaran umum fee aplikasi sekuritas Indonesia
// (beli ~0.15-0.19%, jual ~0.25-0.29% termasuk PPh final 0.1%).
// Angka pastinya beda-beda tiap sekuritas — edit di panel Pengaturan Fee.
const DEFAULT_FEES = { beli: 0.15, jual: 0.25 };

function getFees() {
  try {
    const raw = localStorage.getItem(FEE_KEY);
    if (!raw) return { ...DEFAULT_FEES };
    const parsed = JSON.parse(raw);
    return {
      beli: Number.isFinite(parsed.beli) ? parsed.beli : DEFAULT_FEES.beli,
      jual: Number.isFinite(parsed.jual) ? parsed.jual : DEFAULT_FEES.jual
    };
  } catch (e) {
    return { ...DEFAULT_FEES };
  }
}

function saveFees(fees) {
  localStorage.setItem(FEE_KEY, JSON.stringify(fees));
}

function isiFormFee() {
  const fees = getFees();
  document.getElementById("feeBeli").value = fees.beli;
  document.getElementById("feeJual").value = fees.jual;
}

function simpanFee() {
  const beli = parseFloat(document.getElementById("feeBeli").value);
  const jual = parseFloat(document.getElementById("feeJual").value);

  saveFees({
    beli: Number.isFinite(beli) && beli >= 0 ? beli : DEFAULT_FEES.beli,
    jual: Number.isFinite(jual) && jual >= 0 ? jual : DEFAULT_FEES.jual
  });

  renderPortfolio();
}

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

// P/L bersih setelah fee — bukan cuma selisih harga.
// feeBeli sudah pasti terjadi (dibayar saat entry), feeJual dihitung dari
// harga jual (exitPrice untuk posisi tertutup, harga sekarang untuk posisi
// terbuka — jadi estimasi, actual fee jual nanti dihitung ulang begitu
// posisi ditutup dengan harga jual sebenarnya).
function hitungPLBersih(entryPrice, hargaJual, lots, fees) {
  const lembar = lots * 100;
  const nilaiBeli = entryPrice * lembar;
  const nilaiJual = hargaJual * lembar;

  const feeBeliRp = nilaiBeli * (fees.beli / 100);
  const feeJualRp = nilaiJual * (fees.jual / 100);

  const pl = (nilaiJual - feeJualRp) - (nilaiBeli + feeBeliRp);
  const plPersen = (pl / nilaiBeli) * 100;

  return { pl, plPersen, feeBeliRp, feeJualRp };
}

function hitungPL(pos, hargaSekarang) {
  const fees = getFees();
  const { pl, plPersen } = hitungPLBersih(pos.entryPrice, hargaSekarang, pos.lots, fees);
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

function editPosisi(id) {
  const list = getPortfolio();
  const pos = list.find(p => p.id === id);
  if (!pos) return;

  const inputKode = prompt("Kode saham?", pos.kode);
  if (inputKode === null) return;
  const kode = inputKode.trim().toUpperCase();
  if (!kode) {
    alert("Kode saham tidak boleh kosong.");
    return;
  }

  const inputHarga = prompt("Harga beli?", pos.entryPrice);
  if (inputHarga === null) return;
  const harga = parseFloat(inputHarga);
  if (!harga || harga <= 0) {
    alert("Harga beli tidak valid.");
    return;
  }

  const inputLot = prompt("Jumlah lot?", pos.lots);
  if (inputLot === null) return;
  const lot = parseInt(inputLot, 10);
  if (!lot || lot <= 0) {
    alert("Jumlah lot tidak valid.");
    return;
  }

  pos.kode = kode;
  pos.entryPrice = harga;
  pos.lots = lot;

  savePortfolio(list);
  renderPortfolio();
}

function hapusPosisi(id) {
  const list = getPortfolio();
  const pos = list.find(p => p.id === id);
  if (!pos) return;

  const ok = confirm(`Hapus posisi ${pos.kode} dari portofolio? Aksi ini tidak bisa dibatalkan.`);
  if (!ok) return;

  const updated = list.filter(p => p.id !== id);
  savePortfolio(updated);
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

function editTransaksi(id) {
  const list = getPortfolio();
  const pos = list.find(p => p.id === id);
  if (!pos) return;

  const input = prompt(`Harga jual untuk ${pos.kode}?`, pos.exitPrice);
  if (input === null) return;

  const exitPrice = parseFloat(input);
  if (!exitPrice || exitPrice <= 0) {
    alert("Harga jual tidak valid.");
    return;
  }

  pos.exitPrice = exitPrice;
  savePortfolio(list);
  renderPortfolio();
}

function hapusTransaksi(id) {
  const list = getPortfolio();
  const pos = list.find(p => p.id === id);
  if (!pos) return;

  const ok = confirm(`Hapus riwayat transaksi ${pos.kode} ini? Aksi ini tidak bisa dibatalkan.`);
  if (!ok) return;

  const updated = list.filter(p => p.id !== id);
  savePortfolio(updated);
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
      const fees = getFees();
      const { pl, plPersen, feeBeliRp, feeJualRp } = hitungPLBersih(pos.entryPrice, hargaSekarang, pos.lots, fees);
      const cls = pl >= 0 ? "positive" : "negative";
      const tanda = pl >= 0 ? "+" : "";
      const totalFee = feeBeliRp + feeJualRp;

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
          <div class="pf-detail pf-fee-note">
            <span>P/L bersih setelah fee (beli ${fees.beli}% + jual ${fees.jual}% ≈ ${Math.round(totalFee).toLocaleString("id-ID")})</span>
          </div>
          <div class="pf-actions">
            <button class="btn-ghost" data-edit="${pos.id}">Edit</button>
            <button class="btn-ghost btn-danger" data-delete="${pos.id}">Hapus</button>
            <button class="btn-ghost" data-close="${pos.id}">Tutup Posisi</button>
          </div>
        </div>
      `;
    }).join("");

    listEl.querySelectorAll("[data-edit]").forEach(btn => {
      btn.addEventListener("click", () => editPosisi(btn.getAttribute("data-edit")));
    });
    listEl.querySelectorAll("[data-delete]").forEach(btn => {
      btn.addEventListener("click", () => hapusPosisi(btn.getAttribute("data-delete")));
    });
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
  const fees = getFees();

  const rows = closed.slice().reverse().map(pos => {
    const { pl } = hitungPLBersih(pos.entryPrice, pos.exitPrice, pos.lots, fees);
    totalPL += pl;
    if (pl > 0) menang++;

    const cls = pl >= 0 ? "positive" : "negative";
    const tanda = pl >= 0 ? "+" : "";

    return `
      <div class="history-row">
        <span>${pos.kode}</span>
        <span>${pos.entryPrice.toLocaleString("id-ID")} → ${pos.exitPrice.toLocaleString("id-ID")}</span>
        <span class="${cls}">${tanda}${Math.round(pl).toLocaleString("id-ID")}</span>
        <span class="history-actions">
          <button class="btn-ghost" data-edit-tx="${pos.id}">Edit</button>
          <button class="btn-ghost btn-danger" data-delete-tx="${pos.id}">Hapus</button>
        </span>
      </div>
    `;
  }).join("");

  const winRate = ((menang / closed.length) * 100).toFixed(1);
  const totalCls = totalPL >= 0 ? "positive" : "negative";
  const totalTanda = totalPL >= 0 ? "+" : "";

  recapEl.innerHTML = `
    <div class="stat-grid">
      <div class="stat">
        <div class="stat-label">Total P/L Realisasi (bersih fee)</div>
        <div class="stat-value ${totalCls}">${totalTanda}${Math.round(totalPL).toLocaleString("id-ID")}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Win Rate</div>
        <div class="stat-value">${winRate}% (${menang}/${closed.length})</div>
      </div>
    </div>
    <details class="history-details" open>
      <summary>Riwayat transaksi (${closed.length})</summary>
      ${rows}
    </details>
  `;

  recapEl.querySelectorAll("[data-edit-tx]").forEach(btn => {
    btn.addEventListener("click", () => editTransaksi(btn.getAttribute("data-edit-tx")));
  });
  recapEl.querySelectorAll("[data-delete-tx]").forEach(btn => {
    btn.addEventListener("click", () => hapusTransaksi(btn.getAttribute("data-delete-tx")));
  });
}

document.getElementById("btnTambahPosisi").addEventListener("click", tambahPosisi);
document.getElementById("btnRefreshPortfolio").addEventListener("click", refreshHargaPortfolio);
document.getElementById("btnSimpanFee").addEventListener("click", simpanFee);

isiFormFee();
renderPortfolio();
