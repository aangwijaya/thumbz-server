import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';
import { tournament_status } from '@prisma/client';

export class UpdateTournamentDto {
  @IsOptional()
  @Matches(/^[a-z0-9-]+$/)
  @MaxLength(100)
  slug?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsEnum(tournament_status)
  status?: tournament_status;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  region?: string;

  @IsOptional()
  @IsISO8601()
  start_date?: string;

  @IsOptional()
  @IsISO8601()
  end_date?: string;

  @IsOptional()
  @IsString()
  prize_pool?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  logo_url?: string | null;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;
}
