import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class UpdateWatchHistoryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  duration_seconds?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  total_seconds?: number;
}
