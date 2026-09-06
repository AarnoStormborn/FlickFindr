import useLists from '../hooks/useLists';
import { ListsContext } from './useListsContext';

/** Provides the lists store to the whole app (cards, rows, detail page). */
export function ListsProvider({ children }) {
    const lists = useLists();
    return <ListsContext.Provider value={lists}>{children}</ListsContext.Provider>;
}

export default ListsProvider;
