import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class GameParamsDto {
  @IsUUID()
  id: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9)
  gameNumber: number;
}

/** Contract §19: upsert one game of a series. */
export class UpsertGameDto {
  @IsIn(['live', 'completed'])
  status: 'live' | 'completed';

  @IsOptional()
  @IsUUID()
  winner_team_id?: string;

  @IsOptional()
  @IsISO8601()
  started_at?: string;

  @IsOptional()
  @IsISO8601()
  ended_at?: string;
}
