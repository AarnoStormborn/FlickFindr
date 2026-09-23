import { useParams, useNavigate } from 'react-router-dom';
import BrowseGrid from '../components/BrowseGrid';
import { moodById, moodParams } from '../data/moods';
import './GenrePage.css';

/**
 * "See more" for a mood row. The mood's definition lives in data/moods.js, so
 * the row on the home page and this full result set can never disagree — they
 * are the same filters.
 */
export default function MoodPage() {
    const { id } = useParams();
    const navigate = useNavigate();

    const mood = moodById(id);
    const filters = moodParams(id);

    if (!mood || !filters) {
        return (
            <div className="genre-page">
                <div className="genre-error">
                    <p>Unknown mood.</p>
                    <button onClick={() => navigate('/')}>Back to Home</button>
                </div>
            </div>
        );
    }

    return (
        <div className="genre-page">
            <button className="back-button" onClick={() => navigate('/')}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m15 18-6-6 6-6" />
                </svg>
                Back
            </button>

            <BrowseGrid
                filters={filters}
                title={mood.displayName}
                subtitle={mood.caption}
                sortOptions={[
                    { value: 'rating', label: 'Rating' },
                    { value: 'movie_name', label: 'Name' },
                ]}
            />
        </div>
    );
}
