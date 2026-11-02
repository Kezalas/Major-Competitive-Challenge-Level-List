// https://stackoverflow.com/questions/3452546/how-do-i-get-the-youtube-video-id-from-a-url
export function getYoutubeIdFromUrl(url) {
    return url.match(
        /.*(?:youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=)([^#\&\?]*).*/,
    )?.[1] ?? '';
}

export function embed(video) {
    return `https://www.youtube.com/embed/${getYoutubeIdFromUrl(video)}`;
}

export function localize(num) {
    return num.toLocaleString(undefined, { minimumFractionDigits: 3 });
}

export function getThumbnailFromId(id) {
    return `https://img.youtube.com/vi/${id}/mqdefault.jpg`;
}

// https://stackoverflow.com/questions/2450954/how-to-randomize-shuffle-a-javascript-array
export function shuffle(array) {
    let currentIndex = array.length, randomIndex;

    // While there remain elements to shuffle.
    while (currentIndex != 0) {
        // Pick a remaining element.
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;

        // And swap it with the current element.
        [array[currentIndex], array[randomIndex]] = [
            array[randomIndex],
            array[currentIndex],
        ];
    }

    return array;
}

/** "240Hz", "CBF", "240Hz · CBF" – static JSON may also use "hz": "CBF" */
export function hzLabel(record) {
    const cbf = record?.cbf || String(record?.hz).toUpperCase() === 'CBF';
    const hz = Number(record?.hz) > 0 ? `${record.hz}Hz` : '';
    return [hz, cbf ? 'CBF' : ''].filter(Boolean).join(', ');
}

/** Route to a player's public profile */
export function playerRoute(name) {
    return `/player/${encodeURIComponent(name)}`;
}

/** 25 -> "25", 12.5 -> "12.5", 1234.567 -> "1,234.567" (for pack points) */
export function points(num) {
    return Number(num || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
}

/** CSS class for the top 3 ranks (gold / silver / bronze) */
export function podium(rank) {
    return { 1: 'rank--gold', 2: 'rank--silver', 3: 'rank--bronze' }[rank] ?? '';
}
