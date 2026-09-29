import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Min,
} from 'class-validator';
import { video_type } from '@prisma/client';

export class CreateVideoDto {
  @IsOptional()
  @IsUUID()
  match_id?: string | null;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsEnum(video_type)
  type: video_type;

  @IsUrl({ protocols: ['https'], require_protocol: true })
  url: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  thumbnail_url?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  duration_seconds?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  game_number?: number | null;

  @IsOptional()
  @IsUUID()
  winning_team_id?: string | null;
}
