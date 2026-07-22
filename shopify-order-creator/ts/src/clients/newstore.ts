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

const OAUTH_BASE_URL = "https://id.p.newstore.net/auth/realms";
const TENANT = "universalstore-staging";
const BASE_URL = "https://universalstore-staging.p.newstore.net";
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_DELAYS_MS = [2_000, 4_000];

interface TokenResponse {
  access_token: string;
  expires_in?: number;
}

export interface NewStoreClientOptions {
  /** Overridable so tests don't have to wait out real backoff delays. */
  retryDelaysMs?: number[];
}

export class NewStoreClient {
  private readonly retryDelaysMs: number[];
  private token: string | null = null;
  private tokenExpiresAt = 0; // epoch ms

  constructor(options: NewStoreClientOptions = {}) {
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  }

  async get<T = unknown>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async post<T = unknown>(path: string, payload: unknown): Promise<T> {
    return this.request<T>("POST", path, payload);
  }

  /**
   * Returns a valid access token, refreshing it proactively if it's missing
   * or within 30s of expiry. Not retried on failure (matches newstore_client.py
   * — only the request layer below retries; an auth failure should surface fast).
   */
  private async getToken(): Promise<string> {
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

    const data = (await response.json()) as TokenResponse;
    this.token = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in ?? 300) * 1000;
    return this.token;
  }

  private clientId(): string {
    const value = process.env.NS_STAGING_CLIENT_ID;
    if (!value) {
      throw new Error("Missing NS_STAGING_CLIENT_ID environment variable");
    }
    return value;
  }

  private clientSecret(): string {
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
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${BASE_URL}${path}`;
    const totalAttempts = this.retryDelaysMs.length + 1;

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetchWithTimeout(url, {
          method,
          headers: {
            Authorization: `Bearer ${await this.getToken()}`,
            "Content-Type": "application/json",
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch (error) {
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

      return (await response.json()) as T;
    }

    // Unreachable: the loop above always returns or throws on its final attempt.
    throw new Error(`NewStore request to ${path} exhausted retries without a result`);
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function safeBody(response: Response): Promise<string> {
  try {
    return JSON.stringify(await response.json());
  } catch {
    return await response.text().catch(() => "");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
