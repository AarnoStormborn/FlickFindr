import { beforeEach, describe, expect, it } from 'vitest';
import {
  WATCH_LATER_ID,
  addToList,
  createList,
  deleteList,
  emptyListsData,
  loadLists,
  movieInAnyList,
  movieSnapshot,
  removeFromList,
  renameList,
} from './listsStore';

/**
 * The lists store is local-first: it owns the on-disk shape, and a bad read
 * here silently wipes a user's saved movies. It had 18% coverage.
 */
const KEY = 'flickfindr-lists';

const movie = (over = {}) => ({
    id: 1,
    movie_name: 'Heat',
    poster_url: 'https://img/heat.jpg',
    release_year: 1995,
    rating: 8.3,
    ...over,
});

beforeEach(() => {
    localStorage.clear();
});

describe('loadLists', () => {
    it('seeds the default data when nothing is stored', () => {
        const data = loadLists();
        expect(data.v).toBe(1);
        expect(data.lists.map((l) => l.id)).toEqual([WATCH_LATER_ID]);
    });

    it('returns emptyListsData for corrupt JSON instead of throwing', () => {
        localStorage.setItem(KEY, '{not json');
        expect(loadLists()).toEqual(expect.objectContaining({ v: 1 }));
    });

    it('rejects a payload with a non-array lists field', () => {
        localStorage.setItem(KEY, JSON.stringify({ v: 1, lists: 'nope' }));
        expect(loadLists().lists).toHaveLength(1);
    });

    it('rejects an unknown version', () => {
        localStorage.setItem(KEY, JSON.stringify({ v: 2, lists: [] }));
        expect(loadLists().lists.map((l) => l.id)).toEqual([WATCH_LATER_ID]);
    });

    it('re-injects Watch later if it was removed', () => {
        localStorage.setItem(KEY, JSON.stringify({ v: 1, lists: [{ id: 'x', name: 'X', createdAt: 1, movies: [] }] }));
        const data = loadLists();
        expect(data.lists[0].id).toBe(WATCH_LATER_ID);
        expect(data.lists).toHaveLength(2);
    });

    it('round-trips a valid stored payload', () => {
        const data = createList(emptyListsData(), 'Favorites');
        const loaded = loadLists();
        expect(loaded.lists.map((l) => l.name)).toEqual(['Watch later', 'Favorites']);
        expect(loaded).toEqual(data);
    });
});

describe('movieSnapshot', () => {
    it('maps API fields to the snapshot shape', () => {
        const s = movieSnapshot(movie());
        expect(s).toMatchObject({ id: 1, title: 'Heat', poster: 'https://img/heat.jpg', year: 1995, rating: 8.3 });
        expect(typeof s.addedAt).toBe('number');
    });

    it('accepts an already-snapped movie (title field)', () => {
        expect(movieSnapshot({ id: 2, title: 'Heat' }).title).toBe('Heat');
    });

    it('falls back to a synthetic title when the name is missing', () => {
        expect(movieSnapshot({ id: 7 }).title).toBe('Movie 7');
    });

    it('nulls out optional fields', () => {
        const s = movieSnapshot({ id: 3, movie_name: 'X' });
        expect(s.poster).toBeNull();
        expect(s.year).toBeNull();
        expect(s.rating).toBeNull();
    });
});

describe('addToList', () => {
    it('prepends and persists', () => {
        const data = addToList(emptyListsData(), WATCH_LATER_ID, movieSnapshot(movie()));
        expect(data.lists[0].movies).toHaveLength(1);
        expect(JSON.parse(localStorage.getItem(KEY)).lists[0].movies[0].title).toBe('Heat');
    });

    it('is a no-op when the movie is already saved', () => {
        const once = addToList(emptyListsData(), WATCH_LATER_ID, movieSnapshot(movie()));
        const twice = addToList(once, WATCH_LATER_ID, movieSnapshot(movie()));
        expect(twice.lists[0].movies).toHaveLength(1);
    });

    it('does not touch other lists', () => {
        let data = createList(emptyListsData(), 'Other');
        data = addToList(data, WATCH_LATER_ID, movieSnapshot(movie()));
        const other = data.lists.find((l) => l.name === 'Other');
        expect(other.movies).toEqual([]);
    });

    it('ignores an unknown list id', () => {
        const data = addToList(emptyListsData(), 'nope', movieSnapshot(movie()));
        expect(data.lists.every((l) => l.movies.length === 0)).toBe(true);
    });
});

describe('removeFromList', () => {
    it('removes the movie and persists', () => {
        let data = addToList(emptyListsData(), WATCH_LATER_ID, movieSnapshot(movie()));
        data = removeFromList(data, WATCH_LATER_ID, 1);
        expect(data.lists[0].movies).toEqual([]);
        expect(JSON.parse(localStorage.getItem(KEY)).lists[0].movies).toEqual([]);
    });

    it('leaves other lists alone', () => {
        let data = addToList(emptyListsData(), WATCH_LATER_ID, movieSnapshot(movie()));
        data = createList(data, 'X');
        const otherId = data.lists.find((l) => l.name === 'X').id;
        data = addToList(data, otherId, movieSnapshot(movie({ id: 99 })));
        data = removeFromList(data, WATCH_LATER_ID, 1);
        expect(data.lists.find((l) => l.id === otherId).movies).toHaveLength(1);
    });
});

describe('movieInAnyList', () => {
    it('is false for an empty store', () => {
        expect(movieInAnyList(emptyListsData(), 1)).toBe(false);
    });

    it('finds a movie in any list, not just the default', () => {
        let data = createList(emptyListsData(), 'X');
        const otherId = data.lists.find((l) => l.name === 'X').id;
        data = addToList(data, otherId, movieSnapshot(movie()));
        expect(movieInAnyList(data, 1)).toBe(true);
    });
});

describe('createList', () => {
    it('trims the name', () => {
        const data = createList(emptyListsData(), '  Picked  ');
        expect(data.lists.at(-1).name).toBe('Picked');
    });

    it('refuses an empty or whitespace name', () => {
        expect(createList(emptyListsData(), '   ').lists).toHaveLength(1);
        expect(createList(emptyListsData(), '').lists).toHaveLength(1);
    });

    it('refuses a duplicate name, case-insensitively', () => {
        let data = createList(emptyListsData(), 'Favorites');
        data = createList(data, 'favorites');
        expect(data.lists).toHaveLength(2);
    });

    it('generates unique ids', () => {
        let data = emptyListsData();
        data = createList(data, 'A');
        data = createList(data, 'B');
        const ids = data.lists.map((l) => l.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('renameList', () => {
    it('renames a user list and persists it', () => {
        let data = createList(emptyListsData(), 'Old');
        const id = data.lists.find((l) => l.name === 'Old').id;
        data = renameList(data, id, 'New');
        expect(data.lists.find((l) => l.id === id).name).toBe('New');
        expect(JSON.parse(localStorage.getItem(KEY)).lists.find((l) => l.id === id).name).toBe('New');
    });

    it('refuses to rename the default Watch later list', () => {
        const data = renameList(emptyListsData(), WATCH_LATER_ID, 'Hijacked');
        expect(data.lists[0].name).toBe('Watch later');
    });

    it('refuses an empty name', () => {
        let data = createList(emptyListsData(), 'Keep');
        const id = data.lists.find((l) => l.name === 'Keep').id;
        data = renameList(data, id, '  ');
        expect(data.lists.find((l) => l.id === id).name).toBe('Keep');
    });
});

describe('deleteList', () => {
    it('removes a user list', () => {
        let data = createList(emptyListsData(), 'Gone');
        const id = data.lists.find((l) => l.name === 'Gone').id;
        data = deleteList(data, id);
        expect(data.lists.find((l) => l.id === id)).toBeUndefined();
        expect(JSON.parse(localStorage.getItem(KEY)).lists.find((l) => l.id === id)).toBeUndefined();
    });

    it('never deletes the default list', () => {
        const data = deleteList(emptyListsData(), WATCH_LATER_ID);
        expect(data.lists.map((l) => l.id)).toEqual([WATCH_LATER_ID]);
    });

    it('does not delete other lists', () => {
        let data = createList(emptyListsData(), 'A');
        data = createList(data, 'B');
        const a = data.lists.find((l) => l.name === 'A').id;
        data = deleteList(data, a);
        expect(data.lists.map((l) => l.name)).toEqual(['Watch later', 'B']);
    });
});
