import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { match_stage, match_status } from '@prisma/client';

export class UpdateMatchDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(600)
  stream_delay_seconds?: number;

  @IsOptional()
  @IsUUID()
  tournament_id?: string | null;

  @IsOptional()
  @IsEnum(match_stage)
  stage?: match_stage | null;

  @IsOptional()
  @IsInt()
  round?: number | null;

  @IsOptional()
  @IsString()
  group_name?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  best_of?: number;

  @IsOptional()
  @IsInt()
  game_number?: number | null;

  @IsOptional()
  @IsUUID()
  team_a_id?: string;

  @IsOptional()
  @IsUUID()
  team_b_id?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  score_a?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  score_b?: number | null;

  @IsOptional()
  @IsUUID()
  winner_team_id?: string | null;

  @IsOptional()
  @IsEnum(match_status)
  status?: match_status;

  @IsOptional()
  @IsISO8601()
  scheduled_at?: string;

  @IsOptional()
  @IsISO8601()
  started_at?: string | null;

  @IsOptional()
  @IsISO8601()
  ended_at?: string | null;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  stream_url?: string | null;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  thumbnail_url?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  viewer_count?: number;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;
}
