import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ticket_order_status } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class AdminOrdersDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  match_id?: string;

  @IsOptional()
  @IsEnum(ticket_order_status)
  status?: ticket_order_status;
}
