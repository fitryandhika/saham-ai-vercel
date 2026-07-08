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

    if (!titleMatch) continue;

    items.push({
      title: stripHtml(titleMatch[1]),
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