import { IsUUID } from 'class-validator';

export class TeamIdParamsDto {
  @IsUUID()
  id: string;
}
