import { ApiPropertyOptional } from '@nestjs/swagger';
import { payment_method } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateOrderDto {
  @IsInt()
  @Min(1)
  @Max(4)
  quantity: number;

  /** Defaults to crypto (the original, still-supported flow). */
  @ApiPropertyOptional({ enum: payment_method, default: 'crypto' })
  @IsOptional()
  @IsEnum(payment_method)
  payment_method?: payment_method;
}

export class StartPaymentDto {
  @IsEnum(payment_method)
  method: payment_method;
}

export class CheckInDto {
  /** The QR payload printed on the ticket (THMZ1.<code>.<mac>). */
  @IsString()
  @MaxLength(200)
  payload: string;
}
