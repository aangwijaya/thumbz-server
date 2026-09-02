import { IsUUID } from 'class-validator';

export class MatchIdParamsDto {
  @IsUUID()
  id: string;
}
