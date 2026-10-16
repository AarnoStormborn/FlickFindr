import { API_BASE_URL } from './movies';

async function accountRequest(path, accessToken, options = {}) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            ...(options.headers ?? {}),
        },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(body?.detail || `Account sync failed (${response.status})`);
        error.status = response.status;
        throw error;
    }
    return body;
}

export function fetchAccountSync(accessToken) {
    return accountRequest('/account/sync', accessToken);
}

export function mergeAccountSync(accessToken, guestData) {
    return accountRequest('/account/sync/merge', accessToken, {
        method: 'POST',
        body: JSON.stringify(guestData),
    });
}

export function putAccountSync(accessToken, data) {
    return accountRequest('/account/sync', accessToken, {
        method: 'PUT',
        body: JSON.stringify(data),
    });
}
