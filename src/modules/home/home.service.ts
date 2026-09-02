import { Injectable } from '@nestjs/common';
import {
  MatchDetail,
  MatchSummary,
  SUMMARY_INCLUDE,
  DETAIL_INCLUDE,
  toMatchSummary,
  toMatchDetail,
} from '../matches/matches.service';
import {
  SUMMARY_SELECT as TEAM_SUMMARY_SELECT,
  TeamSummary,
  toTeamSummary,
} from '../teams/teams.service';
import {
  SUMMARY_SELECT as TOURNAMENT_SUMMARY_SELECT,
  TournamentSummary,
  toTournamentSummary,
} from '../tournaments/tournaments.service';
import { toVideoSummary, VideoSummary } from '../videos/videos.service';
import { PrismaService } from '../../prisma/prisma.service';

export interface HomeContinueWatchingItem {
  match_id: string;
  watched_at: Date;
  duration_seconds: number | null;
  match: MatchSummary;
}

export interface HomePayload {
  featured_live_match: MatchDetail | null;
  live_now: MatchSummary[];
  upcoming: MatchSummary[];
  featured_tournaments: TournamentSummary[];
  popular_teams: TeamSummary[];
  latest_videos: VideoSummary[];
  continue_watching: HomeContinueWatchingItem[];
}

const NINETY_DAYS_MS = 90 * 24 * 3_600_000;

@Injectable()
export class HomeService {
  constructor(private readonly prisma: PrismaService) {}

  async getHome(sub?: string): Promise<{ data: HomePayload }> {
    const now = new Date();
    const ninetyDaysAgo = new Date(Date.now() - NINETY_DAYS_MS);

    const [
      featuredRow,
      liveRows,
      upcomingRows,
      tournamentRows,
      videoRows,
      completedRows,
    ] = await Promise.all([
      this.prisma.match.findFirst({
        where: { status: 'live', featured: true },
        orderBy: { started_at: 'desc' },
        include: DETAIL_INCLUDE,
      }),
      this.prisma.match.findMany({
        where: { status: 'live' },
        orderBy: [{ viewer_count: 'desc' }, { started_at: 'asc' }],
        take: 8,
        include: SUMMARY_INCLUDE,
      }),
      this.prisma.match.findMany({
        where: { status: 'scheduled', scheduled_at: { gte: now } },
        orderBy: { scheduled_at: 'asc' },
        take: 8,
        include: SUMMARY_INCLUDE,
      }),
      this.prisma.tournament.findMany({
        where: { featured: true },
        orderBy: { start_date: 'desc' },
        take: 6,
        select: TOURNAMENT_SUMMARY_SELECT,
      }),
      this.prisma.video.findMany({
        orderBy: { published_at: 'desc' },
        take: 12,
      }),
      this.prisma.match.findMany({
        where: {
          status: 'completed',
          ended_at: { gte: ninetyDaysAgo },
        },
        select: { team_a_id: true, team_b_id: true },
      }),
    ]);

    // popular teams: most completed matches in the last 90 days
    const playedByTeam = new Map<string, number>();
    for (const row of completedRows) {
      playedByTeam.set(
        row.team_a_id,
        (playedByTeam.get(row.team_a_id) ?? 0) + 1,
      );
      playedByTeam.set(
        row.team_b_id,
        (playedByTeam.get(row.team_b_id) ?? 0) + 1,
      );
    }
    const popularTeamIds = [...playedByTeam.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([teamId]) => teamId);

    const teamRows = await this.prisma.team.findMany({
      where: { id: { in: popularTeamIds } },
      select: TEAM_SUMMARY_SELECT,
    });
    const teamById = new Map(teamRows.map((team) => [team.id, team]));
    const popularTeams = popularTeamIds.flatMap((teamId) => {
      const team = teamById.get(teamId);
      return team === undefined ? [] : [toTeamSummary(team)];
    });

    let continueWatching: HomeContinueWatchingItem[] = [];
    if (sub) {
      const historyRows = await this.prisma.watchHistory.findMany({
        where: { user_id: sub },
        orderBy: { watched_at: 'desc' },
        take: 8,
        include: { match: { include: SUMMARY_INCLUDE } },
      });
      continueWatching = historyRows.map((row) => ({
        match_id: row.match_id,
        watched_at: row.watched_at,
        duration_seconds: row.duration_seconds,
        match: toMatchSummary(row.match),
      }));
    }

    return {
      data: {
        featured_live_match:
          featuredRow === null ? null : toMatchDetail(featuredRow),
        live_now: liveRows.map(toMatchSummary),
        upcoming: upcomingRows.map(toMatchSummary),
        featured_tournaments: tournamentRows.map(toTournamentSummary),
        popular_teams: popularTeams,
        latest_videos: videoRows.map(toVideoSummary),
        continue_watching: continueWatching,
      },
    };
  }
}
