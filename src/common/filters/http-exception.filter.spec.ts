import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
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
