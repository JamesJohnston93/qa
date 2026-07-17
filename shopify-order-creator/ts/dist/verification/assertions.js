"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VerificationError = void 0;
exports.assertOrderShape = assertOrderShape;
class VerificationError extends Error {
    details;
    constructor(details) {
        super(details.actual);
        this.details = details;
    }
}
exports.VerificationError = VerificationError;
function assertOrderShape(order) {
    if (!order.orderId || !order.orderName) {
        throw new VerificationError({
            check: "order_shape",
            expected: "order id and order name present",
            actual: JSON.stringify(order),
        });
    }
}
