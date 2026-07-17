"""
GraphQL queries and mutations for the Shopify Admin API.

Each function returns a raw GraphQL string. They are kept as functions rather
than module-level string constants so they can be imported by name and so
each one stays easy to read, test, and diff in isolation.

How Shopify draft orders work (the three-step flow used by this tool):
  1. draftOrderCalculate  — calculates shipping rates without saving anything.
                            Used to fetch available rates before creating an order.
  2. draftOrderCreate     — saves a draft order. Does NOT charge the customer yet.
  3. draftOrderComplete   — finalises the draft, creating a real paid order.

API reference: https://shopify.dev/docs/api/admin-graphql
"""


def get_create_customer():
    """
    Mutation to create a new Shopify customer and return their ID.

    The returned ID (a GID like "gid://shopify/Customer/123") is stored in
    the customer pool in main.py and passed to every subsequent order call.
    """
    return """
    mutation customerCreate($input: CustomerInput!) {
        customerCreate(input: $input) {
            customer {
                id
            }
            userErrors {
                field
                message
            }
        }
    }
    """


def get_customer_by_email():
    """
    Query to check whether a customer already exists in Shopify by email.

    Returns the first matching customer's ID and email, or empty edges if
    none is found. Used by perform_stress_testing() to skip emails that
    already have accounts, preventing duplicate-customer errors.
    """
    return """
    query getCustomerByEmail($query: String!) {
        customers(first: 1, query: $query) {
            edges {
                node {
                    id
                    email
                }
            }
        }
    }
    """


def get_create_draft_order():
    """
    Mutation to create a new draft order and return its ID.

    The draft order is not yet confirmed or charged — it must be completed
    with draftOrderComplete before it becomes a real order.
    """
    return """
    mutation draftOrderCreate($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
            draftOrder {
                id
            }
            userErrors {
                field
                message
            }
        }
    }
    """


def get_complete_draft_order():
    """
    Mutation to complete (finalise) a draft order.

    Must be called after get_create_draft_order. This converts the draft into
    a real Shopify order and processes payment. Returns createdAt as a
    confirmation timestamp — if this field is present, the order was placed.
    """
    return """
    mutation draftOrderComplete($id: ID!) {
        draftOrderComplete(id: $id) {
            draftOrder {
                createdAt
            }
            userErrors {
                field
                message
            }
        }
    }
    """


def get_calculate_draft_order():
    """
    Mutation to calculate a draft order without saving it.

    Shopify uses the line items and shipping address to compute which shipping
    rates are available and their prices. This is used in two places:
      - Settings menu: to show the user all available rates so they can pin one.
      - Order placement: to fetch the rate handle needed by draftOrderCreate.

    Note: this is a mutation (not a query) because Shopify may perform internal
    calculations. It does NOT create or save anything.
    """
    return """
    mutation draftOrderCalculate($input: DraftOrderInput!) {
        draftOrderCalculate(input: $input) {
            calculatedDraftOrder {
                availableShippingRates {
                    handle
                    title
                    price {
                        amount
                        currencyCode
                    }
                }
            }
            userErrors {
                field
                message
            }
        }
    }
    """


def get_locations():
    """
    Query to fetch up to 20 fulfilment locations for the active store.

    Locations returned here include both warehouses and physical store locations.
    Used to populate the click-and-collect / local pickup option in the settings
    menu. Increase `first` if the store has more than 20 locations.
    """
    return """
    query {
        locations(first: 20) {
            edges {
                node {
                    id
                    name
                }
            }
        }
    }
    """


def get_variant_prices():
    """
    Query to fetch the current price for one or more product variants by GID.

    Accepts a list of variant GIDs and returns each variant's id and price.
    Uses the `nodes` interface (Shopify's batch-lookup by ID) to fetch all
    variants in a single request rather than one query per SKU.

    Used by newstore_orders._lookup_prices() to get real Shopify prices before
    injecting orders into NewStore, so the order totals match the actual RRP.
    """
    return """
    query getVariantPrices($ids: [ID!]!) {
        nodes(ids: $ids) {
            ... on ProductVariant {
                id
                price
            }
        }
    }
    """


