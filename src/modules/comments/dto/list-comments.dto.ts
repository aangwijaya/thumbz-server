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

export class ListCommentsDto {
  @ApiPropertyOptional({
    description:
      'Only newer comments: meta.next_cursor from a previous response (an ISO timestamp is still accepted)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  after?: string;

  @ApiPropertyOptional({
    description:
      'Only older comments: meta.prev_cursor from a previous response',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  before?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 30;
}
