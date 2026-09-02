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

export class GoldSnapshotDto {
  @IsUUID()
  team_id: string;

  @IsInt()
  @Min(0)
  gold: number;

  @IsOptional()
  @IsISO8601()
  recorded_at?: string;
}

export class UpsertEconomyDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => GoldSnapshotDto)
  snapshots: GoldSnapshotDto[];
}
