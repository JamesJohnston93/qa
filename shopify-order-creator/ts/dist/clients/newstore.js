"use strict";
/**
 * NewStore API client with OAuth2 client-credentials authentication. Ports
 * newstore_client.py's retrying HTTP client faithfully (per ts-rewrite-dev-doc.md:
 * "Cleanest Python module — port faithfully").
 *
 * Auth flow: POST to the Keycloak token endpoint with client_id/client_secret,
 * cache the token, refresh proactively ~30s before it expires so a slow
 * NewStore call never gets caught with an expiring token mid-flight.
 *
 * Retry: network errors and 5xx are transient — retry with backoff (2s, then
 * 4s; 3 attempts total). 4xx means a bad payload or auth — raise immediately,
 * retrying a 400 would just get the same 400 again. Strict by design: no
 * fallback responses, no synthetic IDs — every failure surfaces the real
 * response body.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NewStoreClient = void 0;
const OAUTH_BASE_URL = "https://id.p.newstore.net/auth/realms";
const TENANT = "universalstore-staging";
const BASE_URL = "https://universalstore-staging.p.newstore.net";
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_DELAYS_MS = [2_000, 4_000];
class NewStoreClient {
    retryDelaysMs;
    token = null;
    tokenExpiresAt = 0; // epoch ms
    constructor(options = {}) {
        this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    }
    async get(path) {
        return this.request("GET", path);
    }
    async post(path, payload) {
        return this.request("POST", path, payload);
    }
    /**
     * Returns a valid access token, refreshing it proactively if it's missing
     * or within 30s of expiry. Not retried on failure (matches newstore_client.py
     * — only the request layer below retries; an auth failure should surface fast).
     */
    async getToken() {
        if (this.token && Date.now() < this.tokenExpiresAt - 30_000) {
            return this.token;
        }
        const tokenUrl = `${OAUTH_BASE_URL}/${TENANT}/protocol/openid-connect/token`;
        const response = await fetchWithTimeout(tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "client_credentials",
                client_id: this.clientId(),
                client_secret: this.clientSecret(),
            }),
        });
        if (!response.ok) {
            const body = await safeBody(response);
            throw new Error(`NewStore token request failed: ${response.status} ${response.statusText} — ${body}`);
        }
        const data = (await response.json());
        this.token = data.access_token;
        this.tokenExpiresAt = Date.now() + (data.expires_in ?? 300) * 1000;
        return this.token;
    }
    clientId() {
        const value = process.env.NS_STAGING_CLIENT_ID;
        if (!value) {
            throw new Error("Missing NS_STAGING_CLIENT_ID environment variable");
        }
        return value;
    }
    clientSecret() {
        const value = process.env.NS_STAGING_CLIENT_SECRET;
        if (!value) {
            throw new Error("Missing NS_STAGING_CLIENT_SECRET environment variable");
        }
        return value;
    }
    /**
     * Sends a request with retry-with-backoff on network failures and 5xx
     * responses; raises immediately on 4xx. Headers (and therefore the token)
     * are rebuilt fresh on every attempt.
     */
    async request(method, path, body) {
        const url = `${BASE_URL}${path}`;
        const totalAttempts = this.retryDelaysMs.length + 1;
        for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
            let response;
            try {
                response = await fetchWithTimeout(url, {
                    method,
                    headers: {
                        Authorization: `Bearer ${await this.getToken()}`,
                        "Content-Type": "application/json",
                    },
                    body: body !== undefined ? JSON.stringify(body) : undefined,
                });
            }
            catch (error) {
                // Network-level failure (DNS, refused connection, timeout/abort).
                if (attempt === totalAttempts) {
                    throw error;
                }
                await sleep(this.retryDelaysMs[attempt - 1]);
                continue;
            }
            if (response.status >= 400 && response.status < 500) {
                const responseBody = await safeBody(response);
                throw new Error(`NewStore request failed: ${response.status} ${response.statusText} — ${responseBody}`);
            }
            if (response.status >= 500) {
                if (attempt === totalAttempts) {
                    const responseBody = await safeBody(response);
                    throw new Error(`NewStore request failed: ${response.status} ${response.statusText} — ${responseBody}`);
                }
                await sleep(this.retryDelaysMs[attempt - 1]);
                continue;
            }
            return (await response.json());
        }
        // Unreachable: the loop above always returns or throws on its final attempt.
        throw new Error(`NewStore request to ${path} exhausted retries without a result`);
    }
}
exports.NewStoreClient = NewStoreClient;
async function fetchWithTimeout(url, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    }
    finally {
        clearTimeout(timer);
    }
}
async function safeBody(response) {
    try {
        return JSON.stringify(await response.json());
    }
    catch {
        return await response.text().catch(() => "");
    }
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
