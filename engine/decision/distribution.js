/**
 * ==========================================
 * SahamAI v2.1
 * Distribution Detector
 * ------------------------------------------
 * Tujuan:
 * Mendeteksi kemungkinan distribusi
 * (profit taking / smart money selling)
 *
 * Output:
 * {
 *   score,
 *   level,
 *   confidence,
 *   reasons,
 *   isDistribution
 * }
 * ==========================================
 */

export function calculateDistribution({

    candles = [],

    volumes = [],

    volumeRatio = 1

}) {

    if (candles.length < 2) {

        return {

            score: 0,

            level: "NORMAL",

            confidence: 0,

            isDistribution: false,

            reasons: []

        };

    }

    let score = 0;

    const reasons = [];

    const today = candles.at(-1);

    const high = today.high;

    const low = today.low;

    const open = today.open;

    const close = today.close;

    const body = Math.abs(close - open);

    const range = high - low;

    const upperShadow = high - Math.max(open, close);

    // ==========================
    // Close dekat LOW
    // ==========================

    if (range > 0) {

        const closePosition =

            (close - low) / range;

        if (closePosition <= 0.20) {

            score += 20;

            reasons.push("Close berada dekat LOW");

        }

        else if (closePosition <= 0.35) {

            score += 10;

            reasons.push("Close berada di bawah tengah candle");

        }

    }

    // ==========================
    // Upper Shadow
    // ==========================

    if (

        body > 0 &&

        upperShadow >= body * 2

    ) {

        score += 15;

        reasons.push("Upper shadow panjang");

    }

    // ==========================
    // Volume Spike
    // ==========================

    if (volumeRatio >= 3) {

        score += 20;

        reasons.push("Volume >300% rata-rata");

    }

    else if (volumeRatio >= 2) {

        score += 12;

        reasons.push("Volume >200% rata-rata");

    }

    // ==========================
    // Gain kecil tapi volume besar
    // ==========================

    const gain =

        ((close - open) / open) * 100;

    if (

        gain <= 1 &&

        volumeRatio >= 2

    ) {

        score += 15;

        reasons.push("Volume besar tetapi kenaikan kecil");

    }

    // ==========================
    // Volume terus naik
    // ==========================

    if (volumes.length >= 3) {

        const v1 = volumes.at(-3);

        const v2 = volumes.at(-2);

        const v3 = volumes.at(-1);

        if (

            v1 < v2 &&

            v2 < v3

        ) {

            score += 5;

            reasons.push("Volume meningkat berturut-turut");

        }

    }

    // ==========================
    // Level
    // ==========================

    let level = "NORMAL";

    if (score >= 60)

        level = "EXTREME";

    else if (score >= 40)

        level = "HIGH";

    else if (score >= 20)

        level = "WARNING";

    const confidence =

        Math.min(score * 1.5, 100);

    return {

        score,

        level,

        confidence,

        isDistribution: score >= 40,

        reasons

    };

}