import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { match_item_phase } from '@prisma/client';

export class ItemPurchaseDto {
  @IsUUID()
  player_id: string;

  @IsUUID()
  team_id: string;

  @IsString()
  @IsNotEmpty()
  item_id: string;

  @IsString()
  @IsNotEmpty()
  item_name: string;

  @IsEnum(match_item_phase)
  phase: match_item_phase;

  @IsOptional()
  @IsInt()
  @Min(0)
  slot?: number | null;

  @IsOptional()
  @IsISO8601()
  purchased_at?: string;

  /** Game of the series (contract §19); default: the match's current game. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9)
  game_number?: number;
}

export class UpsertEquipmentDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ItemPurchaseDto)
  purchases: ItemPurchaseDto[];
}
