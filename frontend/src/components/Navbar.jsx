import './Navbar.css';

export default function Navbar() {
    return (
        <nav className="navbar">
            <div className="navbar-container">
                {/* Logo */}
                <a href="/" className="navbar-logo">
                    <span className="logo-icon">🎬</span>
                    <span className="logo-text">FlickFindr</span>
                </a>

                {/* Navigation Links */}
                <ul className="navbar-menu">
                    <li className="navbar-item">
                        <a href="/" className="navbar-link active">
                            Home
                        </a>
                    </li>
                    <li className="navbar-item">
                        <a href="/movies" className="navbar-link">
                            Movies
                        </a>
                    </li>
                    <li className="navbar-item">
                        <a href="/search" className="navbar-link">
                            Search
                        </a>
                    </li>
                </ul>

                {/* Right Side - Search & Profile */}
                <div className="navbar-actions">
                    <button className="navbar-search-btn" aria-label="Search">
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
                    </button>
                    <div className="navbar-profile">
                        <span className="profile-avatar">👤</span>
                    </div>
                </div>
            </div>
        </nav>
    );
}
