import { IsEnum, IsISO8601, IsOptional } from 'class-validator';
import { match_stage, match_status } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class TournamentScheduleDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(match_stage)
  stage?: match_stage;

  @IsOptional()
  @IsEnum(match_status)
  status?: match_status;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}
