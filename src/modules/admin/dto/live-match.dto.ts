import { IsIn, IsInt, IsOptional, IsUrl, IsUUID, Min } from 'class-validator';

const LIVE_STATUSES = ['live', 'completed', 'cancelled', 'postponed'] as const;

export class LiveMatchDto {
  @IsOptional()
  @IsIn(LIVE_STATUSES)
  status?: (typeof LIVE_STATUSES)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  score_a?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  score_b?: number | null;

  @IsOptional()
  @IsUUID()
  winner_team_id?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  viewer_count?: number;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  stream_url?: string | null;
}
