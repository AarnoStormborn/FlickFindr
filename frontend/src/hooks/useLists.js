import { useState, useCallback, useEffect } from 'react';
import {
    loadLists,
    movieSnapshot,
    addToList,
    removeFromList,
    createList,
    deleteList,
    movieInAnyList,
} from '../lib/listsStore';

/**
 * React wrapper over the localStorage lists store. All mutations return the
 * fresh data object so state stays in sync.
 */
export default function useLists() {
    const [data, setData] = useState(loadLists);

    // Cross-tab sync
    useEffect(() => {
        const onStorage = (e) => {
            if (e.key === 'flickfindr-lists') setData(loadLists());
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    const saveMovieToList = useCallback((listId, movie) => {
        const snapshot = movieSnapshot(movie);
        setData((prev) => addToList(prev, listId, snapshot));
    }, []);

    const unsaveMovie = useCallback((listId, movieId) => {
        setData((prev) => removeFromList(prev, listId, movieId));
    }, []);

    const addList = useCallback((name) => {
        setData((prev) => createList(prev, name));
    }, []);

    /** Create a new list and add a movie to it in one step. */
    const createListAndSave = useCallback((name, movie) => {
        const snapshot = movieSnapshot(movie);
        setData((prev) => {
            const withList = createList(prev, name);
            const list = withList.lists.find((l) => l.name.toLowerCase() === name.trim().toLowerCase());
            if (!list) return withList;
            return addToList(withList, list.id, snapshot);
        });
    }, []);

    const removeList = useCallback((listId) => {
        setData((prev) => deleteList(prev, listId));
    }, []);

    const isSaved = useCallback(
        (movieId) => movieInAnyList(data, movieId),
        [data],
    );

    /** Add if absent, remove if present. */
    const toggleMovieInList = useCallback((listId, movie) => {
        const snapshot = movieSnapshot(movie);
        setData((prev) => {
            const list = prev.lists.find((l) => l.id === listId);
            if (!list) return prev;
            const present = list.movies.some((m) => m.id === movie.id);
            return present ? removeFromList(prev, listId, movie.id) : addToList(prev, listId, snapshot);
        });
    }, []);

    return {
        lists: data.lists,
        data,
        saveMovieToList,
        unsaveMovie,
        toggleMovieInList,
        addList,
        createListAndSave,
        removeList,
        isSaved,
    };
}
