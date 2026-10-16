import { createContext, useContext } from 'react';

export const CloudSyncContext = createContext(null);
export const useCloudSync = () => useContext(CloudSyncContext);
