import { createContext, useContext } from 'react';

export const ListsContext = createContext(null);

export function useListsContext() {
    return useContext(ListsContext);
}
