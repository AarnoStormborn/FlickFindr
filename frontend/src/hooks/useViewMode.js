import { useState } from 'react';

const VIEW_KEY = 'flickfindr-view';

function getViewPref() {
    try {
        return localStorage.getItem(VIEW_KEY) || 'grid';
    } catch {
        return 'grid';
    }
}

function setViewPref(view) {
    try {
        localStorage.setItem(VIEW_KEY, view);
    } catch {
        /* ignore */
    }
}

/** Shared view-mode state (grid/list), persisted to localStorage. */
export default function useViewMode() {
    const [view, setView] = useState(getViewPref);
    const changeView = (next) => {
        setView(next);
        setViewPref(next);
    };
    return [view, changeView];
}