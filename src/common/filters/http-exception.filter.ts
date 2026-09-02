import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  ForbiddenException,
  HttpStatus,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Response } from 'express';
import { ThrottlerException } from '@nestjs/throttler';
import { BusinessRuleException } from '../errors/business-rule.exception';
import { ValidationErrorDetail } from '../pipes/validation.pipe';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details: ValidationErrorDetail[] | null;
  };
}

function isUniqueConstraintViolation(exception: unknown): boolean {
  return (
    typeof exception === 'object' &&
    exception !== null &&
    (exception as { code?: unknown }).code === 'P2002'
  );
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = this.mapException(exception);
    response.status(body.status).json(body.body);
  }

  private mapException(exception: unknown): {
    status: number;
    body: ErrorBody;
  } {
    if (exception instanceof BusinessRuleException) {
      const message =
        (exception.getResponse() as { message?: string }).message ??
        'Unprocessable entity';
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        body: { error: { code: 'UNPROCESSABLE', message, details: null } },
      };
    }

    if (exception instanceof BadRequestException) {
      const response = exception.getResponse();
      const details =
        typeof response === 'object' &&
        response !== null &&
        'details' in response
          ? (response as { details: ValidationErrorDetail[] }).details
          : null;
      return {
        status: HttpStatus.BAD_REQUEST,
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details,
          },
        },
      };
    }

    if (exception instanceof UnauthorizedException) {
      return {
        status: HttpStatus.UNAUTHORIZED,
        body: {
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Authentication required',
            details: null,
          },
        },
      };
    }

    if (exception instanceof ForbiddenException) {
      return {
        status: HttpStatus.FORBIDDEN,
        body: {
          error: { code: 'FORBIDDEN', message: 'Forbidden', details: null },
        },
      };
    }

    if (exception instanceof NotFoundException) {
      return {
        status: HttpStatus.NOT_FOUND,
        body: {
          error: { code: 'NOT_FOUND', message: 'Not found', details: null },
        },
      };
    }

    if (isUniqueConstraintViolation(exception)) {
      return {
        status: HttpStatus.CONFLICT,
        body: {
          error: { code: 'CONFLICT', message: 'Conflict', details: null },
        },
      };
    }

    if (exception instanceof ThrottlerException) {
      return {
        status: HttpStatus.TOO_MANY_REQUESTS,
        body: {
          error: {
            code: 'RATE_LIMITED',
            message: 'Rate limit exceeded',
            details: null,
          },
        },
      };
    }

    this.logger.error(
      'Unhandled exception',
      exception instanceof Error ? exception.stack : String(exception),
    );
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
          details: null,
        },
      },
    };
  }
}
