#!/usr/bin/env node
/**
 * TAA-46 slice A — read-only Admin GraphQL probe that dumps the publication,
 * catalog and status configuration of a SKU pool, plus a stock read, so the
 * reference profile a purchasable SKU must match can be derived from
 * observation rather than assumed from docs.
 *
 * Standalone dev script, same shape as fetch-sku-gids.js (TAA-14/TAA-22):
 * not part of the harness build (tsconfig only includes src/**\/*.ts), but
 * reuses the compiled ShopifyClient/DynamoClient/config/variants (TAA-22,
 * TAA-13) rather than re-porting auth or AWS credential logic. Gets US's
 * static token, PS's OAuth client-credentials grant, Shopify throttle
 * retry, and AWS SSO credentials for free.
 *
 * Read-only: GraphQL queries only (no publishablePublish/Unpublish), and a
 * DynamoDB Query (getAllLocationsForSku) with no writes. No orders placed.
 *
 * Strict by design, same as every other client in this project: a refused
 * GraphQL field (missing scope) throws with the response body attached,
 * rather than omitting that part of the profile and printing a partial one.
 * A missing scope is itself the finding.
 *
 * Usage: node dump-availability.js <US|PS>
 */

const fs = require("fs");
const path = require("path");
const { ShopifyClient } = require("../dist/clients/shopify.js");
const { DynamoClient } = require("../dist/clients/dynamo.js");
const { defaultConfig, AGGREGATE_LOCATIONS } = require("../dist/config.js");
const { US_SKU_ORDER, PS_SKU_ORDER, variantsFor } = require("../dist/variants.js");

const CANDIDATE_COUNT = 3;

/**
 * Top-level publications, once per store — not per product. Publication.catalog
 * was tried here first and observed to always resolve null for every
 * publication on US (channel publications like Online Store/POS don't carry
 * a linked Catalog through this field) — so market membership is pulled
 * separately via the top-level `catalogs` query instead. Kept minimal:
 * required for the core reference profile, throws hard on any error.
 */
const PUBLICATIONS_QUERY = `
  query publications {
    publications(first: 25) {
      nodes {
        id
        name
      }
    }
  }
`;

/**
 * Market side of the ticket's field list. `catalogs(first:)` itself needs
 * no extra scope (confirmed live) and returns every MarketCatalog/AppCatalog
 * with title/status — required, throws hard like everything else. The
 * `markets` sub-field on MarketCatalog is a separate, later addition here
 * because it was observed live to need a scope US's static token doesn't
 * have ("Access denied for markets field", ACCESS_DENIED) — exactly the
 * scope-gap risk this ticket's sharp edges called out. Recording that gap
 * is this slice's job; losing the rest of an otherwise-successful dump over
 * one supplementary field is not what the "strict, no fallback" rule is
 * for, so only THIS query's failure is caught, verbatim, into the output —
 * every other field in this script still throws hard and uncaught.
 */
const CATALOGS_QUERY = `
  query catalogs {
    catalogs(first: 25) {
      nodes { id title status __typename }
    }
  }
`;

const CATALOGS_WITH_MARKETS_QUERY = `
  query catalogsWithMarkets {
    catalogs(first: 25) {
      nodes {
        id
        __typename
        ... on MarketCatalog {
          markets(first: 10) { nodes { id name } }
        }
      }
    }
  }
`;

/**
 * Resolves each variant GID straight to its parent product's status and
 * publication state in one batched request (ProductVariant.product), plus
 * a targeted publishedOnPublication check against whichever publication
 * PUBLICATIONS_QUERY found that looks like the storefront channel — see
 * findStorefrontPublication below. $storefrontPublicationId is required by
 * the query shape whenever it's included, so callers that couldn't find one
 * omit that field entirely (buildProductQuery(false)) rather than passing a
 * synthetic id.
 */
function buildProductQuery(includeTargetedCheck) {
  return `
    query variantAvailability($ids: [ID!]!${includeTargetedCheck ? ", $storefrontPublicationId: ID!" : ""}) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          id
          sku
          product {
            id
            title
            status
            resourcePublicationsV2(first: 25) {
              nodes {
                publication { id name }
                isPublished
                publishDate
              }
            }
            unpublishedPublications(first: 25) {
              nodes { id name }
            }
            ${includeTargetedCheck ? "publishedOnPublication(publicationId: $storefrontPublicationId)" : ""}
          }
        }
      }
    }
  `;
}

function assertNoErrors(result, label) {
  if (result.errors && result.errors.length > 0) {
    throw new Error(`${label} failed: ${JSON.stringify(result.errors)}`);
  }
  if (!result.data) {
    throw new Error(`${label} returned no data: ${JSON.stringify(result)}`);
  }
}

/**
 * Finds the publication that represents the storefront (Online Store)
 * channel by observed name, not an assumed doc spelling — matched
 * case-insensitively against whatever spelling staging actually returns.
 * Returns null (not a throw) if nothing matches: absence of a
 * storefront-like publication is a legitimate finding to record, not a
 * refused field.
 */
function findStorefrontPublication(publications) {
  return publications.find((p) => /online store/i.test(p.name)) ?? null;
}

async function fetchPublications(client) {
  const result = await client.execute(PUBLICATIONS_QUERY, {});
  assertNoErrors(result, "publications query");
  return result.data.publications.nodes;
}

/**
 * Returns { catalogs, marketsScopeGap }. catalogs always comes from the
 * required base query (throws hard on failure, like everything else here).
 * marketsScopeGap is null unless the markets sub-field was refused, in
 * which case it carries the exact error body — see CATALOGS_WITH_MARKETS_QUERY's
 * comment for why only this one query gets a catch instead of a throw.
 */
async function fetchCatalogs(client) {
  const base = await client.execute(CATALOGS_QUERY, {});
  assertNoErrors(base, "catalogs query");
  const catalogs = base.data.catalogs.nodes;

  const withMarkets = await client.execute(CATALOGS_WITH_MARKETS_QUERY, {});
  if (withMarkets.errors && withMarkets.errors.length > 0) {
    return { catalogs, marketsScopeGap: { error: withMarkets.errors } };
  }
  const marketsById = new Map(
    withMarkets.data.catalogs.nodes.map((n) => [n.id, n.markets ? n.markets.nodes : null]),
  );
  return {
    catalogs: catalogs.map((c) => ({ ...c, markets: marketsById.get(c.id) ?? null })),
    marketsScopeGap: null,
  };
}

async function fetchProductProfiles(client, targets, storefrontPublicationId) {
  const includeTargetedCheck = storefrontPublicationId !== null;
  const query = buildProductQuery(includeTargetedCheck);
  const variables = { ids: targets.map((t) => t.gid) };
  if (includeTargetedCheck) {
    variables.storefrontPublicationId = storefrontPublicationId;
  }
  const result = await client.execute(query, variables);
  assertNoErrors(result, "variant availability query");

  const bySku = new Map();
  for (const node of result.data.nodes) {
    if (!node) continue; // a stale/deleted variant GID — a real finding, surfaced via the missing-node check below
    bySku.set(node.sku, node);
  }

  return targets.map((target) => {
    const node = bySku.get(target.sku);
    if (!node) {
      throw new Error(
        `variant ${target.gid} (sku ${target.sku}) resolved to no node — stale GID or deleted variant`,
      );
    }
    const product = node.product;
    return {
      sku: target.sku,
      inPool: target.inPool,
      variantGid: node.id,
      productId: product.id,
      productTitle: product.title,
      status: product.status,
      resourcePublications: product.resourcePublicationsV2.nodes.map((n) => ({
        publicationId: n.publication.id,
        publicationName: n.publication.name,
        isPublished: n.isPublished,
        publishDate: n.publishDate,
      })),
      unpublishedPublications: product.unpublishedPublications.nodes.map((n) => ({
        publicationId: n.id,
        publicationName: n.name,
      })),
      publishedOnStorefrontPublication: includeTargetedCheck ? product.publishedOnPublication : null,
    };
  });
}

/**
 * Per JJ's comment on the ticket: reject cycles exhaust a SKU's real
 * per-store stock by attrition (rejection doesn't restore what allocation
 * decremented), so the reference profile must also confirm a SKU holds
 * stock SOMEWHERE, not merely that it exists. Aggregate/mirror locations
 * (config.ts's AGGREGATE_LOCATIONS) are excluded from the total the same
 * way verify/inventory.ts excludes them from decrement assertions — they
 * are not independent real stock.
 */
async function fetchStock(dynamoClient, sku) {
  const locations = await dynamoClient.getAllLocationsForSku(sku);
  const real = locations.filter((loc) => !AGGREGATE_LOCATIONS.includes(loc.store));
  const totalRealStock = real.reduce((sum, loc) => sum + loc.quantity, 0);
  return { locations: real, totalRealStock };
}

function loadCandidates(store, poolSkus) {
  const skuListsDir = path.join(__dirname, "..", "..", "sku-lists");
  const listPath = path.join(skuListsDir, `${store.toLowerCase()}-skus.json`);
  const entries = JSON.parse(fs.readFileSync(listPath, "utf8"));
  const poolSet = new Set(poolSkus);
  const candidates = entries.filter((e) => !poolSet.has(e.sku)).slice(0, CANDIDATE_COUNT);
  if (candidates.length < CANDIDATE_COUNT) {
    throw new Error(
      `only found ${candidates.length}/${CANDIDATE_COUNT} non-pool candidate SKUs in ${listPath}`,
    );
  }
  return candidates.map((e) => ({ sku: e.sku, gid: e.gid }));
}

/**
 * Summarizes the known-good pool's profiles into the reference: whether
 * every entry agrees on status/publication/stock shape, and what the
 * agreed values are where they do. Reports disagreement rather than
 * silently picking a majority value — divergence within the "known-good"
 * 14 is itself worth seeing, not smoothing over.
 */
function summarizePoolProfile(poolProfiles, stockBySku) {
  const statuses = new Set(poolProfiles.map((p) => p.status));
  const publishedNameSets = poolProfiles.map((p) =>
    JSON.stringify(p.resourcePublications.filter((r) => r.isPublished).map((r) => r.publicationName).sort()),
  );
  const uniquePublishedSets = new Set(publishedNameSets);
  const unpublishedCounts = new Set(poolProfiles.map((p) => p.unpublishedPublications.length));
  const storefrontFlags = new Set(poolProfiles.map((p) => p.publishedOnStorefrontPublication));
  const zeroStockSkus = poolProfiles.filter((p) => stockBySku.get(p.sku).totalRealStock <= 0).map((p) => p.sku);

  return {
    slotCount: poolProfiles.length,
    statusAgreement: statuses.size === 1 ? [...statuses][0] : { divergent: [...statuses] },
    publishedPublicationsAgreement:
      uniquePublishedSets.size === 1 ? JSON.parse([...uniquePublishedSets][0]) : { divergent: [...uniquePublishedSets].map((s) => JSON.parse(s)) },
    unpublishedPublicationsCountAgreement: unpublishedCounts.size === 1 ? [...unpublishedCounts][0] : { divergent: [...unpublishedCounts] },
    publishedOnStorefrontPublicationAgreement: storefrontFlags.size === 1 ? [...storefrontFlags][0] : { divergent: [...storefrontFlags] },
    slotsWithZeroRealStock: zeroStockSkus,
  };
}

async function main() {
  const store = process.argv[2];
  if (store !== "US" && store !== "PS") {
    console.error("Usage: node dump-availability.js <US|PS>");
    process.exit(1);
  }

  const poolSkus = store === "US" ? US_SKU_ORDER : PS_SKU_ORDER;
  const variants = variantsFor(store);
  const poolTargets = poolSkus.map((sku) => ({ sku, gid: variants[sku], inPool: true }));
  const candidateTargets = loadCandidates(store, poolSkus).map((c) => ({ ...c, inPool: false }));
  const targets = [...poolTargets, ...candidateTargets];

  const shopifyClient = new ShopifyClient(store);
  const dynamoClient = new DynamoClient(defaultConfig());

  console.error(`Fetching publications for ${store}...`);
  const publications = await fetchPublications(shopifyClient);
  const storefrontPublication = findStorefrontPublication(publications);

  console.error(`Fetching catalogs (market side) for ${store}...`);
  const { catalogs, marketsScopeGap } = await fetchCatalogs(shopifyClient);
  if (marketsScopeGap) {
    console.error(
      `SCOPE GAP on ${store}: MarketCatalog.markets refused — ${JSON.stringify(marketsScopeGap.error)}`,
    );
  }
  if (!storefrontPublication) {
    console.error(
      `WARNING: no publication name matched /online store/i for ${store} — targeted publishedOnPublication check skipped, not a schema failure.`,
    );
  }

  console.error(`Fetching product/publication profiles for ${targets.length} SKUs on ${store}...`);
  const profiles = await fetchProductProfiles(
    shopifyClient,
    targets,
    storefrontPublication ? storefrontPublication.id : null,
  );

  console.error(`Reading stock for ${targets.length} SKUs on ${store}...`);
  const stockBySku = new Map();
  for (const target of targets) {
    stockBySku.set(target.sku, await fetchStock(dynamoClient, target.sku));
  }

  const profilesWithStock = profiles.map((p) => ({ ...p, stock: stockBySku.get(p.sku) }));
  const poolProfiles = profilesWithStock.filter((p) => p.inPool);
  const candidateProfiles = profilesWithStock.filter((p) => !p.inPool);
  const referenceProfile = summarizePoolProfile(poolProfiles, stockBySku);

  const output = {
    store,
    generatedAt: new Date().toISOString(),
    storefrontPublication: storefrontPublication
      ? { id: storefrontPublication.id, name: storefrontPublication.name }
      : null,
    publications,
    catalogs,
    marketsScopeGap,
    poolProfiles,
    candidateProfiles,
    referenceProfile,
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
