export interface VerificationErrorShape {
  check: string;
  expected: string;
  actual: string;
}

export class VerificationError extends Error {
  constructor(public readonly details: VerificationErrorShape) {
    super(details.actual);
  }
}

export function assertOrderShape(order: { orderId: string; orderName: string }): void {
  if (!order.orderId || !order.orderName) {
    throw new VerificationError({
      check: "order_shape",
      expected: "order id and order name present",
      actual: JSON.stringify(order),
    });
  }
}
