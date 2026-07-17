export interface NewStoreOrderResult {
  uuid: string;
  externalId: string;
}

export class NewStoreClient {
  async createOrder(_payload: unknown): Promise<NewStoreOrderResult> {
    return {
      uuid: `ns-${Date.now()}`,
      externalId: `JD${Date.now()}`,
    };
  }
}
