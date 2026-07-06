import getYahooData from "./yahoo.js";

export async function getStockData(symbol) {
  return await getYahooData(symbol);
}

export default getStockData;