import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** An emblem, talent or item reference with its display name and icon (§19). */
export class GameAssetDto {
  @IsString()
  @MaxLength(40)
  id: string;

  @IsString()
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  icon_url?: string | null;
}

export class TeamStatsDto {
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
  towers_destroyed?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  game_duration_seconds?: number | null;

  @IsOptional()
  @IsObject()
  details?: Record<string, unknown>;
}

export class PlayerStatsDto {
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
  @IsString()
  hero_picked?: string | null;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  hero_icon_url?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  tower_damage?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => GameAssetDto)
  emblem?: GameAssetDto | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GameAssetDto)
  talents?: GameAssetDto[];

  /** Final build, slot order. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GameAssetDto)
  items?: GameAssetDto[];

  @IsOptional()
  @IsBoolean()
  mvp?: boolean;

  @IsOptional()
  @IsObject()
  details?: Record<string, unknown>;
}

export class UpsertStatisticsDto {
  /** Game of the series (contract §19); default: the match's current game, else 1. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9)
  game_number?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TeamStatsDto)
  teams?: TeamStatsDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlayerStatsDto)
  players?: PlayerStatsDto[];
}
