import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { tournament_status } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const SORT_KEYS = ['start_date', 'name'] as const;
const ORDERS = ['asc', 'desc'] as const;

export class ListTournamentsDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(tournament_status)
  status?: tournament_status;

  @IsOptional()
  @IsString()
  region?: string;

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
