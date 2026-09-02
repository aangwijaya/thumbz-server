import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsISO8601,
  IsInt,
  IsOptional,
  IsUUID,
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
}

export class UpsertLiveStatsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PlayerSnapshotDto)
  snapshots: PlayerSnapshotDto[];
}
