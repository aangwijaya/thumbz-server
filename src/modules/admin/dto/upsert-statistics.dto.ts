import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

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
  @IsBoolean()
  mvp?: boolean;

  @IsOptional()
  @IsObject()
  details?: Record<string, unknown>;
}

export class UpsertStatisticsDto {
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
