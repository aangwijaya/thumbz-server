import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class ListMyTicketsDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  match_id?: string;
}
