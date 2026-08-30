/**
 * Order-edit chain — TAA-57. Drives orderEditBegin -> AddVariant ->
 * (optional AddLineItemDiscount) -> Commit and waits for the new ITEM# row
 * to land in staging-orders-v2 alongside its ADD_ITEM TRANSACTION# row.
 * Mirrors flows/fulfilFlow.ts's shape: a pure predicate over already-fetched
 * rows, plus a thin waitFor* wrapper calling pollUntil.
 *
 * The settle window is a harness-wide stage, not flow-specific — see
 * config.ts's DEFAULT_POLL_WINDOWS.ordersService for why (shared with
 * holdFlow.ts, which lands through the same staging-orders-v2 webhook
 * pipeline) and for the headroom reasoning. This file only carries the
 * interval, which is not itself in PollWindows (same split fulfilFlow.ts /
 * rejectFlow.ts already use for their own local stage intervals).
 *
 * ADD_ITEM vs CREATE_ORDER — why the predicate matches on event, not just
 * sku. Both transaction event types carry an `itemChanges.added[]` array
 * (US-hold-outstanding-edit-9998.json: CREATE_ORDER's itemChanges.added has
 * sku "33754369", the order's original line; a later, separate TRANSACTION#
 * row with event "ADD_ITEM" carries sku "33906898", the item this edit
 * chain added). Matching on sku alone would false-positive immediately if
 * the added sku happened to coincide with anything already on the order at
 * creation time — matching on event="ADD_ITEM" is the only way to be sure
 * the row observed is really this edit's own effect, not the order's
 * original creation.
 *
 * `itemChanges`/`onHoldChanges` are not on TransactionRow's typed surface
 * (readers/dynamoReader.ts, read-only to this ticket) — both are read off
 * `TransactionRow.raw`, the reader's own documented escape hatch for
 * per-event payloads it doesn't type.
 */

import type { Store } from "../config";
import { DEFAULT_POLL_WINDOWS } from "../config";
import type {
  DynamoReader,
  OrderItemRow,
  TransactionRow,
} from "../readers/dynamoReader";
import { orderItemRowsFromRows, transactionRowsFromRows } from "../readers/dynamoReader";
import type {
  AddDiscountResult,
  CommitEditResult,
  EditDiscountInput,
  ShopifyAdminClient,
} from "../clients/shopifyAdmin";
import { pollUntil, type PollResult } from "../polling";

export const ORDERS_SERVICE_SETTLE_WINDOW_SECONDS = DEFAULT_POLL_WINDOWS.ordersService;
export const ORDERS_SERVICE_SETTLE_INTERVAL_SECONDS = 2;

/** `itemChanges.added[].sku` off one TRANSACTION# row's raw payload — [] if the event carries no itemChanges (see dynamoReader.ts's TransactionRow doc comment). */
function addedSkusFrom(transaction: TransactionRow): string[] {
  const itemChanges = (transaction.raw as Record<string, unknown>).itemChanges as
    | { added?: Array<{ sku?: unknown }> }
    | undefined;
  if (!itemChanges || !Array.isArray(itemChanges.added)) {
    return [];
  }
  return itemChanges.added.map((entry) => String(entry.sku ?? ""));
}

/**
 * True once the added sku has a landed ITEM# row AND a matching ADD_ITEM
 * TRANSACTION# row naming that sku — either alone is not enough: the ITEM#
 * row can land before the event log entry (or vice versa; no ordering
 * between the two is documented anywhere in this project, unlike the
 * fulfilment settle's trackingNumber/status ordering, which TAA-41 pinned
 * down explicitly). Pure — offline-testable.
 */
export function editSettled(items: OrderItemRow[], transactions: TransactionRow[], addedSku: string): boolean {
  const itemLanded = items.some((item) => item.sku === addedSku);
  const eventLanded = transactions.some(
    (t) => t.event === "ADD_ITEM" && addedSkusFrom(t).includes(addedSku),
  );
  return itemLanded && eventLanded;
}

export interface EditRowState {
  items: OrderItemRow[];
  transactions: TransactionRow[];
}

/** One fetch, composed off getOrderRows (a single Dynamo query) — same pattern getOrderItemRows/getOrderTransactions each use individually, but this needs both from the same row set per poll tick. */
async function fetchEditRowState(reader: DynamoReader, store: Store, orderIdTail: string): Promise<EditRowState> {
  const rows = await reader.getOrderRows(store, orderIdTail);
  return { items: orderItemRowsFromRows(rows), transactions: transactionRowsFromRows(rows) };
}

export async function waitForEditSettled(
  reader: DynamoReader,
  store: Store,
  orderIdTail: string,
  addedSku: string,
  verbose = false,
): Promise<PollResult<EditRowState>> {
  return pollUntil(
    () => fetchEditRowState(reader, store, orderIdTail),
    (state) => editSettled(state.items, state.transactions, addedSku),
    ORDERS_SERVICE_SETTLE_WINDOW_SECONDS,
    ORDERS_SERVICE_SETTLE_INTERVAL_SECONDS,
    "edit_settle",
    verbose,
  );
}

export interface EditOrderDeps {
  admin: ShopifyAdminClient;
  reader: DynamoReader;
  verbose?: boolean;
}

export interface AddItemToOrderResult {
  orderId: string;
  calculatedOrderId: string;
  addedLineItemId: string;
  addedSku: string;
  discount: AddDiscountResult | null;
  committed: CommitEditResult;
  settledElapsedSeconds: number;
}

/**
 * Adds one variant to an order via the edit chain and waits for it to
 * settle in staging-orders-v2. `discount` is optional (holdFlow.ts's
 * OUTSTANDING_PAYMENT route needs a plain unpaid add, no discount;
 * TAA-53's probed edit chain used one to prove the discount contract, kept
 * here as an option rather than a second near-duplicate function).
 */
export async function addItemToOrder(
  deps: EditOrderDeps,
  store: Store,
  orderId: string,
  orderIdTail: string,
  variantId: string,
  sku: string,
  quantity = 1,
  discount?: EditDiscountInput,
  staffNote?: string,
): Promise<AddItemToOrderResult> {
  const { admin, reader, verbose = false } = deps;

  const begin = await admin.beginEdit(orderId);
  const added = await admin.editAddVariant(begin.calculatedOrderId, variantId, quantity);

  let discountResult: AddDiscountResult | null = null;
  if (discount) {
    discountResult = await admin.editAddDiscount(begin.calculatedOrderId, added.calculatedLineItemId, discount);
  }

  const committed = await admin.commitEdit(begin.calculatedOrderId, staffNote);
  const { elapsed } = await waitForEditSettled(reader, store, orderIdTail, sku, verbose);

  return {
    orderId: committed.orderId,
    calculatedOrderId: begin.calculatedOrderId,
    addedLineItemId: added.calculatedLineItemId,
    addedSku: sku,
    discount: discountResult,
    committed,
    settledElapsedSeconds: elapsed,
  };
}
