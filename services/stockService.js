export async function getStockData(kode) {

  // Dummy sementara.
  // Nanti pada Tahap 8.2 akan diganti dengan API real-time.

  return {
    kode,

    closePrices: Array.from(
      { length: 60 },
      (_, i) => 5000 + i * 8
    )
  };
}