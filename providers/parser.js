export function parseYahooQuote(symbol, history) {
  return {
    symbol,
    candles: history.map(item => ({
      date: item.date,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volume
    }))
  };
}

export default parseYahooQuote;