import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsUrl,
  Min,
  ValidateNested,
} from 'class-validator';
import { broadcast_language } from '@prisma/client';

export class BroadcastDto {
  @IsEnum(broadcast_language)
  language: broadcast_language;

  @IsUrl({ protocols: ['https'], require_protocol: true })
  stream_url: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  viewer_count?: number;
}

export class UpsertBroadcastsDto {
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => BroadcastDto)
  broadcasts: BroadcastDto[];
}
