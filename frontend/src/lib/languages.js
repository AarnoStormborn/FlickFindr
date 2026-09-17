/**
 * Language display helpers.
 *
 * The API deals in TMDB `original_language` codes ("en", "fr", "hi"). Rather
 * than hand-maintain names for the 88 languages our catalogue actually
 * contains, use `Intl.DisplayNames` and fall back to the uppercased code on
 * runtimes without it (older Safari, some test environments).
 */

/** A small fallback map for the codes we see most, used if Intl is missing. */
const COMMON = {
    en: 'English',
    fr: 'French',
    it: 'Italian',
    es: 'Spanish',
    ja: 'Japanese',
    de: 'German',
    hi: 'Hindi',
    ko: 'Korean',
    zh: 'Chinese',
    cn: 'Chinese (Cantonese)',
    ru: 'Russian',
    pt: 'Portuguese',
    tr: 'Turkish',
    ta: 'Tamil',
    te: 'Telugu',
    ml: 'Malayalam',
    th: 'Thai',
    sv: 'Swedish',
    da: 'Danish',
    no: 'Norwegian',
    nl: 'Dutch',
    pl: 'Polish',
    fa: 'Persian',
    ar: 'Arabic',
};

let displayNames;
try {
    displayNames = typeof Intl !== 'undefined' && Intl.DisplayNames
        ? new Intl.DisplayNames(['en'], { type: 'language' })
        : undefined;
} catch {
    displayNames = undefined;
}

/**
 * Human-readable name for a language code.
 * @param {string|null|undefined} code TMDB original_language, e.g. "fr"
 * @returns {string|null} e.g. "French"; null when there is no code
 */
export function languageName(code) {
    if (!code || typeof code !== 'string') return null;
    const key = code.trim().toLowerCase();
    if (!key) return null;
    try {
        const name = displayNames?.of(key);
        // Intl returns the input unchanged when it cannot resolve it, and
        // "und" is the ISO code for "undetermined" — neither is a real name.
        if (name && name !== key && name !== 'und') {
            return name.charAt(0).toUpperCase() + name.slice(1);
        }
    } catch {
        /* fall through to the map */
    }
    return COMMON[key] ?? key.toUpperCase();
}

/** "French (2,476)" style label for a facet entry. */
export function languageOptionLabel(entry) {
    const name = languageName(entry?.code) ?? entry?.code ?? '';
    const count = Number(entry?.count ?? 0);
    return count > 0 ? `${name} (${count.toLocaleString()})` : name;
}
