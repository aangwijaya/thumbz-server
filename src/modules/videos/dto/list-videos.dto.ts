import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { video_type } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class ListVideosDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(video_type)
  type?: video_type;

  @IsOptional()
  @IsUUID()
  match_id?: string;
}
