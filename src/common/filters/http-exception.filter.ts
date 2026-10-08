import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { BusinessRuleException } from '../errors/business-rule.exception';
import {
  PRISMA_FOREIGN_KEY_VIOLATION,
  PRISMA_RECORD_NOT_FOUND,
  PRISMA_UNIQUE_VIOLATION,
  prismaErrorCode,
} from '../errors/prisma-errors';
import { ValidationErrorDetail } from '../pipes/validation.pipe';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details: ValidationErrorDetail[] | null;
  };
}

interface MappedError {
  status: number;
  body: ErrorBody;
}

/** Contract §9 code + safe message per HTTP status. */
const STATUS_ERRORS: Record<number, { code: string; message: string }> = {
  [HttpStatus.BAD_REQUEST]: {
    code: 'VALIDATION_ERROR',
    message: 'Request validation failed',
  },
  [HttpStatus.UNAUTHORIZED]: {
    code: 'AUTHENTICATION_REQUIRED',
    message: 'Authentication required',
  },
  [HttpStatus.FORBIDDEN]: { code: 'FORBIDDEN', message: 'Forbidden' },
  [HttpStatus.NOT_FOUND]: { code: 'NOT_FOUND', message: 'Not found' },
  [HttpStatus.METHOD_NOT_ALLOWED]: {
    code: 'METHOD_NOT_ALLOWED',
    message: 'Method not allowed',
  },
  [HttpStatus.CONFLICT]: { code: 'CONFLICT', message: 'Conflict' },
  [HttpStatus.PAYLOAD_TOO_LARGE]: {
    code: 'PAYLOAD_TOO_LARGE',
    message: 'Payload too large',
  },
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: {
    code: 'UNSUPPORTED_MEDIA_TYPE',
    message: 'Unsupported media type',
  },
  [HttpStatus.UNPROCESSABLE_ENTITY]: {
    code: 'UNPROCESSABLE',
    message: 'Unprocessable entity',
  },
  [HttpStatus.TOO_MANY_REQUESTS]: {
    code: 'RATE_LIMITED',
    message: 'Rate limit exceeded',
  },
  [HttpStatus.SERVICE_UNAVAILABLE]: {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Service unavailable',
  },
};

function errorFor(
  status: number,
  overrides: Partial<ErrorBody['error']> = {},
): MappedError {
  const known = STATUS_ERRORS[status] ?? {
    code: status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST',
    message: status >= 500 ? 'Internal server error' : 'Bad request',
  };
  return {
    status,
    body: { error: { ...known, details: null, ...overrides } },
  };
}

/** body-parser errors (malformed JSON, oversized body) are not HttpExceptions. */
function bodyParserStatus(exception: unknown): number | null {
  if (typeof exception !== 'object' || exception === null) {
    return null;
  }
  const { type, status } = exception as { type?: unknown; status?: unknown };
  if (
    typeof type === 'string' &&
    type.startsWith('entity.') &&
    typeof status === 'number' &&
    status >= 400 &&
    status < 500
  ) {
    return status;
  }
  return null;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const mapped = this.mapException(exception);
    response.status(mapped.status).json(mapped.body);
  }

  private mapException(exception: unknown): MappedError {
    if (exception instanceof BusinessRuleException) {
      const message =
        (exception.getResponse() as { message?: string }).message ??
        'Unprocessable entity';
      return errorFor(HttpStatus.UNPROCESSABLE_ENTITY, { message });
    }

    if (exception instanceof BadRequestException) {
      const response = exception.getResponse();
      const details =
        typeof response === 'object' &&
        response !== null &&
        'details' in response
          ? (response as { details: ValidationErrorDetail[] }).details
          : null;
      return errorFor(HttpStatus.BAD_REQUEST, { details });
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const unavailable: number = HttpStatus.SERVICE_UNAVAILABLE;
      const conflict: number = HttpStatus.CONFLICT;
      if (status >= 500 && status !== unavailable) {
        return this.internalError(exception);
      }
      // Conflicts thrown with an explicit, user-facing reason keep it
      // (e.g. the concurrent-stream limit); everything else stays generic.
      const reason = (exception.getResponse() as { message?: unknown })
        ?.message;
      if (
        status === conflict &&
        typeof reason === 'string' &&
        reason !== 'Conflict'
      ) {
        return errorFor(status, { message: reason });
      }
      return errorFor(status);
    }

    switch (prismaErrorCode(exception)) {
      case PRISMA_UNIQUE_VIOLATION:
        return errorFor(HttpStatus.CONFLICT);
      case PRISMA_FOREIGN_KEY_VIOLATION:
        return errorFor(HttpStatus.CONFLICT, {
          message: 'Resource is referenced by other records',
        });
      case PRISMA_RECORD_NOT_FOUND:
        return errorFor(HttpStatus.NOT_FOUND);
    }

    const parserStatus = bodyParserStatus(exception);
    if (parserStatus !== null) {
      return errorFor(parserStatus);
    }

    return this.internalError(exception);
  }

  private internalError(exception: unknown): MappedError {
    this.logger.error(
      'Unhandled exception',
      exception instanceof Error ? exception.stack : String(exception),
    );
    return errorFor(HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
