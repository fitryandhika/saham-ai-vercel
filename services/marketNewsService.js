// ==========================
// Market News Service — Google News RSS (umum, bukan per-kode)
// ==========================
//
// Beda dengan engine/newsCheck.js (berita per KODE saham buat warning
// corporate action), ini buat berita PASAR/MAKRO umum di widget
// Dashboard: IHSG, kebijakan BI/The Fed, sentimen bursa, dll. Sumber &
// pola parsing sama (Google News RSS, gratis tanpa API key).

const NEWS_MAX_AGE_HOURS = 24 * 3; // 3 hari ke belakang
const NEWS_LIMIT = 8;

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

    if (!source) {
      const dashIdx = title.lastIndexOf(" - ");
      if (dashIdx !== -1) source = title.slice(dashIdx + 3).trim();
    } else {
      const suffix = " - " + source;
      if (title.endsWith(suffix)) title = title.slice(0, title.length - suffix.length).trim();
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

export async function fetchMarketNews(query = "IHSG OR \"bursa saham\" OR \"Bursa Efek Indonesia\"") {
  const q = encodeURIComponent(query);
  const url = `https://news.google.com/rss/search?q=${q}&hl=id&gl=ID&ceid=ID:id`;

  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`News fetch gagal: ${res.status}`);

  const xml = await res.text();
  const items = parseRssItems(xml);

  const filtered = items.filter((item) => {
    if (!item.pubDate) return true;
    const published = new Date(item.pubDate);
    if (isNaN(published.getTime())) return true;
    const ageHours = (Date.now() - published.getTime()) / (1000 * 60 * 60);
    return ageHours <= NEWS_MAX_AGE_HOURS;
  });

  const deduped = dedupeByTitle(filtered);

  deduped.sort((a, b) => {
    const ta = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const tb = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return tb - ta;
  });

  return deduped.slice(0, NEWS_LIMIT);
}

export default fetchMarketNews;