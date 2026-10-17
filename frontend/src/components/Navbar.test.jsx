import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import Navbar from './Navbar';
import { AuthContext } from '../context/authContext';

function Location() {
    const location = useLocation();
    return <output data-testid="location">{location.pathname}</output>;
}

function renderNavbar() {
    return render(
        <MemoryRouter initialEntries={['/']}>
            <AuthContext.Provider value={{ configured: true, user: null }}>
                <Navbar />
                <Routes>
                    <Route path="*" element={<Location />} />
                </Routes>
            </AuthContext.Provider>
        </MemoryRouter>,
    );
}

describe('Navbar mobile navigation', () => {
    it('has a button that exposes the hidden primary links', async () => {
        const user = userEvent.setup();
        renderNavbar();
        const toggle = screen.getByRole('button', { name: 'Open navigation menu' });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await user.click(toggle);
        expect(screen.getByRole('button', { name: 'Close navigation menu' })).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('link', { name: 'Concierge' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'My Lists' })).toBeInTheDocument();
        expect(within(document.querySelector('.navbar-menu')).getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    });

    it('closes the menu after navigating to Concierge or My Lists', async () => {
        const user = userEvent.setup();
        renderNavbar();
        await user.click(screen.getByRole('button', { name: 'Open navigation menu' }));
        await user.click(screen.getByRole('link', { name: 'Concierge' }));
        expect(screen.getByTestId('location')).toHaveTextContent('/chat');
        expect(screen.queryByRole('button', { name: 'Close navigation menu' })).toBeNull();

        await user.click(screen.getByRole('button', { name: 'Open navigation menu' }));
        await user.click(screen.getByRole('link', { name: 'My Lists' }));
        expect(screen.getByTestId('location')).toHaveTextContent('/lists');
        expect(screen.queryByRole('button', { name: 'Close navigation menu' })).toBeNull();
    });

    it('closes the menu with Escape', async () => {
        const user = userEvent.setup();
        renderNavbar();
        await user.click(screen.getByRole('button', { name: 'Open navigation menu' }));
        await user.keyboard('{Escape}');
        expect(screen.getByRole('button', { name: 'Open navigation menu' })).toHaveAttribute('aria-expanded', 'false');
    });
});
