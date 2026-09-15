import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import ViewToggle from '../components/ViewToggle';
import useViewMode from '../hooks/useViewMode';

const VIEW_KEY = 'flickfindr-view';

beforeEach(() => {
    localStorage.clear();
});

describe('ViewToggle', () => {
    it('renders both modes in an accessible group', () => {
        render(<ViewToggle view="grid" onChange={() => {}} />);
        expect(screen.getByRole('group', { name: /view mode/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /grid view/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /list view/i })).toBeInTheDocument();
    });

    it('marks the active mode', () => {
        const { rerender } = render(<ViewToggle view="grid" onChange={() => {}} />);
        expect(screen.getByRole('button', { name: /grid view/i })).toHaveClass('active');
        expect(screen.getByRole('button', { name: /list view/i })).not.toHaveClass('active');

        rerender(<ViewToggle view="list" onChange={() => {}} />);
        expect(screen.getByRole('button', { name: /list view/i })).toHaveClass('active');
    });

    it('reports the clicked mode', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<ViewToggle view="grid" onChange={onChange} />);
        await user.click(screen.getByRole('button', { name: /list view/i }));
        expect(onChange).toHaveBeenCalledWith('list');
    });
});

describe('useViewMode', () => {
    it('defaults to grid with nothing stored', () => {
        const { result } = renderHook(() => useViewMode());
        expect(result.current[0]).toBe('grid');
    });

    it('restores a stored preference', () => {
        localStorage.setItem(VIEW_KEY, 'list');
        const { result } = renderHook(() => useViewMode());
        expect(result.current[0]).toBe('list');
    });

    it('persists a change so it survives a remount', () => {
        const first = renderHook(() => useViewMode());
        act(() => first.result.current[1]('list'));
        expect(localStorage.getItem(VIEW_KEY)).toBe('list');

        const second = renderHook(() => useViewMode());
        expect(second.result.current[0]).toBe('list');
    });
});
