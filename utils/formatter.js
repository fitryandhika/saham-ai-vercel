export function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}

export function percent(value) {
  return `${value.toFixed(2)}%`;
}