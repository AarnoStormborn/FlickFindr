// Dev fallback — prod overwrites this via the nginx entrypoint (API_BASE_URL).
// An empty value makes the client resolve the base from the hostname (dev -> :8001).
window.__FLICKFINDR_API__ = "";
