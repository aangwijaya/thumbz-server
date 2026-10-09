import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { CursorPageQueryDto } from '../../../common/dto/pagination.dto';

const SORT_KEYS = ['name', 'created_at'] as const;
const ORDERS = ['asc', 'desc'] as const;

export class ListTeamsDto extends CursorPageQueryDto {
  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsUUID()
  tournament_id?: string;

  @IsOptional()
  @IsIn(SORT_KEYS)
  sort?: (typeof SORT_KEYS)[number];

  @IsOptional()
  @IsIn(ORDERS)
  order?: (typeof ORDERS)[number];
}
