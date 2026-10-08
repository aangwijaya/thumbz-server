import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { video_type } from '@prisma/client';
import { CursorPageQueryDto } from '../../../common/dto/pagination.dto';

export class ListVideosDto extends CursorPageQueryDto {
  @IsOptional()
  @IsEnum(video_type)
  type?: video_type;

  @IsOptional()
  @IsUUID()
  match_id?: string;
}
