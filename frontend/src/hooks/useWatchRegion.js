import { useCallback, useState } from 'react';

/**
 * Remembered region for "Where to watch".
 *
 * Region lives in localStorage, like the view mode and the lists — the app has
 * no accounts, and the choice is a viewing preference rather than data. The
 * default is India, matching where the catalogue's owner lives; the API
 * configures which regions exist at all (WATCH_REGIONS).
 */

const REGION_KEY = 'flickfindr-watch-region';
const DEFAULT_REGION = 'IN';

/** Names for the regions the API is configured with. */
export const REGION_NAMES = {
    IN: 'India',
    US: 'United States',
    GB: 'United Kingdom',
    CA: 'Canada',
    AU: 'Australia',
};

function readRegion() {
    try {
        return localStorage.getItem(REGION_KEY) || DEFAULT_REGION;
    } catch {
        return DEFAULT_REGION;
    }
}

function writeRegion(code) {
    try {
        localStorage.setItem(REGION_KEY, code);
    } catch {
        /* storage unavailable — the chooser still works for this session */
    }
}

export default function useWatchRegion() {
    const [region, setRegion] = useState(readRegion);
    const choose = useCallback((code) => {
        setRegion(code);
        writeRegion(code);
    }, []);
    return [region, choose];
}
