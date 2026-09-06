import { NavLink } from 'react-router-dom';
import './Navbar.css';

export default function Navbar() {
    const activeClass = ({ isActive }) => (isActive ? 'navbar-link active' : 'navbar-link');
    return (
        <nav className="navbar">
            <div className="navbar-container">
                {/* Logo */}
                <NavLink to="/" className="navbar-logo">
                    <span className="logo-mark">Flick<em>Findr</em></span>
                </NavLink>

                {/* Navigation Links */}
                <ul className="navbar-menu">
                    <li className="navbar-item">
                        <NavLink to="/" end className={activeClass}>
                            Home
                        </NavLink>
                    </li>
                    <li className="navbar-item">
                        <NavLink to="/search" className={activeClass}>
                            Search
                        </NavLink>
                    </li>
                    <li className="navbar-item">
                        <NavLink to="/lists" className={activeClass}>
                            My Lists
                        </NavLink>
                    </li>
                </ul>

                {/* Right Side - Search button (icon) */}
                <div className="navbar-actions">
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
                </div>
            </div>
        </nav>
    );
}