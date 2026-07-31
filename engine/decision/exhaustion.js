// =========================================
// Exhaustion Detector
// Version 1.0
// =========================================

export function calculateExhaustion({
    closePrices = [],
    highPrices = [],
    lowPrices = [],
    volume = [],
    rsi = 50,
    bollinger = {}
}) {

    let score = 0;
    const reasons = [];

    const latestClose = closePrices.at(-1);

    // ==========================
    // 1. RSI Overbought
    // ==========================

    if (rsi >= 80) {
        score += 20;
        reasons.push("RSI extremely overbought");
    } else if (rsi >= 72) {
        score += 10;
        reasons.push("RSI overbought");
    }

    // ==========================
    // 2. Rally 3 Hari
    // ==========================

    if (closePrices.length >= 4) {

        const gain3 =
            ((latestClose - closePrices.at(-4))
            / closePrices.at(-4)) * 100;

        if (gain3 >= 15) {
            score += 15;
            reasons.push("3-day rally >15%");
        } else if (gain3 >= 10) {
            score += 10;
            reasons.push("3-day rally >10%");
        }

    }

    // ==========================
    // 3. Rally 5 Hari
    // ==========================

    if (closePrices.length >= 6) {

        const gain5 =
            ((latestClose - closePrices.at(-6))
            / closePrices.at(-6)) * 100;

        if (gain5 >= 20) {
            score += 15;
            reasons.push("5-day rally >20%");
        }

    }

    // ==========================
    // 4. Bollinger Band
    // ==========================

    if (bollinger.upper) {

        if (latestClose > bollinger.upper) {

            score += 10;

            reasons.push("Close above Upper BB");

        } else {

            const distance =
                ((bollinger.upper - latestClose)
                / latestClose) * 100;

            if (distance <= 1) {

                score += 5;

                reasons.push("Near Upper BB");

            }

        }

    }

    // ==========================
    // 5. Upper Shadow
    // ==========================

    if (
        highPrices.length &&
        lowPrices.length &&
        closePrices.length
    ) {

        const high = highPrices.at(-1);

        const low = lowPrices.at(-1);

        const body = Math.abs(latestClose - low);

        const upperShadow = high - latestClose;

        if (
            body > 0 &&
            upperShadow >= body * 2
        ) {

            score += 10;

            reasons.push("Long upper shadow");

        }

    }

    // ==========================
    // 6. Volume Weakening
    // ==========================

    if (volume.length >= 3) {

        const v1 = volume.at(-3);

        const v2 = volume.at(-2);

        const v3 = volume.at(-1);

        if (v1 > v2 && v2 > v3) {

            score += 10;

            reasons.push("Volume weakening");

        }

    }

    // ==========================

    let level = "NORMAL";

    if (score >= 50)
        level = "EXTREME";
    else if (score >= 31)
        level = "HIGH";
    else if (score >= 16)
        level = "WARNING";

    return {

        score,

        level,

        reasons

    };

}