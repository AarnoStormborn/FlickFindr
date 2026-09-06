import { useState, useRef, useEffect } from 'react';
import './AddToListButton.css';

function stop(e) {
    // stop propagation (so card/row navigation doesn't fire) but DO NOT
    // preventDefault — that would cancel button/form default behaviour
    // (e.g. the submit button inside the create form).
    e.stopPropagation();
}

/**
 * Dropdown to save a movie into a list (or remove it). Used on the detail
 * page, grid cards and list rows. Lists already containing the movie show a
 * checkmark; clicking toggles membership.
 *
 * Props:
 *   movie         - the movie object (id, movie_name/title, poster_url, …)
 *   lists         - all lists (from useLists)
 *   toggleList    - (listId, movie) => void  (add if absent, remove if present)
 *   createAndSave - (name, movie) => void     (create a list and add movie)
 *   isSaved       - (movieId) => bool
 *   variant       - 'icon' (bare plus) | 'plain' (label button)
 */
export default function AddToListButton({ movie, lists, toggleList, createAndSave, isSaved, variant = 'plain' }) {
    const [open, setOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const rootRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => {
            if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    if (!movie) return null;

    const membership = (listId) =>
        lists.find((l) => l.id === listId)?.movies.some((m) => m.id === movie.id) ?? false;
    const savedAnywhere = isSaved ? isSaved(movie.id) : false;

    const handleToggle = (listId) => {
        toggleList(listId, movie);
        setOpen(false);
    };

    const handleCreate = (e) => {
        e.preventDefault();
        const name = newName.trim();
        if (!name) return;
        const existing = lists.find((l) => l.name.toLowerCase() === name.toLowerCase());
        if (existing) {
            toggleList(existing.id, movie);
        } else if (createAndSave) {
            createAndSave(name, movie);
        } else {
            toggleList('__pending__', movie); // no-op guard
        }
        setNewName('');
        setCreating(false);
        setOpen(false);
    };

    return (
        <div className="add-to-list" ref={rootRef} onClick={stop}>
            <button
                type="button"
                className={`add-to-list-trigger ${variant === 'icon' ? 'icon' : ''} ${savedAnywhere ? 'saved' : ''}`}
                onClick={(e) => {
                    stop(e);
                    setOpen((o) => !o);
                }}
                aria-haspopup="menu"
                aria-expanded={open}
                title={savedAnywhere ? 'Saved — manage lists' : 'Save to list'}
            >
                {variant === 'icon' ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill={savedAnywhere ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                        <path d="M12 5v14M5 12h14" />
                    </svg>
                ) : (
                    <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
                        </svg>
                        {savedAnywhere ? 'Saved' : 'Save'}
                    </>
                )}
            </button>

            {open && (
                <div className="add-to-list-menu" role="menu" onClick={stop}>
                    <div className="add-to-list-title">
                        {(movie.movie_name || movie.title || 'Movie').slice(0, 48)}
                    </div>
                    <div className="add-to-list-items">
                        {lists.map((list) => (
                            <button
                                key={list.id}
                                type="button"
                                className="add-to-list-item"
                                role="menuitem"
                                onClick={(e) => {
                                    stop(e);
                                    handleToggle(list.id);
                                }}
                            >
                                <span className="add-to-list-item-name">{list.name}</span>
                                {membership(list.id) && <span className="add-to-list-check">✓</span>}
                            </button>
                        ))}
                        {lists.length === 0 && <div className="add-to-list-empty">No lists yet</div>}
                    </div>
                    {creating ? (
                        <form className="add-to-list-create" onSubmit={handleCreate} onClick={stop}>
                            <input
                                autoFocus
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="New list name…"
                                onClick={stop}
                            />
                            <button type="submit">Add</button>
                        </form>
                    ) : (
                        <button
                            type="button"
                            className="add-to-list-new"
                            onClick={(e) => {
                                stop(e);
                                setCreating(true);
                            }}
                        >
                            + New list
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}