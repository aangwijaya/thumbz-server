import type { payment_method } from '@prisma/client';

export type PaymentFamily = 'crypto' | 'idr';

export interface MethodInfo {
  method: payment_method;
  family: PaymentFamily;
  currency: 'USD' | 'IDR';
  label: string;
  /** Bank shown for virtual accounts. */
  bank?: string;
  /** Xendit Payments API v3 channel code. */
  xenditChannel?: string;
  /** Provider minimum (IDR VAs start at Rp10.000). */
  minAmount: number;
}

export const METHODS: Record<payment_method, MethodInfo> = {
  crypto: {
    method: 'crypto',
    family: 'crypto',
    currency: 'USD',
    label: 'Crypto (USDT, BTC, ETH…)',
    minAmount: 1,
  },
  qris: {
    method: 'qris',
    family: 'idr',
    currency: 'IDR',
    label: 'QRIS',
    xenditChannel: 'QRIS',
    minAmount: 1,
  },
  va_bca: {
    method: 'va_bca',
    family: 'idr',
    currency: 'IDR',
    label: 'BCA Virtual Account',
    bank: 'BCA',
    xenditChannel: 'BCA_VIRTUAL_ACCOUNT',
    minAmount: 10_000,
  },
  va_bni: {
    method: 'va_bni',
    family: 'idr',
    currency: 'IDR',
    label: 'BNI Virtual Account',
    bank: 'BNI',
    xenditChannel: 'BNI_VIRTUAL_ACCOUNT',
    minAmount: 10_000,
  },
  va_bri: {
    method: 'va_bri',
    family: 'idr',
    currency: 'IDR',
    label: 'BRI Virtual Account',
    bank: 'BRI',
    xenditChannel: 'BRI_VIRTUAL_ACCOUNT',
    minAmount: 10_000,
  },
  va_mandiri: {
    method: 'va_mandiri',
    family: 'idr',
    currency: 'IDR',
    label: 'Mandiri Virtual Account',
    bank: 'Mandiri',
    xenditChannel: 'MANDIRI_VIRTUAL_ACCOUNT',
    minAmount: 10_000,
  },
  va_permata: {
    method: 'va_permata',
    family: 'idr',
    currency: 'IDR',
    label: 'Permata Virtual Account',
    bank: 'Permata',
    xenditChannel: 'PERMATA_VIRTUAL_ACCOUNT',
    minAmount: 10_000,
  },
};

export const METHOD_ORDER: payment_method[] = [
  'qris',
  'va_bca',
  'va_bni',
  'va_bri',
  'va_mandiri',
  'va_permata',
  'crypto',
];
