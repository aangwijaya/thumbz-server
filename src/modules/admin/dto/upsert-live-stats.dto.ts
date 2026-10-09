import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class PlayerSnapshotDto {
  @IsUUID()
  player_id: string;

  @IsUUID()
  team_id: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  kills?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  deaths?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  assists?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  gold?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  damage?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  damage_taken?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  level?: number | null;

  @IsOptional()
  @IsISO8601()
  recorded_at?: string;

  /** Game of the series (contract §19); default: the match's current game. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9)
  game_number?: number;

  /** Hero picked for this game (§19). */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  hero?: string | null;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  hero_icon_url?: string | null;
}

export class UpsertLiveStatsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PlayerSnapshotDto)
  snapshots: PlayerSnapshotDto[];
}
