import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsISO8601,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { match_status } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const SORT_KEYS = ['scheduled_at', 'viewer_count'] as const;
const ORDERS = ['asc', 'desc'] as const;

export class ListMatchesDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(match_status)
  status?: match_status;

  @IsOptional()
  @IsUUID()
  tournament_id?: string;

  @IsOptional()
  @IsUUID()
  team_id?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  featured?: boolean;

  @IsOptional()
  @IsIn(SORT_KEYS)
  sort?: (typeof SORT_KEYS)[number];

  @IsOptional()
  @IsIn(ORDERS)
  order?: (typeof ORDERS)[number];
}
