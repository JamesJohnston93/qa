/**
 * Shopify Admin GraphQL mutation client (TAA-55) — one client exposing every
 * admin mutation TAA-53's probe proved: the order-edit chain, refundCreate
 * (targeted and untargeted), the fulfillment-order hold/release/move triad,
 * returnCreate/returnClose, and orderMarkAsPaid. Returns typed identifiers.
 * Asserts nothing, polls nothing, orchestrates nothing — that's TAA-57's
 * flows.
 *
 * Every mutation string and field name below is copied from
 * `ts/scripts/probe-admin-mutations.js` (read-only, TAA-53's committed
 * evidence) or `ts/signoffs/TAA-53-probe.md`, both confirmed live via Admin
 * GraphQL introspection against API 2025-10. No further introspection was
 * needed for the mutations themselves — see the sign-off for exact contract
 * detail. The one field this client needs that the probe's dump query also
 * used but this file doesn't get from a shared reader — `Order.transactions`,
 * for resolving the SALE transaction an untargeted refund attaches to — is
 * queried directly here (ORDER_SALE_TRANSACTION_QUERY) rather than folded
 * into readers/shopifyReader.ts's ORDER_QUERY, which this ticket only
 * extends with `fulfillmentOrders` (see that file).
 *
 * Composes a ShopifyClient (constructor takes an existing instance) rather
 * than extending it, so `execute()`'s auth/API-version/throttle-retry come
 * free and unchanged — same pattern readers/shopifyReader.ts already uses.
 * No module-global state: nothing here is constructed except from an
 * explicit ShopifyClient the caller already owns.
 *
 * Host protection — deliberately none added here. FulfilmentClient/
 * RejectClient (clients/fulfilment.ts, clients/reject.ts) each guard their
 * constructor against a non-staging host because they take an arbitrary
 * `baseUrl` from env. ShopifyClient carries no such guard and needs none:
 * it takes only a `Store` ("US"|"PS") and hardcodes both endpoints to their
 * staging hosts inside `getEndpoint()` (clients/shopify.ts:355-359) — there
 * is no production configuration anywhere in this project, and no
 * non-staging host is reachable through this construction path at all. A
 * guard here would be checking a condition that cannot occur. (Correcting
 * the ticket's claim: ShopifyClient.execute() does not carry an inherited
 * host guard either — this was verified by reading getEndpoint() directly.)
 *
 * refundCreate and the retry/double-refund risk — deliberately not
 * defended against beyond what ShopifyClient already does. `RefundInput`
 * has no idempotency-key field on 2025-10, and the probe confirmed a
 * repeated `Idempotency-Key` HTTP header does not deduplicate either (TAA-53
 * sign-off, order #9993) — so nothing at the Shopify API layer protects a
 * genuine duplicate call. The mechanism actually in play here is
 * `ShopifyClient.execute()`'s own retry, which fires only on two signals —
 * HTTP 429 or a GraphQL `THROTTLED` error — and both are Shopify's
 * documented cost-based throttle rejecting a request *before* it executes
 * (the query's calculated cost exceeds the available bucket, so the
 * mutation never runs). A retried refundCreate under this mechanism is not,
 * therefore, at risk of running twice — the retry only ever re-attempts a
 * call that never ran the first time. This reasoning rests on Shopify's
 * documented throttle model, not on something this session re-proved for
 * retries specifically (the probe tested the idempotency-key header, a
 * related but different question). No client-side lock or dedup cache was
 * added on top — that would be module-global state against project
 * convention, defending against a failure mode the throttle model's own
 * documentation says can't happen at this layer. A real double-refund risk
 * would come from a *caller* re-invoking createRefund after an ordinary
 * network timeout uncorrelated with THROTTLED (e.g. a dropped connection
 * after Shopify had already processed the mutation) — that risk belongs to
 * whoever calls this client repeatedly (TAA-57's flows), not to this client.
 */

import type { ShopifyClient } from "./shopify";

// ---------------------------------------------------------------------------
// Shared error shapes / helpers
// ---------------------------------------------------------------------------

interface UserError {
  field?: string[] | null;
  message: string;
}

interface UserErrorWithCode extends UserError {
  code?: string | null;
}

function assertNoUserErrors(label: string, userErrors: UserError[] | null | undefined): void {
  if (userErrors && userErrors.length > 0) {
    throw new Error(`${label} failed: ${JSON.stringify(userErrors)}`);
  }
}

// ---------------------------------------------------------------------------
// Order-edit chain: orderEditBegin -> AddVariant -> SetQuantity ->
// AddLineItemDiscount -> Commit (TAA-53 contract #1)
// ---------------------------------------------------------------------------

const ORDER_EDIT_BEGIN = `
  mutation Begin($id: ID!) {
    orderEditBegin(id: $id) {
      calculatedOrder { id lineItems(first: 20) { edges { node { id quantity variant { sku } } } } }
      userErrors { field message }
    }
  }
`;
const ORDER_EDIT_ADD_VARIANT = `
  mutation AddVariant($id: ID!, $variantId: ID!, $quantity: Int!) {
    orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity) {
      calculatedLineItem { id quantity }
      calculatedOrder { id }
      userErrors { field message }
    }
  }
`;
const ORDER_EDIT_SET_QUANTITY = `
  mutation SetQty($id: ID!, $lineItemId: ID!, $quantity: Int!) {
    orderEditSetQuantity(id: $id, lineItemId: $lineItemId, quantity: $quantity) {
      calculatedLineItem { id quantity editableQuantity }
      calculatedOrder { id }
      userErrors { field message }
    }
  }
`;
const ORDER_EDIT_ADD_DISCOUNT = `
  mutation AddDiscount($id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!) {
    orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) {
      calculatedLineItem { id }
      calculatedOrder { id }
      userErrors { field message }
    }
  }
`;
const ORDER_EDIT_COMMIT = `
  mutation Commit($id: ID!, $staffNote: String) {
    orderEditCommit(id: $id, notifyCustomer: false, staffNote: $staffNote) {
      order { id name edited }
      successMessages
      userErrors { field message }
    }
  }
`;

export interface EditCalculatedLineItem {
  id: string;
  quantity: number;
  sku: string | null;
}

export interface BeginEditResult {
  calculatedOrderId: string;
  lineItems: EditCalculatedLineItem[];
}

export interface AddVariantResult {
  calculatedLineItemId: string;
  quantity: number;
}

export interface SetQuantityResult {
  calculatedLineItemId: string;
  quantity: number;
  editableQuantity: number;
}

/**
 * Only the `fixedValue` form was live-confirmed by the probe
 * (`OrderEditAppliedDiscountInput` also has a `percentValue` alternative per
 * Shopify's schema shape for discount inputs elsewhere, but that branch was
 * never exercised here — not exposed until it has been).
 */
export interface EditDiscountInput {
  description: string;
  fixedValue: { amount: string; currencyCode: string };
}

export interface AddDiscountResult {
  calculatedLineItemId: string;
}

export interface CommitEditResult {
  orderId: string;
  orderName: string;
  edited: boolean | null;
}

// ---------------------------------------------------------------------------
// refundCreate, targeted and untargeted (TAA-53 contract #2)
// ---------------------------------------------------------------------------

const REFUND_CREATE = `
  mutation CreateRefund($input: RefundInput!) {
    refundCreate(input: $input) {
      order { id }
      refund { id note totalRefundedSet { shopMoney { amount currencyCode } } }
      userErrors { field message }
    }
  }
`;

/** `Order.transactions` is a plain list (confirmed by the probe's own already-introspected dump query), same field this client needs to find the SALE transaction an untargeted refund attaches to. */
const ORDER_SALE_TRANSACTION_QUERY = `
  query OrderSaleTransaction($id: ID!) {
    order(id: $id) {
      transactions {
        id
        kind
        gateway
      }
    }
  }
`;

export interface RefundLineItem {
  lineItemId: string;
  quantity: number;
  /** Only "NO_RESTOCK" was live-confirmed by the probe; other RestockType enum values are passed through unvalidated. */
  restockType?: string;
}

export interface CreateRefundResult {
  refundId: string;
  orderId: string;
  totalRefunded: number;
  currencyCode: string;
}

// ---------------------------------------------------------------------------
// fulfillmentOrderHold / ReleaseHold / Move (TAA-53 contracts #3, #4)
// ---------------------------------------------------------------------------

const FULFILLMENT_ORDER_HOLD = `
  mutation Hold($id: ID!, $fulfillmentHold: FulfillmentOrderHoldInput!) {
    fulfillmentOrderHold(id: $id, fulfillmentHold: $fulfillmentHold) {
      fulfillmentHold { id reason reasonNotes }
      fulfillmentOrder { id status }
      userErrors { field message code }
    }
  }
`;
const FULFILLMENT_ORDER_RELEASE_HOLD = `
  mutation ReleaseHold($id: ID!) {
    fulfillmentOrderReleaseHold(id: $id) {
      fulfillmentOrder { id status }
      userErrors { field message code }
    }
  }
`;
const FULFILLMENT_ORDER_MOVE = `
  mutation Move($id: ID!, $newLocationId: ID!) {
    fulfillmentOrderMove(id: $id, newLocationId: $newLocationId) {
      movedFulfillmentOrder { id status assignedLocation { location { id } } }
      userErrors { field message }
    }
  }
`;

/**
 * Real `FulfillmentHoldReason` enum, confirmed by introspection (TAA-53) —
 * NOT the wider set (`POTENTIAL_FRAUD`, etc.) some Shopify docs/blog posts
 * list, which are internal reason *codes* the backend writes to DynamoDB,
 * not GraphQL inputs a caller sends. `HIGH_RISK_OF_FRAUD` in translates to
 * the DynamoDB reason string `POTENTIAL_FRAUD` out — that translation is
 * the backend's concern, not this client's.
 */
export type FulfillmentHoldReason =
  | "AWAITING_PAYMENT"
  | "HIGH_RISK_OF_FRAUD"
  | "INCORRECT_ADDRESS"
  | "INVENTORY_OUT_OF_STOCK"
  | "UNKNOWN_DELIVERY_DATE"
  | "ONLINE_STORE_POST_PURCHASE_CROSS_SELL"
  | "AWAITING_RETURN_ITEMS"
  | "OTHER";

export interface HoldResult {
  fulfillmentHoldId: string;
  fulfillmentOrderId: string;
  status: string | null;
}

export interface ReleaseHoldResult {
  fulfillmentOrderId: string;
  status: string | null;
}

export interface MoveResult {
  movedFulfillmentOrderId: string;
  status: string | null;
  locationId: string | null;
}

// ---------------------------------------------------------------------------
// returnCreate / returnClose / orderMarkAsPaid (TAA-53 contracts #5, #6)
// ---------------------------------------------------------------------------

const RETURN_CREATE = `
  mutation CreateReturn($returnInput: ReturnInput!) {
    returnCreate(returnInput: $returnInput) {
      return { id name status }
      userErrors { field message code }
    }
  }
`;
const RETURN_CLOSE = `
  mutation CloseReturn($id: ID!) {
    returnClose(id: $id) {
      return { id name status closedAt }
      userErrors { field message code }
    }
  }
`;
const ORDER_MARK_AS_PAID = `
  mutation MarkPaid($input: OrderMarkAsPaidInput!) {
    orderMarkAsPaid(input: $input) {
      order { id name displayFinancialStatus }
      userErrors { field message }
    }
  }
`;

export interface CreateReturnLineItem {
  fulfillmentLineItemId: string;
  quantity: number;
  returnReason?: string;
}

export interface CreateReturnResult {
  returnId: string;
  name: string;
  status: string | null;
}

export interface CloseReturnResult {
  returnId: string;
  status: string | null;
  closedAt: string | null;
}

export interface MarkAsPaidResult {
  orderId: string;
  name: string;
  financialStatus: string | null;
}

// ---------------------------------------------------------------------------

export class ShopifyAdminClient {
  constructor(private readonly shopify: ShopifyClient) {}

  private async exec<T>(label: string, query: string, variables: Record<string, unknown>): Promise<T> {
    const result = await this.shopify.execute<T>(query, variables);
    if (result.errors && result.errors.length > 0) {
      throw new Error(`${label} GraphQL errors: ${JSON.stringify(result.errors)}`);
    }
    if (!result.data) {
      throw new Error(`${label} returned no data: ${JSON.stringify(result)}`);
    }
    return result.data;
  }

  async beginEdit(orderId: string): Promise<BeginEditResult> {
    const data = await this.exec<{
      orderEditBegin: {
        calculatedOrder: {
          id: string;
          lineItems: { edges: Array<{ node: { id: string; quantity: number; variant: { sku: string } | null } }> };
        } | null;
        userErrors: UserError[];
      };
    }>("orderEditBegin", ORDER_EDIT_BEGIN, { id: orderId });
    assertNoUserErrors("orderEditBegin", data.orderEditBegin.userErrors);
    const calc = data.orderEditBegin.calculatedOrder;
    if (!calc) {
      throw new Error(`orderEditBegin returned no calculatedOrder for ${orderId}`);
    }
    return {
      calculatedOrderId: calc.id,
      lineItems: calc.lineItems.edges.map((edge) => ({
        id: edge.node.id,
        quantity: edge.node.quantity,
        sku: edge.node.variant?.sku ?? null,
      })),
    };
  }

  async editAddVariant(calculatedOrderId: string, variantId: string, quantity: number): Promise<AddVariantResult> {
    const data = await this.exec<{
      orderEditAddVariant: {
        calculatedLineItem: { id: string; quantity: number } | null;
        userErrors: UserError[];
      };
    }>("orderEditAddVariant", ORDER_EDIT_ADD_VARIANT, { id: calculatedOrderId, variantId, quantity });
    assertNoUserErrors("orderEditAddVariant", data.orderEditAddVariant.userErrors);
    const li = data.orderEditAddVariant.calculatedLineItem;
    if (!li) {
      throw new Error(`orderEditAddVariant returned no calculatedLineItem for ${calculatedOrderId}`);
    }
    return { calculatedLineItemId: li.id, quantity: li.quantity };
  }

  async editSetQuantity(calculatedOrderId: string, lineItemId: string, quantity: number): Promise<SetQuantityResult> {
    const data = await this.exec<{
      orderEditSetQuantity: {
        calculatedLineItem: { id: string; quantity: number; editableQuantity: number } | null;
        userErrors: UserError[];
      };
    }>("orderEditSetQuantity", ORDER_EDIT_SET_QUANTITY, { id: calculatedOrderId, lineItemId, quantity });
    assertNoUserErrors("orderEditSetQuantity", data.orderEditSetQuantity.userErrors);
    const li = data.orderEditSetQuantity.calculatedLineItem;
    if (!li) {
      throw new Error(`orderEditSetQuantity returned no calculatedLineItem for ${lineItemId}`);
    }
    return { calculatedLineItemId: li.id, quantity: li.quantity, editableQuantity: li.editableQuantity };
  }

  async editAddDiscount(
    calculatedOrderId: string,
    lineItemId: string,
    discount: EditDiscountInput,
  ): Promise<AddDiscountResult> {
    const data = await this.exec<{
      orderEditAddLineItemDiscount: {
        calculatedLineItem: { id: string } | null;
        userErrors: UserError[];
      };
    }>("orderEditAddLineItemDiscount", ORDER_EDIT_ADD_DISCOUNT, { id: calculatedOrderId, lineItemId, discount });
    assertNoUserErrors("orderEditAddLineItemDiscount", data.orderEditAddLineItemDiscount.userErrors);
    const li = data.orderEditAddLineItemDiscount.calculatedLineItem;
    if (!li) {
      throw new Error(`orderEditAddLineItemDiscount returned no calculatedLineItem for ${lineItemId}`);
    }
    return { calculatedLineItemId: li.id };
  }

  async commitEdit(calculatedOrderId: string, staffNote?: string): Promise<CommitEditResult> {
    const data = await this.exec<{
      orderEditCommit: {
        order: { id: string; name: string; edited: boolean | null } | null;
        userErrors: UserError[];
      };
    }>("orderEditCommit", ORDER_EDIT_COMMIT, { id: calculatedOrderId, staffNote: staffNote ?? null });
    assertNoUserErrors("orderEditCommit", data.orderEditCommit.userErrors);
    const order = data.orderEditCommit.order;
    if (!order) {
      throw new Error(`orderEditCommit returned no order for ${calculatedOrderId}`);
    }
    return { orderId: order.id, orderName: order.name, edited: order.edited };
  }

  private async resolveSaleTransaction(orderId: string): Promise<{ id: string; gateway: string }> {
    const data = await this.exec<{
      order: { transactions: Array<{ id: string; kind: string; gateway: string }> } | null;
    }>("order sale-transaction lookup", ORDER_SALE_TRANSACTION_QUERY, { id: orderId });
    if (!data.order) {
      throw new Error(`order ${orderId} not found in Shopify (sale-transaction lookup)`);
    }
    const sale = data.order.transactions.find((tx) => tx.kind === "SALE");
    if (!sale) {
      throw new Error(`order ${orderId} has no SALE transaction to refund against (untargeted refund)`);
    }
    return sale;
  }

  /**
   * Omitting `lineItems` is the untargeted/appeasement form, which requires
   * `untargetedAmount` (no default — a real refund amount is never invented
   * here). See the class doc comment for how the retry/double-refund risk
   * is handled (deliberately, not by adding dedup logic here).
   */
  async createRefund(
    orderId: string,
    lineItems?: RefundLineItem[],
    untargetedAmount?: string,
  ): Promise<CreateRefundResult> {
    let input: Record<string, unknown>;
    if (lineItems && lineItems.length > 0) {
      input = {
        orderId,
        note: "TAA-55 admin client — targeted refund",
        notify: false,
        refundLineItems: lineItems.map((li) => ({
          lineItemId: li.lineItemId,
          quantity: li.quantity,
          restockType: li.restockType ?? "NO_RESTOCK",
        })),
      };
    } else {
      if (!untargetedAmount) {
        throw new Error("createRefund: untargetedAmount is required when lineItems is omitted (untargeted refund)");
      }
      const sale = await this.resolveSaleTransaction(orderId);
      input = {
        orderId,
        note: "TAA-55 admin client — untargeted/appeasement refund",
        notify: false,
        transactions: [
          { orderId, amount: untargetedAmount, gateway: sale.gateway, kind: "REFUND", parentId: sale.id },
        ],
      };
    }

    const data = await this.exec<{
      refundCreate: {
        order: { id: string } | null;
        refund: { id: string; totalRefundedSet: { shopMoney: { amount: string; currencyCode: string } } } | null;
        userErrors: UserError[];
      };
    }>("refundCreate", REFUND_CREATE, { input });
    assertNoUserErrors("refundCreate", data.refundCreate.userErrors);
    const refund = data.refundCreate.refund;
    const order = data.refundCreate.order;
    if (!refund || !order) {
      throw new Error(`refundCreate returned no refund/order: ${JSON.stringify(data.refundCreate)}`);
    }
    return {
      refundId: refund.id,
      orderId: order.id,
      totalRefunded: Number(refund.totalRefundedSet.shopMoney.amount),
      currencyCode: refund.totalRefundedSet.shopMoney.currencyCode,
    };
  }

  /** `notifyMerchant` is hardcoded off, matching every other mutation in this client and the rest of the codebase (no notifications from QA-originated actions). */
  async holdFulfillmentOrder(
    fulfillmentOrderId: string,
    reason: FulfillmentHoldReason,
    reasonNotes?: string,
  ): Promise<HoldResult> {
    const data = await this.exec<{
      fulfillmentOrderHold: {
        fulfillmentHold: { id: string; reason: string | null; reasonNotes: string | null } | null;
        fulfillmentOrder: { id: string; status: string | null } | null;
        userErrors: UserErrorWithCode[];
      };
    }>("fulfillmentOrderHold", FULFILLMENT_ORDER_HOLD, {
      id: fulfillmentOrderId,
      fulfillmentHold: { reason, reasonNotes: reasonNotes ?? null, notifyMerchant: false },
    });
    assertNoUserErrors("fulfillmentOrderHold", data.fulfillmentOrderHold.userErrors);
    const hold = data.fulfillmentOrderHold.fulfillmentHold;
    const fo = data.fulfillmentOrderHold.fulfillmentOrder;
    if (!hold || !fo) {
      throw new Error(`fulfillmentOrderHold returned no hold/fulfillmentOrder: ${JSON.stringify(data.fulfillmentOrderHold)}`);
    }
    return { fulfillmentHoldId: hold.id, fulfillmentOrderId: fo.id, status: fo.status };
  }

  async releaseHold(fulfillmentOrderId: string): Promise<ReleaseHoldResult> {
    const data = await this.exec<{
      fulfillmentOrderReleaseHold: {
        fulfillmentOrder: { id: string; status: string | null } | null;
        userErrors: UserErrorWithCode[];
      };
    }>("fulfillmentOrderReleaseHold", FULFILLMENT_ORDER_RELEASE_HOLD, { id: fulfillmentOrderId });
    assertNoUserErrors("fulfillmentOrderReleaseHold", data.fulfillmentOrderReleaseHold.userErrors);
    const fo = data.fulfillmentOrderReleaseHold.fulfillmentOrder;
    if (!fo) {
      throw new Error(`fulfillmentOrderReleaseHold returned no fulfillmentOrder for ${fulfillmentOrderId}`);
    }
    return { fulfillmentOrderId: fo.id, status: fo.status };
  }

  async moveFulfillmentOrder(fulfillmentOrderId: string, newLocationId: string): Promise<MoveResult> {
    const data = await this.exec<{
      fulfillmentOrderMove: {
        movedFulfillmentOrder: { id: string; status: string | null; assignedLocation: { location: { id: string } | null } | null } | null;
        userErrors: UserError[];
      };
    }>("fulfillmentOrderMove", FULFILLMENT_ORDER_MOVE, { id: fulfillmentOrderId, newLocationId });
    assertNoUserErrors("fulfillmentOrderMove", data.fulfillmentOrderMove.userErrors);
    const moved = data.fulfillmentOrderMove.movedFulfillmentOrder;
    if (!moved) {
      throw new Error(`fulfillmentOrderMove returned no movedFulfillmentOrder for ${fulfillmentOrderId}`);
    }
    return {
      movedFulfillmentOrderId: moved.id,
      status: moved.status,
      locationId: moved.assignedLocation?.location?.id ?? null,
    };
  }

  async createReturn(orderId: string, lineItems: CreateReturnLineItem[]): Promise<CreateReturnResult> {
    if (lineItems.length === 0) {
      throw new Error("createReturn requires at least one line item");
    }
    const data = await this.exec<{
      returnCreate: {
        return: { id: string; name: string; status: string | null } | null;
        userErrors: UserErrorWithCode[];
      };
    }>("returnCreate", RETURN_CREATE, {
      returnInput: {
        orderId,
        returnLineItems: lineItems.map((li) => ({
          fulfillmentLineItemId: li.fulfillmentLineItemId,
          quantity: li.quantity,
          returnReason: li.returnReason ?? "UNWANTED",
        })),
      },
    });
    assertNoUserErrors("returnCreate", data.returnCreate.userErrors);
    const ret = data.returnCreate.return;
    if (!ret) {
      throw new Error(`returnCreate returned no return for order ${orderId}`);
    }
    return { returnId: ret.id, name: ret.name, status: ret.status };
  }

  async closeReturn(returnId: string): Promise<CloseReturnResult> {
    const data = await this.exec<{
      returnClose: {
        return: { id: string; status: string | null; closedAt: string | null } | null;
        userErrors: UserErrorWithCode[];
      };
    }>("returnClose", RETURN_CLOSE, { id: returnId });
    assertNoUserErrors("returnClose", data.returnClose.userErrors);
    const ret = data.returnClose.return;
    if (!ret) {
      throw new Error(`returnClose returned no return for ${returnId}`);
    }
    return { returnId: ret.id, status: ret.status, closedAt: ret.closedAt };
  }

  async markAsPaid(orderId: string): Promise<MarkAsPaidResult> {
    const data = await this.exec<{
      orderMarkAsPaid: {
        order: { id: string; name: string; displayFinancialStatus: string | null } | null;
        userErrors: UserError[];
      };
    }>("orderMarkAsPaid", ORDER_MARK_AS_PAID, { input: { id: orderId } });
    assertNoUserErrors("orderMarkAsPaid", data.orderMarkAsPaid.userErrors);
    const order = data.orderMarkAsPaid.order;
    if (!order) {
      throw new Error(`orderMarkAsPaid returned no order for ${orderId}`);
    }
    return { orderId: order.id, name: order.name, financialStatus: order.displayFinancialStatus };
  }
}
