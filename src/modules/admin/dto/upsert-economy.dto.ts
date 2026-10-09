import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsISO8601,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class GoldSnapshotDto {
  @IsUUID()
  team_id: string;

  @IsInt()
  @Min(0)
  gold: number;

  @IsOptional()
  @IsISO8601()
  recorded_at?: string;

  /** Game of the series (contract §19); default: the match's current game. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9)
  game_number?: number;
}

export class UpsertEconomyDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => GoldSnapshotDto)
  snapshots: GoldSnapshotDto[];
}
