export function isValidTicker(symbol) {
  return /^[A-Z]{4,6}$/.test(symbol);
}