import { useState } from 'react';
import './MetadataForm.css';

const YEARS = [];
for (let y = new Date().getFullYear(); y >= 1980; y--) YEARS.push(y);

/**
 * Structured filter form for the metadata search mode.
 * Submits a StructuralSearchRequest (no free-text search required).
 */
export default function MetadataForm({ initial, onSearch }) {
    const [title, setTitle] = useState(initial?.query || '');
    const [genre, setGenre] = useState(initial?.genre || '');
    const [actor, setActor] = useState(initial?.stars || '');
    const [director, setDirector] = useState(initial?.directors || '');
    const [minYear, setMinYear] = useState(initial?.minYear ?? '');
    const [maxYear, setMaxYear] = useState(initial?.maxYear ?? '');
    const [minRating, setMinRating] = useState(initial?.minRating ?? '');
    const [sortBy, setSortBy] = useState(initial?.sortBy || 'rating');
    const [sortOrder, setSortOrder] = useState(initial?.sortOrder || 'desc');

    const submit = (e) => {
        e.preventDefault();
        onSearch({
            query: title || undefined,
            genre: genre || undefined,
            stars: actor || undefined,
            directors: director || undefined,
            minYear: minYear ? Number(minYear) : undefined,
            maxYear: maxYear ? Number(maxYear) : undefined,
            minRating: minRating ? Number(minRating) : undefined,
            sortBy,
            sortOrder,
        });
    };

    return (
        <form className="metadata-form" onSubmit={submit}>
            <div className="metadata-grid">
                <label className="metadata-field">
                    <span>Title contains</span>
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="e.g. dark knight"
                    />
                </label>
                <label className="metadata-field">
                    <span>Genre</span>
                    <input
                        type="text"
                        value={genre}
                        onChange={(e) => setGenre(e.target.value)}
                        placeholder="e.g. Drama, Sci-Fi"
                    />
                </label>
                <label className="metadata-field">
                    <span>Actor</span>
                    <input
                        type="text"
                        value={actor}
                        onChange={(e) => setActor(e.target.value)}
                        placeholder="e.g. Leonardo DiCaprio"
                    />
                </label>
                <label className="metadata-field">
                    <span>Director</span>
                    <input
                        type="text"
                        value={director}
                        onChange={(e) => setDirector(e.target.value)}
                        placeholder="e.g. Christopher Nolan"
                    />
                </label>
                <label className="metadata-field">
                    <span>Released from</span>
                    <select value={minYear} onChange={(e) => setMinYear(e.target.value)}>
                        <option value="">Any</option>
                        {YEARS.map((y) => (
                            <option key={y} value={y}>{y}</option>
                        ))}
                    </select>
                </label>
                <label className="metadata-field">
                    <span>Released to</span>
                    <select value={maxYear} onChange={(e) => setMaxYear(e.target.value)}>
                        <option value="">Any</option>
                        {YEARS.map((y) => (
                            <option key={y} value={y}>{y}</option>
                        ))}
                    </select>
                </label>
                <label className="metadata-field">
                    <span>Minimum rating</span>
                    <select value={minRating} onChange={(e) => setMinRating(e.target.value)}>
                        <option value="">Any</option>
                        {[9, 8, 7, 6, 5].map((r) => (
                            <option key={r} value={r}>{r}+</option>
                        ))}
                    </select>
                </label>
                <label className="metadata-field">
                    <span>Sort by</span>
                    <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                        <option value="rating">Rating</option>
                        <option value="release_year">Release year</option>
                        <option value="movie_name">Title</option>
                        <option value="runtime">Runtime</option>
                    </select>
                </label>
                <label className="metadata-field">
                    <span>Order</span>
                    <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
                        <option value="desc">High → low</option>
                        <option value="asc">Low → high</option>
                    </select>
                </label>
            </div>
            <div className="metadata-actions">
                <button type="submit" className="metadata-submit">Search movies</button>
            </div>
        </form>
    );
}