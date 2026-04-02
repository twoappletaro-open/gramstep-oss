import type { Result } from "@gramstep/shared";
import { ok } from "@gramstep/shared";
import type {
  IInstagramClient,
  SendMessageRequest,
  SendMessageResponse,
  SenderAction,
  UserProfile,
  WebhookSubscription,
  PersistentMenuItem,
  IceBreakerItem,
  IgApiError,
} from "./types.js";

export type MockCall = {
  method: string;
  args: unknown[];
  timestamp: number;
};

export class MockInstagramClient implements IInstagramClient {
  readonly calls: MockCall[] = [];

  private record(method: string, args: unknown[]): void {
    this.calls.push({ method, args, timestamp: Date.now() });
  }

  reset(): void {
    this.calls.length = 0;
  }

  getCallsFor(method: string): MockCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  async sendMessage(
    igUserId: string,
    request: SendMessageRequest,
    _appSecretProof: string,
  ): Promise<Result<SendMessageResponse, IgApiError>> {
    this.record("sendMessage", [igUserId, request]);
    return ok({
      recipientId: request.recipientId,
      messageId: `mock_mid_${Date.now()}`,
    });
  }

  async sendAction(
    igUserId: string,
    action: SenderAction,
    recipientId: string,
    _appSecretProof: string,
  ): Promise<Result<void, IgApiError>> {
    this.record("sendAction", [igUserId, action, recipientId]);
    return ok(undefined);
  }

  async getUserProfile(
    igScopedId: string,
    _accessToken: string,
    _appSecretProof: string,
  ): Promise<Result<UserProfile, IgApiError>> {
    this.record("getUserProfile", [igScopedId]);
    return ok({
      id: igScopedId,
      username: "mock_user",
      name: "Mock User",
      isUserFollowingBusiness: true,
      isBusinessFollowingUser: false,
    });
  }

  async subscribeWebhook(
    igUserId: string,
    _accessToken: string,
    _appSecretProof: string,
  ): Promise<Result<WebhookSubscription, IgApiError>> {
    this.record("subscribeWebhook", [igUserId]);
    return ok({ success: true });
  }

  async unsubscribeWebhook(
    igUserId: string,
    _accessToken: string,
    _appSecretProof: string,
  ): Promise<Result<WebhookSubscription, IgApiError>> {
    this.record("unsubscribeWebhook", [igUserId]);
    return ok({ success: true });
  }

  async setPersistentMenu(
    igUserId: string,
    items: PersistentMenuItem[],
    _appSecretProof: string,
  ): Promise<Result<void, IgApiError>> {
    this.record("setPersistentMenu", [igUserId, items]);
    return ok(undefined);
  }

  async setIceBreakers(
    igUserId: string,
    items: IceBreakerItem[],
    _appSecretProof: string,
  ): Promise<Result<void, IgApiError>> {
    this.record("setIceBreakers", [igUserId, items]);
    return ok(undefined);
  }

  async sendPrivateReply(
    commentId: string,
    message: string,
    _accessToken: string,
    _appSecretProof: string,
  ): Promise<Result<SendMessageResponse, IgApiError>> {
    this.record("sendPrivateReply", [commentId, message]);
    return ok({
      recipientId: "mock_recipient",
      messageId: `mock_mid_${Date.now()}`,
    });
  }
}
