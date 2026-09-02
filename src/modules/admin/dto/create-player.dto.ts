import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { player_role } from '@prisma/client';

export class CreatePlayerDto {
  @Matches(/^[a-z0-9-]+$/)
  @MaxLength(100)
  slug: string;

  @IsString()
  @IsNotEmpty()
  nickname: string;

  @IsOptional()
  @IsString()
  real_name?: string | null;

  @IsEnum(player_role)
  role: player_role;

  @IsOptional()
  @IsString()
  country?: string | null;

  @IsOptional()
  @IsUUID()
  team_id?: string | null;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  photo_url?: string | null;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
