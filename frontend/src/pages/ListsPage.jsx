import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useListsContext } from '../context/useListsContext';
import './ListsPage.css';

const FALLBACK = 'https://via.placeholder.com/300x450?text=No+Poster';

export default function ListsPage() {
    const navigate = useNavigate();
    const listsApi = useListsContext();
    const { lists, removeList, unsaveMovie } = listsApi;
    const [newListOpen, setNewListOpen] = useState(false);
    const [newListName, setNewListName] = useState('');

    const createNew = (e) => {
        e.preventDefault();
        const name = newListName.trim();
        if (!name) return;
        listsApi.addList(name);
        setNewListName('');
        setNewListOpen(false);
    };

    if (!listsApi) return null;

    return (
        <div className="lists-page">
            <button className="back-button" onClick={() => navigate('/')}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m15 18-6-6 6-6" />
                </svg>
                Back
            </button>

            <header className="lists-header">
                <h1 className="lists-title">My Lists</h1>
                <button className="lists-new-btn" onClick={() => setNewListOpen((v) => !v)}>
                    + New list
                </button>
            </header>

            {newListOpen && (
                <form className="lists-create" onSubmit={createNew}>
                    <input
                        autoFocus
                        value={newListName}
                        onChange={(e) => setNewListName(e.target.value)}
                        placeholder="List name…"
                    />
                    <button type="submit">Create</button>
                    <button type="button" onClick={() => setNewListOpen(false)}>Cancel</button>
                </form>
            )}

            {lists.length === 0 ? (
                <p className="lists-empty">No lists yet — save a movie from its page to get started.</p>
            ) : (
                <div className="lists-grid">
                    {lists.map((list) => (
                        <section key={list.id} className="list-card">
                            <div className="list-card-head">
                                <h2 className="list-card-title">
                                    {list.name}
                                    <span className="list-count">{list.movies.length}</span>
                                </h2>
                                {list.id !== 'watch-later' && (
                                    <button
                                        className="list-delete"
                                        title="Delete list"
                                        onClick={() => {
                                            if (window.confirm(`Delete "${list.name}"?`)) removeList(list.id);
                                        }}
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>

                            {list.movies.length === 0 ? (
                                <p className="list-card-empty">
                                    {list.id === 'watch-later'
                                        ? 'Tap “Save” on any movie to watch it later.'
                                        : 'Empty list — add movies from their pages.'}
                                </p>
                            ) : (
                                <div className="list-movies-grid">
                                    {list.movies.map((m) => (
                                        <div key={m.id} className="list-movie-cell">
                                            <div className="list-movie-poster-wrap" onClick={() => navigate(`/movie/${m.id}`)}>
                                                <img
                                                    className="list-movie-poster"
                                                    src={m.poster || FALLBACK}
                                                    alt={m.title}
                                                    loading="lazy"
                                                    onError={(e) => { e.target.src = FALLBACK; }}
                                                />
                                                <button
                                                    className="list-remove-btn"
                                                    title="Remove from list"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        unsaveMovie(list.id, m.id);
                                                    }}
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                            <div className="list-movie-name">{m.title}</div>
                                            <div className="list-movie-meta">
                                                {m.year && <span>{m.year}</span>}
                                                {m.rating && <span className="list-rating">★ {m.rating.toFixed(1)}</span>}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    ))}
                </div>
            )}
        </div>
    );
}