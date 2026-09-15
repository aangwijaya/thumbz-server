import {
  IsBoolean,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class TicketConfigDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  venue_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  venue_city?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  price_usd: number;

  @IsInt()
  @Min(1)
  quota_total: number;

  @IsOptional()
  @IsISO8601()
  sales_open_at?: string;

  @IsOptional()
  @IsISO8601()
  sales_close_at?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
