import type { Result } from "@gramstep/shared";

export type IgApiError = {
  code: number;
  message: string;
  type: string;
  fbtrace_id?: string;
};

export type SendMessageRequest = {
  recipientId: string;
  message: MessagePayload;
  tag?: "HUMAN_AGENT";
};

export type MessagePayload =
  | TextMessage
  | ImageMessage
  | GenericTemplateMessage
  | QuickReplyMessage;

export type TextMessage = {
  type: "text";
  text: string;
};

export type ImageMessage = {
  type: "image";
  url: string;
  attachmentId?: string;
};

export type GenericTemplateMessage = {
  type: "generic";
  elements: GenericElement[];
};

export type GenericElement = {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  buttons?: Button[];
};

export type Button =
  | { type: "web_url"; title: string; url: string }
  | { type: "postback"; title: string; payload: string };

export type QuickReplyMessage = {
  type: "quick_reply";
  text: string;
  quickReplies: QuickReply[];
};

export type QuickReply = {
  contentType: "text";
  title: string;
  payload: string;
};

export type SendMessageResponse = {
  recipientId: string;
  messageId: string;
};

export type SenderAction = "typing_on" | "typing_off" | "mark_seen";

export type UserProfile = {
  id: string;
  username?: string;
  name?: string;
  profile_pic?: string;
  follower_count?: number;
  is_user_follow_business?: boolean;
  is_business_follow_user?: boolean;
  // camelCase aliases for backward compatibility
  followerCount?: number;
  isUserFollowingBusiness?: boolean;
  isBusinessFollowingUser?: boolean;
};

export type WebhookSubscription = {
  success: boolean;
};

export type PersistentMenuItem = {
  type: "web_url" | "postback";
  title: string;
  url?: string;
  payload?: string;
};

export type IceBreakerItem = {
  question: string;
  payload: string;
};

export type PagedResponse<T> = {
  data: T[];
  paging?: {
    cursors?: {
      before?: string;
      after?: string;
    };
    next?: string;
  };
};

export interface IInstagramClient {
  sendMessage(
    igUserId: string,
    request: SendMessageRequest,
    appSecretProof: string,
  ): Promise<Result<SendMessageResponse, IgApiError>>;

  sendAction(
    igUserId: string,
    action: SenderAction,
    recipientId: string,
    appSecretProof: string,
  ): Promise<Result<void, IgApiError>>;

  getUserProfile(
    igScopedId: string,
    accessToken: string,
    appSecretProof: string,
  ): Promise<Result<UserProfile, IgApiError>>;

  subscribeWebhook(
    igUserId: string,
    accessToken: string,
    appSecretProof: string,
  ): Promise<Result<WebhookSubscription, IgApiError>>;

  unsubscribeWebhook(
    igUserId: string,
    accessToken: string,
    appSecretProof: string,
  ): Promise<Result<WebhookSubscription, IgApiError>>;

  setPersistentMenu(
    igUserId: string,
    items: PersistentMenuItem[],
    appSecretProof: string,
  ): Promise<Result<void, IgApiError>>;

  setIceBreakers(
    igUserId: string,
    items: IceBreakerItem[],
    appSecretProof: string,
  ): Promise<Result<void, IgApiError>>;

  sendPrivateReply(
    commentId: string,
    message: string,
    accessToken: string,
    appSecretProof: string,
  ): Promise<Result<SendMessageResponse, IgApiError>>;
}
