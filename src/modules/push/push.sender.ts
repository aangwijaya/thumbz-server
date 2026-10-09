import { sendNotification } from 'web-push';

export const PUSH_SENDER = Symbol('PUSH_SENDER');

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushSendOptions {
  vapidDetails: { subject: string; publicKey: string; privateKey: string };
  /** Seconds the push service may hold the message for an offline device. */
  TTL: number;
  urgency: 'very-low' | 'low' | 'normal' | 'high';
  /** Replaces an undelivered message with the same topic. */
  topic?: string;
}

/** Encrypts (RFC 8291) and delivers one message; rejects with `statusCode` on HTTP errors. */
export type PushSender = (
  target: PushTarget,
  payload: string,
  options: PushSendOptions,
) => Promise<unknown>;

export const webPushSender: PushSender = (target, payload, options) =>
  sendNotification(target, payload, options);
