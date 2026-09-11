import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// React Testing Library doesn't auto-clean between tests outside of Jest's
// globals, so do it explicitly.
afterEach(() => {
  cleanup();
});

// jsdom lacks matchMedia; components (e.g. LoadingQuips) query it.
if (!globalThis.matchMedia) {
  globalThis.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

// jsdom has no scrollTo/scrollBy on elements; MovieCarousel uses scrollBy.
if (!Element.prototype.scrollBy) {
  Element.prototype.scrollBy = vi.fn();
}

// Keep test output quiet about expected fetch failures unless asserted.
globalThis.fetch = globalThis.fetch ?? vi.fn();
