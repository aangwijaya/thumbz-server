import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { BusinessRuleException } from '../errors/business-rule.exception';
import { HttpExceptionFilter } from './http-exception.filter';

function buildHost(status: jest.Mock, json: jest.Mock): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => ({ status, json }),
    }),
  } as unknown as ArgumentsHost;
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let status: jest.Mock;
  let json: jest.Mock;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    status = jest.fn().mockReturnThis();
    json = jest.fn();
  });

  it.each([
    [
      new BadRequestException(),
      400,
      'VALIDATION_ERROR',
      'Request validation failed',
    ],
    [
      new UnauthorizedException(),
      401,
      'AUTHENTICATION_REQUIRED',
      'Authentication required',
    ],
    [new ForbiddenException(), 403, 'FORBIDDEN', 'Forbidden'],
    [new NotFoundException(), 404, 'NOT_FOUND', 'Not found'],
    [
      new BusinessRuleException('team_a must differ from team_b'),
      422,
      'UNPROCESSABLE',
      'team_a must differ from team_b',
    ],
  ])(
    'maps %p to %i %s',
    (exception, expectedStatus, expectedCode, expectedMessage) => {
      filter.catch(exception, buildHost(status, json));

      expect(status).toHaveBeenCalledWith(expectedStatus);
      expect(json).toHaveBeenCalledWith({
        error: {
          code: expectedCode,
          message: expectedMessage,
          details: null,
        },
      });
    },
  );

  it('passes validation details through for BadRequestException', () => {
    const details = [
      { field: 'score_a', message: 'score_a must not be negative' },
    ];
    filter.catch(new BadRequestException({ details }), buildHost(status, json));

    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details,
      },
    });
  });

  it('maps Prisma P2002 to 409 CONFLICT', () => {
    filter.catch(
      { name: 'PrismaClientKnownRequestError', code: 'P2002' },
      buildHost(status, json),
    );

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      error: { code: 'CONFLICT', message: 'Conflict', details: null },
    });
  });

  it.each([
    [new ConflictException(), 409, 'CONFLICT', 'Conflict'],
    [new ThrottlerException(), 429, 'RATE_LIMITED', 'Rate limit exceeded'],
    [
      new ServiceUnavailableException(),
      503,
      'SERVICE_UNAVAILABLE',
      'Service unavailable',
    ],
    [
      new HttpException('nope', HttpStatus.METHOD_NOT_ALLOWED),
      405,
      'METHOD_NOT_ALLOWED',
      'Method not allowed',
    ],
    [
      new HttpException('teapot', HttpStatus.I_AM_A_TEAPOT),
      418,
      'BAD_REQUEST',
      'Bad request',
    ],
    [
      new InternalServerErrorException('db password leaked'),
      500,
      'INTERNAL_ERROR',
      'Internal server error',
    ],
  ])('maps %p to %i %s', (exception, expectedStatus, code, message) => {
    filter.catch(exception, buildHost(status, json));

    expect(status).toHaveBeenCalledWith(expectedStatus);
    expect(json).toHaveBeenCalledWith({
      error: { code, message, details: null },
    });
  });

  it('maps Prisma P2003 (foreign key restrict) to 409 CONFLICT', () => {
    filter.catch(
      { name: 'PrismaClientKnownRequestError', code: 'P2003' },
      buildHost(status, json),
    );

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'CONFLICT',
        message: 'Resource is referenced by other records',
        details: null,
      },
    });
  });

  it('maps Prisma P2025 (record not found) to 404 NOT_FOUND', () => {
    filter.catch(
      { name: 'PrismaClientKnownRequestError', code: 'P2025' },
      buildHost(status, json),
    );

    expect(status).toHaveBeenCalledWith(404);
  });

  it.each([
    [{ type: 'entity.parse.failed', status: 400 }, 400, 'VALIDATION_ERROR'],
    [{ type: 'entity.too.large', status: 413 }, 413, 'PAYLOAD_TOO_LARGE'],
  ])('maps body-parser error %p to %i', (error, expectedStatus, code) => {
    filter.catch(error, buildHost(status, json));

    expect(status).toHaveBeenCalledWith(expectedStatus);
    const [body] = json.mock.calls[0] as [{ error: { code: string } }];
    expect(body.error.code).toBe(code);
  });

  it('collapses unexpected errors to 500 INTERNAL_ERROR without leaking details', () => {
    filter.catch(
      new Error('postgres connection failed: secret-password@db'),
      buildHost(status, json),
    );

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        details: null,
      },
    });
  });
});
