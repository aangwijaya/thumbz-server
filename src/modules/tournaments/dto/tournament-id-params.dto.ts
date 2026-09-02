import { IsUUID } from 'class-validator';

export class TournamentIdParamsDto {
  @IsUUID()
  id: string;
}
