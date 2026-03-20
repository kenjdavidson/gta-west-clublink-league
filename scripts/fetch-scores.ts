#!/usr/bin/env node
/**
 * fetch-scores.ts
 *
 * Fetches scores from the Golf Canada API for all configured league members
 * and saves the results to src/data/<year>.json.
 *
 * Required environment variables:
 *   GOLFCANADA_USERNAME  - Golf Canada account username
 *   GOLFCANADA_PASSWORD  - Golf Canada account password
 *
 * Usage:
 *   npx tsx scripts/fetch-scores.ts [year]
 *   (defaults to the current year from league config if no year is provided)
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type {
  LeagueConfig,
  Member,
  Course,
  Round,
  PlayerScore,
  YearlyScores,
} from "../src/types/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const configPath = path.join(ROOT, "config", "league.json");
const config: LeagueConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const YEAR = Number(process.argv[2] ?? config.league.currentYear);

/** OAuth2 token endpoint for Golf Canada */
const GOLFCANADA_AUTH_URL =
  process.env.GOLFCANADA_AUTH_URL ??
  "https://scg.golfcanada.ca/connect/token";

/** Base URL for the Golf Canada scores/rounds API */
const GOLFCANADA_BASE_URL =
  process.env.GOLFCANADA_BASE_URL ?? "https://scg.golfcanada.ca/api";

const USERNAME = process.env.GOLFCANADA_USERNAME;
const PASSWORD = process.env.GOLFCANADA_PASSWORD;

if (!USERNAME || !PASSWORD) {
  console.error(
    "Error: GOLFCANADA_USERNAME and GOLFCANADA_PASSWORD environment variables must be set."
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Golf Canada API helpers
// ---------------------------------------------------------------------------

interface GolfCanadaUser {
  id: number;
  fullName: string;
  firstName: string;
  lastName: string;
  handicap: string;
  membershipLevel: string;
  expirationDate: string;
}

interface GolfCanadaLoginResponse {
  access_token: string;
  user: GolfCanadaUser;
}

interface GolfCanadaRound {
  played_at: string;
  facility_id: string;
  facility_name: string;
  tee_name?: string;
  adjusted_gross_score: number;
  score_differential: number;
}

/**
 * Authenticate with the Golf Canada OAuth2 token endpoint (password grant).
 * Returns the full login response including the access token and user profile.
 */
async function authenticate(): Promise<GolfCanadaLoginResponse> {
  const body = new URLSearchParams({
    grant_type: "password",
    username: USERNAME!,
    password: PASSWORD!,
    scope: "address email offline_access openid phone profile roles",
  });

  const response = await fetch(GOLFCANADA_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(
      `Authentication failed: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as Record<string, unknown>;
  if (!data.access_token || !data.user) {
    throw new Error(
      "Authentication response is missing required fields (access_token, user)"
    );
  }
  return data as unknown as GolfCanadaLoginResponse;
}

/**
 * Fetch all rounds for a given member in the specified year.
 */
async function fetchRoundsForMember(
  loginData: GolfCanadaLoginResponse,
  member: Member,
  year: number
): Promise<GolfCanadaRound[]> {
  const params = new URLSearchParams({
    member_id: member.golfCanadaId,
    year: String(year),
  });

  const response = await fetch(
    `${GOLFCANADA_BASE_URL}/scores?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${loginData.access_token}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch rounds for ${member.name}: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as { rounds: GolfCanadaRound[] };
  return data.rounds ?? [];
}

// ---------------------------------------------------------------------------
// Score calculation
// ---------------------------------------------------------------------------

/**
 * From an array of rounds played at a specific course, return the best
 * (lowest score differential) `count` rounds.
 */
function pickBestRounds(rounds: Round[], count: number): Round[] {
  return [...rounds]
    .sort((a, b) => a.differential - b.differential)
    .slice(0, count);
}

/**
 * Build a PlayerScore record for one member across all configured courses.
 */
function buildPlayerScore(
  member: Member,
  allRounds: GolfCanadaRound[],
  courses: Course[]
): PlayerScore {
  const rounds: Round[] = allRounds.map((r) => ({
    date: r.played_at,
    courseId: r.facility_id,
    courseName: r.facility_name,
    tee: r.tee_name,
    score: r.adjusted_gross_score,
    differential: r.score_differential,
  }));

  const bestRoundsByCourse: Record<string, Round[]> = {};
  let totalScore = 0;

  for (const course of courses) {
    const courseRounds = rounds.filter(
      (r) =>
        r.courseId === course.clubId &&
        (!course.tee ||
          r.tee?.toLowerCase() === course.tee.toLowerCase())
    );
    const best = pickBestRounds(courseRounds, course.roundsCount);
    bestRoundsByCourse[course.clubId] = best;
    totalScore += best.reduce((sum, r) => sum + r.differential, 0);
  }

  return { member, rounds, bestRoundsByCourse, totalScore };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Fetching scores for ${YEAR}…`);

  const loginData = await authenticate();
  console.log(`Authenticated as ${loginData.user.fullName}.`);

  const playerScores: PlayerScore[] = [];

  for (const member of config.members) {
    console.log(`  Fetching rounds for ${member.name}…`);
    const apiRounds = await fetchRoundsForMember(loginData, member, YEAR);
    const playerScore = buildPlayerScore(member, apiRounds, config.courses);
    playerScores.push(playerScore);
  }

  // Sort by total score ascending (lowest / best first)
  playerScores.sort((a, b) => a.totalScore - b.totalScore);

  const yearlyScores: YearlyScores = {
    year: YEAR,
    generatedAt: new Date().toISOString(),
    players: playerScores,
  };

  const outputDir = path.join(ROOT, "src", "data");
  fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, `${YEAR}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(yearlyScores, null, 2), "utf-8");

  console.log(`Scores saved to ${outputPath}`);
}

main().catch((err: unknown) => {
  console.error("Error fetching scores:", err);
  process.exit(1);
});
