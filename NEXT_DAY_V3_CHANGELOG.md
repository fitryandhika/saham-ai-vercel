# SahamAI — Next-Day Opportunity V3.1

## Fokus
Screener strategi **beli sore → jual pagi** dengan target peluang saham mencapai **High H+1 >= 3% dari close H**.

## Temuan data nyata yang dipertahankan
- Data 13 Agustus menunjukkan banyak saham yang akhirnya naik kuat H+1 sebelumnya hanya diberi LOW/WATCH/MODERATE.
- Penyebab utama adalah V2 terlalu bergantung pada kombinasi hard blocker: breakout, volume acceleration, volume ratio, dan closing strength.
- Karena itu breakout/pre-breakout/continuation sekarang menjadi **context/setup**, bukan syarat wajib HIGH.
- Evaluasi 13–14 Agustus juga menunjukkan bahwa RSI tinggi tidak layak dijadikan hard blocker untuk strategi overnight.
- `daily_change_pct` tidak dipakai sebagai penalti probability. Pergerakan besar hari ini hanya ditampilkan sebagai **volatility warning**, karena saham yang sudah kuat tetap bisa melanjutkan kenaikan H+1.

## Model V3.1
- Probability calibration target: `NEXT_DAY_HIGH_GE_3PCT`.
- `HIGH >= 50%`.
- `MODERATE >= 40%`.
- `WATCH >= 30%`.
- `LOW < 30%`.
- Liquidity guard tetap menjadi hard guard.
- Exhaustion/distribution ekstrem tetap dapat menurunkan atau memblokir eligibility.
- Market trend hanya menjadi konteks, bukan blocker absolut.

## Prinsip penting
V3.1 **tidak menambahkan filter overextended baru**. Keputusan tersebut disengaja karena backtest yang tersedia belum cukup untuk memilih threshold daily gain yang robust.

## Database
Tidak ada migration baru yang diperlukan untuk perubahan engine ini. Field next-day opportunity yang sudah ada tetap digunakan.