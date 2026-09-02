import { IsUUID } from 'class-validator';

export class PlayerIdParamsDto {
  @IsUUID()
  id: string;
}
