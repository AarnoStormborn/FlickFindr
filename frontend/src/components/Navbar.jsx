import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/authContext';
import './Navbar.css';

export default function Navbar() {
    const { user, configured } = useAuth();
    const [menuOpen, setMenuOpen] = useState(false);
    const activeClass = ({ isActive }) => (isActive ? 'navbar-link active' : 'navbar-link');
    const closeMenu = () => setMenuOpen(false);
    return (
        <nav className="navbar" onKeyDown={(event) => { if (event.key === 'Escape') closeMenu(); }}>
            <div className="navbar-container">
                {/* Logo */}
                <NavLink to="/" className="navbar-logo">
                    <span className="logo-mark">Flick<em>Findr</em></span>
                </NavLink>

                {/* Navigation Links */}
                <ul id="primary-navigation" className={`navbar-menu ${menuOpen ? 'is-open' : ''}`}>
                    <li className="navbar-item">
                        <NavLink to="/" end className={activeClass} onClick={closeMenu}>
                            Home
                        </NavLink>
                    </li>
                    <li className="navbar-item">
                        <NavLink to="/search" className={activeClass} onClick={closeMenu}>
                            Search
                        </NavLink>
                    </li>
                    <li className="navbar-item">
                        <NavLink to="/chat" className={activeClass} onClick={closeMenu}>
                            Concierge
                        </NavLink>
                    </li>
                    <li className="navbar-item">
                        <NavLink to="/lists" className={activeClass} onClick={closeMenu}>
                            My Lists
                        </NavLink>
                    </li>
                    {configured && (
                        <li className="navbar-item navbar-account-menu-item">
                            <NavLink to="/account" className={activeClass} onClick={closeMenu}>
                                {user ? 'Account' : 'Sign in'}
                            </NavLink>
                        </li>
                    )}
                </ul>

                {/* Right Side - Search button (icon) */}
                <div className="navbar-actions">
                    {configured && (
                        <NavLink to="/account" className="navbar-account-link">
                            {user ? 'Account' : 'Sign in'}
                        </NavLink>
                    )}
                    <NavLink to="/search" className="navbar-search-btn" aria-label="Search">
                        <svg
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                        >
                            <circle cx="11" cy="11" r="8" />
                            <path d="m21 21-4.35-4.35" />
                        </svg>
                    </NavLink>
                    <button
                        className="navbar-menu-toggle"
                        type="button"
                        aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
                        aria-expanded={menuOpen}
                        aria-controls="primary-navigation"
                        onClick={() => setMenuOpen((open) => !open)}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                            {menuOpen ? <path d="m6 6 12 12M18 6 6 18" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
                        </svg>
                    </button>
                </div>
            </div>
        </nav>
    );
}