import { Transform } from 'class-transformer';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export const SEARCH_TYPES = [
  'all',
  'match',
  'team',
  'player',
  'tournament',
  'video',
] as const;

export type SearchType = (typeof SEARCH_TYPES)[number];

export class SearchDto extends PaginationQueryDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsNotEmpty()
  @MaxLength(100)
  q: string;

  @IsOptional()
  @IsIn(SEARCH_TYPES)
  type?: SearchType;
}

export class SuggestDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsNotEmpty()
  @MaxLength(100)
  q: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;
}
