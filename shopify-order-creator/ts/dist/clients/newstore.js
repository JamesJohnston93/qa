"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NewStoreClient = void 0;
class NewStoreClient {
    async createOrder(_payload) {
        return {
            uuid: `ns-${Date.now()}`,
            externalId: `JD${Date.now()}`,
        };
    }
}
exports.NewStoreClient = NewStoreClient;
