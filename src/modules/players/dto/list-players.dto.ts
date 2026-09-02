import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { player_role } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const SORT_KEYS = ['nickname'] as const;
const ORDERS = ['asc', 'desc'] as const;

export class ListPlayersDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  team_id?: string;

  @IsOptional()
  @IsEnum(player_role)
  role?: player_role;

  @IsOptional()
  @IsIn(SORT_KEYS)
  sort?: (typeof SORT_KEYS)[number];

  @IsOptional()
  @IsIn(ORDERS)
  order?: (typeof ORDERS)[number];
}
