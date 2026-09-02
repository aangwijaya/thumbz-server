import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class MatchEventDto {
  @IsOptional()
  @IsUUID()
  team_id?: string | null;

  @IsOptional()
  @IsUUID()
  player_id?: string | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  event_type: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsObject()
  details?: Record<string, unknown>;

  @IsOptional()
  @IsISO8601()
  occurred_at?: string;
}

export class UpsertEventsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => MatchEventDto)
  events: MatchEventDto[];
}
