import { IsUUID } from 'class-validator';

export class HistoryMatchParamsDto {
  @IsUUID()
  matchId: string;
}
