import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ValidationError } from 'class-validator';

export interface ValidationErrorDetail {
  field: string;
  message: string;
}

export function buildValidationDetails(
  errors: ValidationError[],
): ValidationErrorDetail[] {
  return errors.flatMap((error) => {
    if (error.constraints) {
      return Object.values(error.constraints).map((message) => ({
        field: error.property,
        message,
      }));
    }
    if (error.children && error.children.length > 0) {
      return buildValidationDetails(error.children);
    }
    return [];
  });
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: false,
    exceptionFactory: (errors: ValidationError[]) =>
      new BadRequestException({ details: buildValidationDetails(errors) }),
  });
}
