// ==========================
// CSV Utility
// ==========================
// Konversi array of objects -> teks CSV. Dipakai oleh api/history.js
// untuk fitur export (?format=csv). Sengaja tanpa dependency eksternal
// supaya tidak menambah beban bundle serverless function.

function escapeCsvValue(value) {
  if (value === null || value === undefined) return "";

  const str = String(value);

  // Perlu dibungkus kutip kalau ada koma, kutip, atau baris baru —
  // aturan standar RFC 4180. Kutip di dalam nilai di-escape jadi ganda.
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

export function rowsToCsv(rows, columns) {
  if (!rows || rows.length === 0) return "";

  const cols = columns || Object.keys(rows[0]);

  const header = cols.map(escapeCsvValue).join(",");
  const body = rows
    .map((row) => cols.map((col) => escapeCsvValue(row[col])).join(","))
    .join("\r\n");

  return `${header}\r\n${body}`;
}
