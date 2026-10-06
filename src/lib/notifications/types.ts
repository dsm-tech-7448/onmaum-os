export type NotificationLogSummary = {
  id: string;
  channel: string;
  type: string;
  messageContent: string;
  status: string;
  sentAt: string | null;
  createdAt: string;
};
