import { IsOptional, IsUUID } from 'class-validator';

export class HomeQueryDto {
  @IsOptional()
  @IsUUID()
  tournament_id?: string;
}
