import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsISO8601,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** Allowed event types (contract §19). */
export const EVENT_TYPES = [
  'first_blood',
  'kill',
  'tower',
  'turtle',
  'lord',
  'other',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Objectives always belong to a team. */
const TEAM_REQUIRED: readonly string[] = [
  'first_blood',
  'tower',
  'turtle',
  'lord',
];

export class MatchEventDto {
  @ValidateIf(
    (event: MatchEventDto) =>
      (event.team_id !== undefined && event.team_id !== null) ||
      TEAM_REQUIRED.includes(event.event_type),
  )
  @IsUUID()
  team_id?: string | null;

  @IsOptional()
  @IsUUID()
  player_id?: string | null;

  @IsIn(EVENT_TYPES)
  event_type: EventType;

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

  /** Game of the series (contract §19); default: the match's current game. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9)
  game_number?: number;
}

export class UpsertEventsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => MatchEventDto)
  events: MatchEventDto[];
}
