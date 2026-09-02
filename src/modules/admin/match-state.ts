import { match_status } from '@prisma/client';

const ALLOWED_TRANSITIONS: Record<match_status, match_status[]> = {
  scheduled: ['live', 'cancelled', 'postponed'],
  live: ['completed', 'cancelled', 'postponed'],
  completed: [],
  cancelled: [],
  postponed: [],
};

export function validateTransition(
  from: match_status,
  to: match_status,
): string | null {
  if (from === to) {
    return null;
  }
  const allowed = ALLOWED_TRANSITIONS[from];
  if (allowed.includes(to)) {
    return null;
  }
  return `Invalid status transition: ${from} -> ${to}`;
}

export function validateCompletedMatch(
  scoreA: number | null,
  scoreB: number | null,
  winnerTeamId: string | null,
  teamAId: string,
  teamBId: string,
): string | null {
  if (scoreA === null || scoreB === null) {
    return 'Completed matches must have score_a and score_b';
  }
  if (winnerTeamId === null) {
    return 'Completed matches must have a winner_team_id';
  }
  if (winnerTeamId !== teamAId && winnerTeamId !== teamBId) {
    return 'winner_team_id must be one of the match teams';
  }
  if (scoreA === scoreB) {
    return 'Scores cannot be equal for a completed match';
  }
  const expectedWinner = scoreA > scoreB ? teamAId : teamBId;
  if (winnerTeamId !== expectedWinner) {
    return 'winner_team_id must be the team with the higher score';
  }
  return null;
}
