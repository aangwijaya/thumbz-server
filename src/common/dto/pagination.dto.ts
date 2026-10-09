import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Deep offsets get slower linearly; past this, page with `cursor`. */
export const MAX_PAGE = 500;

export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize: number = 20;
}

/** Adds keyset paging: pass `meta.next_cursor` back as `cursor` (ignores `page`). */
export class CursorPageQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Opaque cursor from a previous response (meta.next_cursor)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}
