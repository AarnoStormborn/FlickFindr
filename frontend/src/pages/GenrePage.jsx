import { useParams, useNavigate } from 'react-router-dom';
import BrowseGrid from '../components/BrowseGrid';
import './GenrePage.css';

/** Sort options offered on a genre browse (Metascore is absent on purpose: the
 *  column is empty for every film in the catalogue, so the button could only
 *  ever reorder nothing). */
const SORT_OPTIONS = [
    { value: 'rating', label: 'Rating' },
    { value: 'movie_name', label: 'Name' },
    { value: 'runtime', label: 'Runtime' },
];

export default function GenrePage() {
    const { name } = useParams();
    const navigate = useNavigate();

    const title = name ? `${name.charAt(0).toUpperCase()}${name.slice(1)} Movies` : 'Movies';

    return (
        <div className="genre-page">
            <button className="back-button" onClick={() => navigate('/')}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m15 18-6-6 6-6" />
                </svg>
                Back
            </button>

            <BrowseGrid
                filters={{ genre: name }}
                title={title}
                countLabel="movies found"
                sortOptions={SORT_OPTIONS}
            />
        </div>
    );
}
