"""
NewStore API client with OAuth2 client credentials authentication.

Handles token acquisition, caching, automatic refresh, and retry-with-backoff
on transient server errors. All NewStore API calls in this project go through
this client.

Authentication flow (OAuth2 client credentials):
  1. POST to the Keycloak token endpoint with client_id and client_secret.
  2. Receive a short-lived access token (typically 5 minutes).
  3. Include the token as a Bearer header on every API request.
  4. Automatically refresh the token before it expires (30s buffer).

Retry strategy:
  - Network errors (connection refused, timeout): retry with exponential backoff.
  - HTTP 5xx errors: transient server issues — retry with exponential backoff.
  - HTTP 4xx errors: bad payload or auth — raise immediately, no retry.
    (Retrying a 400 would just get the same 400 again.)

NewStore docs confirm that 5xx responses are often caused by transient gRPC
timeouts and the same payload can be safely re-submitted.
"""

import os
import time
import requests

# Base URL for the Keycloak identity provider that issues NewStore tokens.
OAUTH_BASE_URL = "https://id.p.newstore.net/auth/realms"

# Environment configs. Each entry maps an environment name to the NewStore
# tenant, API base URL, and the environment variable names that hold the
# OAuth2 credentials. Credentials are read from env vars (not hardcoded)
# so they don't end up in source control.
ENVS = {
    "staging": {
        "tenant":            "universalstore-staging",
        "base_url":          "https://universalstore-staging.p.newstore.net",
        "client_id_var":     "NS_STAGING_CLIENT_ID",       # env var name
        "client_secret_var": "NS_STAGING_CLIENT_SECRET",   # env var name
    },
    # Uncomment to enable production support:
    # "prod": {
    #     "tenant":            "universalstore",
    #     "base_url":          "https://universalstore.p.newstore.net",
    #     "client_id_var":     "NS_PROD_CLIENT_ID",
    #     "client_secret_var": "NS_PROD_CLIENT_SECRET",
    # },
}

REQUEST_TIMEOUT = 30   # seconds before a request is considered hung
MAX_RETRIES     = 3    # total attempts (1 original + 2 retries) on 5xx / network errors


class NewStoreClient:
    """
    Authenticated HTTP client for the NewStore REST API.

    Instantiate with an environment name ("staging" or "prod"). The module-level
    `staging_client` instance is shared across the codebase — import that
    rather than creating a new client each time.
    """

    def __init__(self, env: str = "staging"):
        if env not in ENVS:
            raise ValueError(f"Unknown NewStore env '{env}'. Valid options: {list(ENVS)}")

        cfg = ENVS[env]
        self.env           = env
        self.base_url      = cfg["base_url"]
        self.tenant        = cfg["tenant"]

        # Read credentials from environment variables at init time.
        # KeyError here means the variable isn't set — check your shell env.
        self.client_id     = os.environ[cfg["client_id_var"]]
        self.client_secret = os.environ[cfg["client_secret_var"]]

        # Token cache — populated on first API call and refreshed as needed.
        self._token: str | None = None
        self._token_expires_at: float = 0.0  # Unix timestamp

        # Reuse a single requests.Session for connection pooling across calls.
        self._session = requests.Session()

    # ------------------------------------------------------------------
    # Authentication
    # ------------------------------------------------------------------

    def _get_token(self) -> str:
        """
        Returns a valid access token, refreshing it proactively if needed.

        The 30-second buffer before expiry ensures we never send a request
        with a token that's about to expire mid-flight (especially important
        for slow NewStore operations like order injection).
        """
        # Return the cached token if it's still valid with margin to spare.
        if self._token and time.time() < self._token_expires_at - 30:
            return self._token

        # Token is missing or about to expire — request a fresh one.
        token_url = f"{OAUTH_BASE_URL}/{self.tenant}/protocol/openid-connect/token"
        resp = requests.post(token_url, data={
            "grant_type":    "client_credentials",
            "client_id":     self.client_id,
            "client_secret": self.client_secret,
        }, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()  # surfaces auth failures immediately

        data = resp.json()
        self._token = data["access_token"]
        # Store the absolute expiry time so we can compare against time.time() later.
        self._token_expires_at = time.time() + data.get("expires_in", 300)
        return self._token

    def _headers(self) -> dict:
        """Builds the Authorization and Content-Type headers for each request."""
        return {
            "Authorization": f"Bearer {self._get_token()}",
            "Content-Type":  "application/json",
        }

    # ------------------------------------------------------------------
    # Request dispatcher with retry logic
    # ------------------------------------------------------------------

    def _request(self, method: str, path: str, **kwargs) -> requests.Response:
        """
        Sends an HTTP request and returns the response.

        Applies retry-with-exponential-backoff on network failures and 5xx
        responses. Raises immediately on 4xx errors (client mistakes) since
        retrying a bad payload will never succeed.

        Backoff schedule: 2s after attempt 1, 4s after attempt 2.

        Args:
            method: HTTP method string ("GET", "POST", etc.).
            path:   API path relative to base_url (e.g. "/v0/d/fulfill_order").
            **kwargs: Passed directly to requests.Session.request (e.g. json=).
        """
        url = f"{self.base_url}{path}"
        kwargs.setdefault("timeout", REQUEST_TIMEOUT)
        kwargs["headers"] = self._headers()  # fresh token on every attempt

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                resp = self._session.request(method, url, **kwargs)

            except (requests.ConnectionError, requests.Timeout):
                # Network-level failure (DNS, refused connection, read timeout).
                if attempt == MAX_RETRIES:
                    raise  # exhausted retries — propagate to caller
                time.sleep(2 ** attempt)  # wait 2s, then 4s
                continue

            # --- 4xx: client error — payload or auth is wrong, don't retry ---
            if 400 <= resp.status_code < 500:
                # Include the response body in the exception so the caller can
                # see exactly what NewStore rejected (schema errors, etc.).
                try:
                    body = resp.json()
                except Exception:
                    body = resp.text
                raise requests.HTTPError(
                    f"{resp.status_code} {resp.reason} — {body}",
                    response=resp,
                )

            # --- 5xx: server error — transient, safe to retry same payload ---
            if resp.status_code >= 500:
                if attempt == MAX_RETRIES:
                    try:
                        body = resp.json()
                    except Exception:
                        body = resp.text
                    raise requests.HTTPError(
                        f"{resp.status_code} {resp.reason} — {body}",
                        response=resp,
                    )
                time.sleep(2 ** attempt)  # wait 2s, then 4s before next attempt
                continue

            # --- 2xx / 3xx: success ---
            return resp

    # ------------------------------------------------------------------
    # Public HTTP methods
    # All return the parsed JSON response body as a dict.
    # ------------------------------------------------------------------

    def post(self, path: str, payload: dict) -> dict:
        """Sends a POST request with a JSON body. Used for order injection."""
        resp = self._request("POST", path, json=payload)
        return resp.json()

    def get(self, path: str, params: dict | None = None) -> dict:
        """Sends a GET request with optional query parameters."""
        resp = self._request("GET", path, params=params)
        return resp.json()

    def patch(self, path: str, payload: dict) -> dict:
        """Sends a PATCH request with a JSON body (partial update)."""
        resp = self._request("PATCH", path, json=payload)
        return resp.json()

    def put(self, path: str, payload: dict) -> dict:
        """Sends a PUT request with a JSON body (full replacement)."""
        resp = self._request("PUT", path, json=payload)
        return resp.json()


# ---------------------------------------------------------------------------
# Shared client instance
# Import this in other modules rather than instantiating NewStoreClient directly.
# A single instance means the OAuth token is shared and reused across calls.
# ---------------------------------------------------------------------------
staging_client = NewStoreClient("staging")
