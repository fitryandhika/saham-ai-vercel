export function average(data) {
  if (!data.length) return 0;

  return data.reduce((a, b) => a + b, 0) / data.length;
}