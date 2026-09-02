import { IsUUID } from 'class-validator';

export class AdminIdParamsDto {
  @IsUUID()
  id: string;
}
