export const NOTIFICATION_TYPE = {
  ORDER_READY: 'ORDER_READY',
  AUTOMATIC_ORDER_PURCHASED: 'AUTOMATIC_ORDER_PURCHASED',
  NEW_MESSAGE_IN_CHAT: 'NEW_MESSAGE_IN_CHAT',
  ORDER_SUGGESTION: 'ORDER_SUGGESTION_CREATED',
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPE)[keyof typeof NOTIFICATION_TYPE];

export type NotificationPayload = {
  [NOTIFICATION_TYPE.ORDER_READY]: {
    orderId: string;
    chatId: string;
    title: string;
    body: string;
  };
  [NOTIFICATION_TYPE.AUTOMATIC_ORDER_PURCHASED]: {
    orderId: string;
    chatId: string;
    title: string;
    body: string;
  };
  [NOTIFICATION_TYPE.NEW_MESSAGE_IN_CHAT]: {
    chatId: string;
    title: string;
    body: string;
  };
  [NOTIFICATION_TYPE.ORDER_SUGGESTION]: {
    orderId: string;
    orderSuggestionId: string;
    title: string;
    body: string;
  };
};

export type NotificationPayloadType = NotificationPayload[keyof NotificationPayload];
