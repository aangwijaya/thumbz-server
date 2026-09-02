import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateTeamDto {
  @IsOptional()
  @Matches(/^[a-z0-9-]+$/)
  @MaxLength(100)
  slug?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  region?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  logo_url?: string | null;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  color_primary?: string | null;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  color_secondary?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  founded_year?: number | null;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
