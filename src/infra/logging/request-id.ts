import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Reuses a well-formed inbound `x-request-id` (so a trace can span the
 * client, proxies and this API) or mints a new one, and echoes it back.
 */
export function assignRequestId(
  req: IncomingMessage,
  res: ServerResponse,
): string {
  const inbound = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof inbound === 'string' && SAFE_REQUEST_ID.test(inbound)
      ? inbound
      : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}
