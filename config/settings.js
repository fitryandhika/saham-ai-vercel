const settings = {
  app: {
    name: "SahamAI",
    version: "1.0.0"
  },

  analysis: {
    emaShort: 20,
    emaLong: 50,
    rsiPeriod: 14,
    macdFast: 12,
    macdSlow: 26,
    macdSignal: 9,
    atrPeriod: 14
  },

  screener: {
    minVolume: 1000000,
    volumeSpike: 1.5,
    minPrice: 50
  }
};

export default settings;