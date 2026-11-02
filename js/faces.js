/**
 * Difficulty faces for list levels, from the level's "rating"
 * (rate, featured, epic, legendary, mythic) and "difficulty"
 * (easy, medium, hard, insane, extreme). Missing/unknown -> null ("N/A").
 */
const RATINGS = ['rate', 'featured', 'epic', 'legendary', 'mythic'];
const DIFFICULTIES = ['easy', 'medium', 'hard', 'insane', 'extreme'];

export const ratingOptions = RATINGS;
export const difficultyOptions = DIFFICULTIES;

export function faceFile(rating, difficulty) {
    const r = String(rating ?? '').toLowerCase();
    const d = String(difficulty ?? '').toLowerCase();
    if (!RATINGS.includes(r) || !DIFFICULTIES.includes(d)) return null;
    // the only face that is not a PNG
    const ext = r === 'mythic' && d === 'insane' ? 'webp' : 'png';
    return `/assets/Faces/${r}_${d}.${ext}`;
}
