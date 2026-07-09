// ==========================
// News & Corporate Action Check
// ==========================
//
// Modul berdiri sendiri: TIDAK mengubah scoring/verdict.
// Hanya menambah entri ke array `warnings` yang sudah ada di response.
// Sumber: Google News RSS (gratis, tanpa API key).

const CORP_ACTION_KEYWORDS = [
  { match: /rups/i,            label: "Ada agenda RUPS — cek dulu isi keputusan sebelum entry" },
  { match: /right issue|rights issue|hmetd/i, label: "Ada rencana right issue — potensi dilusi/tekanan harga" },
  { match: /stock split|pemecahan saham/i,     label: "Ada rencana stock split — harga bisa lebih volatile dari biasanya" },
  { match: /suspen(si|d)/i,     label: "Saham berpotensi/sedang suspensi — hindari entry dulu" },
  { match: /delisting/i,        label: "Ada isu delisting — risiko tinggi, hindari" },
  { match: /buyback/i,          label: "Ada aksi buyback — bisa jadi sentimen positif jangka pendek" },
  { match: /dividen/i,          label: "Ada berita dividen — cek tanggal cum/ex sebelum entry" },
  { match: /akuisisi|merger/i,  label: "Ada berita akuisisi/merger — cek detail sebelum entry" }
];

const NEWS_MAX_AGE_HOURS = 48;

function stripHtml(str) {
  return (str || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim();
}

function parseRssItems(xml) {
  const items = [];
  const itemBlocks = xml.split("<item>").slice(1);

  for (const block of itemBlocks) {
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const pubDateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/);
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/);

    if (!titleMatch) continue;

    let title = stripHtml(titleMatch[1]);
    let source = sourceMatch ? stripHtml(sourceMatch[1]) : null;

    // Google News RSS biasanya format title: "Judul berita - Nama Media"
    // Kalau tag <source> tidak ada, coba ambil dari akhir title.
    if (!source) {
      const dashIdx = title.lastIndexOf(" - ");
      if (dashIdx !== -1) {
        source = title.slice(dashIdx + 3).trim();
      }
    } else {
      // Kalau <source> ada, judul biasanya masih menyertakan " - Nama Media" di akhir, buang.
      const suffix = " - " + source;
      if (title.endsWith(suffix)) {
        title = title.slice(0, title.length - suffix.length).trim();
      }
    }

    items.push({
      title,
      source: source || "Sumber tidak diketahui",
      pubDate: pubDateMatch ? stripHtml(pubDateMatch[1]) : null,
      link: linkMatch ? stripHtml(linkMatch[1]) : null
    });
  }

  return items;
}

function isRecent(pubDate) {
  if (!pubDate) return false;
  const published = new Date(pubDate);
  if (isNaN(published.getTime())) return false;

  const ageHours = (Date.now() - published.getTime()) / (1000 * 60 * 60);
  return ageHours <= NEWS_MAX_AGE_HOURS;
}

async function fetchNewsRss(kode) {
  const query = encodeURIComponent(`${kode} saham`);
  const url = `https://news.google.com/rss/search?q=${query}&hl=id&gl=ID&ceid=ID:id`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" }
  });

  if (!res.ok) {
    throw new Error(`News fetch gagal: ${res.status}`);
  }

  const xml = await res.text();
  return parseRssItems(xml);
}

// ==========================
// Daftar berita lengkap (untuk halaman News)
// ==========================
//
// Beda dengan checkNewsWarnings: fungsi ini TIDAK membatasi 48 jam terakhir
// dan mengembalikan semua item (judul, sumber, tanggal, link) supaya user
// bisa lihat sebanyak mungkin sumber berita terkait satu kode saham.

const NEWS_LIST_MAX_AGE_HOURS = 24 * 14; // 14 hari ke belakang
const NEWS_LIST_LIMIT = 30;

function dedupeByTitle(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = item.title.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export async function fetchStockNews(kode) {
  const items = await fetchNewsRss(kode);

  const filtered = items.filter(item => {
    if (!item.pubDate) return true; // kalau tanggal tidak kebaca, tetap tampilkan
    const published = new Date(item.pubDate);
    if (isNaN(published.getTime())) return true;
    const ageHours = (Date.now() - published.getTime()) / (1000 * 60 * 60);
    return ageHours <= NEWS_LIST_MAX_AGE_HOURS;
  });

  const deduped = dedupeByTitle(filtered);

  deduped.sort((a, b) => {
    const ta = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const tb = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return tb - ta;
  });

  const limited = deduped.slice(0, NEWS_LIST_LIMIT);
  const sumberUnik = [...new Set(limited.map(item => item.source))];

  return {
    kode,
    total: limited.length,
    sumberCount: sumberUnik.length,
    sumberList: sumberUnik,
    items: limited
  };
}

export async function checkNewsWarnings(kode) {
  try {
    const items = await fetchNewsRss(kode);
    const recentItems = items.filter(item => isRecent(item.pubDate)).slice(0, 10);

    const warnings = [];
    const seenLabels = new Set();

    for (const item of recentItems) {
      for (const rule of CORP_ACTION_KEYWORDS) {
        if (rule.match.test(item.title) && !seenLabels.has(rule.label)) {
          warnings.push(rule.label);
          seenLabels.add(rule.label);
        }
      }
    }

    return {
      warnings,
      newsCount: recentItems.length,
      latest: recentItems[0] || null
    };
  } catch (e) {
    console.error("checkNewsWarnings error:", e.message);
    return { warnings: [], newsCount: 0, latest: null };
  }
}