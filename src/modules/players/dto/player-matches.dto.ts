import { IsEnum, IsOptional } from 'class-validator';
import { match_status } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class PlayerMatchesDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(match_status)
  status?: match_status;
}
