import { BadRequestException } from '@nestjs/common';
import { ValidationError } from 'class-validator';
import {
  buildValidationDetails,
  createValidationPipe,
} from './validation.pipe';

const constraintError = (
  property: string,
  message: string,
): ValidationError => ({ property, constraints: { message } });

describe('buildValidationDetails', () => {
  it('maps top-level constraints to field/message pairs', () => {
    const details = buildValidationDetails([
      {
        property: 'score_a',
        constraints: { isInt: 'score_a must be an integer' },
      },
      {
        property: 'best_of',
        constraints: {
          isInt: 'best_of must be an integer',
          min: 'best_of must not be less than 1',
        },
      },
    ]);

    expect(details).toEqual([
      { field: 'score_a', message: 'score_a must be an integer' },
      { field: 'best_of', message: 'best_of must be an integer' },
      { field: 'best_of', message: 'best_of must not be less than 1' },
    ]);
  });

  it('flattens nested child errors', () => {
    const details = buildValidationDetails([
      {
        property: 'team',
        children: [
          {
            property: 'slug',
            constraints: { matches: 'slug must match the pattern' },
          },
        ],
      },
    ]);

    expect(details).toEqual([
      { field: 'slug', message: 'slug must match the pattern' },
    ]);
  });
});

describe('createValidationPipe', () => {
  it('produces a BadRequestException with details on failure', () => {
    const pipe = createValidationPipe();
    const exception = pipe['exceptionFactory']([
      constraintError('page', 'page must not be less than 1'),
    ]) as BadRequestException;

    expect(exception.getResponse()).toEqual({
      details: [{ field: 'page', message: 'page must not be less than 1' }],
    });
  });
});
