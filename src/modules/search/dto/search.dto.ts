import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
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
