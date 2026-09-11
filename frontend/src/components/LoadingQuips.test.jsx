import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoadingQuips from './LoadingQuips';
import { QUICK_QUIPS, SLOW_QUIPS } from './quipPools';

/** The single currently-displayed quip. */
function currentQuip() {
  const el = document.querySelector('.loading-quips span');
  return el ? el.textContent : null;
}

describe('LoadingQuips', () => {
  const originalMatchMedia = globalThis.matchMedia;

  beforeEach(() => {
    vi.useFakeTimers();
    // Default: motion allowed.
    globalThis.matchMedia = (query) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.matchMedia = originalMatchMedia;
  });

  it('renders a quip from the quick pool', () => {
    render(<LoadingQuips />);
    expect(QUICK_QUIPS).toContain(currentQuip());
  });

  it('rotates to a different quip after the interval', () => {
    render(<LoadingQuips />);
    const first = currentQuip();
    act(() => {
      vi.advanceTimersByTime(2600);
    });
    const second = currentQuip();
    expect(second).not.toBe(first);
    expect(QUICK_QUIPS).toContain(second);
  });

  it('escalates to the slow pool after 6s (cold start)', () => {
    render(<LoadingQuips />);
    act(() => {
      vi.advanceTimersByTime(6100);
    });
    expect(SLOW_QUIPS).toContain(currentQuip());
  });

  it('shows a single static line under prefers-reduced-motion', () => {
    globalThis.matchMedia = (query) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    });

    render(<LoadingQuips />);
    const first = currentQuip();
    expect(first).toBe('Rolling the film…');

    act(() => {
      vi.advanceTimersByTime(20000);
    });
    // No rotation, and no escalation either.
    expect(currentQuip()).toBe(first);
  });

  it('clears timers on unmount (no state updates after teardown)', () => {
    const { unmount } = render(<LoadingQuips />);
    unmount();
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(20000);
      });
    }).not.toThrow();
  });
});
