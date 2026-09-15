import { IsEnum, IsOptional } from 'class-validator';
import { ticket_order_status } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class ListMyOrdersDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ticket_order_status)
  status?: ticket_order_status;
}
