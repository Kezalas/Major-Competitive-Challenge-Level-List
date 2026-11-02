/**
 * Numbers of decimal digits to round to
 */
const scale = 3;

/**
 * Calculate the score awarded when having a certain percentage on a list level
 * @param {Number} rank Position on the list
 * @param {Number} percent Percentage of completion
 * @param {Number} minPercent Minimum percentage required
 * @returns {Number}
 */
export function score(rank, percent = 100, minPercent = 100) {
    if (rank > POINT_RANKS) {
        return 0;
    }
    if (rank > PROGRESS_RANKS && percent < 100) {
        return 0;
    }

    // Old formula
    /*
    let score = (100 / Math.sqrt((rank - 1) / 50 + 0.444444) - 50) *
        ((percent - (minPercent - 1)) / (100 - (minPercent - 1)));
    */
    // New formula
    let score = (-50*Math.pow(rank-1, 0.42) + 350) *
        ((percent - (minPercent - 1)) / (100 - (minPercent - 1)));

    score = Math.max(0, score);

    if (percent != 100) {
        return round(score - score / 3);
    }

    return Math.max(round(score), 0);
}

export function round(num) {
    if (!('' + num).includes('e')) {
        return +(Math.round(num + 'e+' + scale) + 'e-' + scale);
    } else {
        var arr = ('' + num).split('e');
        var sig = '';
        if (+arr[1] + scale > 0) {
            sig = '+';
        }
        return +(
            Math.round(+arr[0] + 'e' + sig + (+arr[1] + scale)) +
            'e-' +
            scale
        );
    }
}

/** Only ranks 1..100 give points. */
export const POINT_RANKS = 100;

/** Ranks 1..75 also accept progress records (from the level's "percent to qualify"). */
export const PROGRESS_RANKS = 75;

/** Lowest percentage a record on this rank needs. The list has no limit: every rank accepts records. */
export function minPercentFor(rank, percentToQualify) {
    if (rank > PROGRESS_RANKS) return 100;
    const p = Number(percentToQualify);
    return p >= 1 && p <= 100 ? p : 100;
}
