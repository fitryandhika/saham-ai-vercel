import yahooFinance from "yahoo-finance2";

console.log("YahooFinance =", yahooFinance);

export async function getStockData(kode) {
  throw new Error(
    "Keys: " + Object.keys(yahooFinance).join(", ")
  );
}