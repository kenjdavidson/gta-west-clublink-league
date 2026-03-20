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

// Warn early if any member's golfCanadaId does not look like a numeric ID.
// The Golf Canada snapshot endpoint requires the numeric user.id from the
// login response (e.g. "12345678"), not a prefixed string like "GC1000001".
for (const member of config.members) {
  if (!/^\d+$/.test(member.golfCanadaId)) {
    console.warn(
      `Warning: member "${member.name}" has golfCanadaId "${member.golfCanadaId}" which is not a numeric value. ` +
        `Update league.json to use the numeric Golf Canada user ID (the "id" field returned by the login API).`
    );
  }
}

// ---------------------------------------------------------------------------
// Golf Canada API types
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

interface GolfCanadaScore {
  course: string;
  datePlayed: string;
  holesPlayed: number;
  score: number;
  isUsedInCalc: boolean;
}

interface GolfCanadaSnapshot {
  club: string;
  scores: GolfCanadaScore[];
  ytdYear: number;
}

// ---------------------------------------------------------------------------
// Golf Canada API helpers
// ---------------------------------------------------------------------------

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
 * Fetch the Golf Canada snapshot for a member.
 *
 * NOTE: `member.golfCanadaId` must be the member's numeric Golf Canada user
 * ID (the `user.id` field returned by the login API, e.g. "12345678").
 * Non-numeric values such as "GC1000001" are invalid and will cause the
 * Golf Canada API to return an HTML error page instead of JSON.
 */
async function fetchSnapshot(
  memberId: string,
  accessToken: string
): Promise<GolfCanadaSnapshot> {
  const response = await fetch(
    `${GOLFCANADA_BASE_URL}/members/${memberId}/getSnapshot`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch snapshot for member ${memberId}: ${response.status} ${response.statusText}`
    );
  }

  // Guard against HTML responses (e.g. redirect to login page for invalid
  // member IDs).  fetch() follows redirects by default, so a 302 → 200 HTML
  // page bypasses the response.ok check above.
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      `Golf Canada returned non-JSON response (${contentType}) for member ID "${memberId}". ` +
        `Ensure golfCanadaId in league.json is the numeric Golf Canada user ID ` +
        `(the "user.id" value returned by the login API, not a prefixed string like "GC1000001").`
    );
  }

  const data = (await response.json()) as Record<string, unknown>;
  if (!data.club || !Array.isArray(data.scores)) {
    throw new Error(
      `Snapshot response for member ${memberId} is missing required fields (club, scores)`
    );
  }
  return data as unknown as GolfCanadaSnapshot;
}

/**
 * Fetch all rounds for a given member in the specified year using the
 * Golf Canada member snapshot endpoint.
 */
async function fetchRoundsForMember(
  loginData: GolfCanadaLoginResponse,
  member: Member,
  year: number
): Promise<GolfCanadaScore[]> {
  const snapshot = await fetchSnapshot(member.golfCanadaId, loginData.access_token);

  // Filter to the requested year using the datePlayed field.
  return snapshot.scores.filter(
    (r) => new Date(r.datePlayed).getFullYear() === year
  );
}

// ---------------------------------------------------------------------------
// Score calculation
// ---------------------------------------------------------------------------

/**
 * From an array of rounds played at a specific course, return the best
 * (lowest score) `count` rounds.
 */
function pickBestRounds(rounds: Round[], count: number): Round[] {
  return [...rounds]
    .sort((a, b) => a.differential - b.differential)
    .slice(0, count);
}

/**
 * Build a PlayerScore record for one member across all configured courses.
 *
 * The Golf Canada snapshot API returns course names (not facility IDs), so
 * rounds are matched to configured courses using exact case-insensitive name
 * comparison.  The course names in league.json must match the names returned
 * by the Golf Canada API exactly (case aside).
 *
 * The snapshot API does not include tee information, so tee filtering is
 * not applied here.  The adjusted gross score is used as the ranking value.
 */
function buildPlayerScore(
  member: Member,
  allScores: GolfCanadaScore[],
  courses: Course[]
): PlayerScore {
  // Build a lookup map: lower-case Golf Canada course name → configured course.
  const courseByName = new Map<string, Course>(
    courses.map((c) => [c.name.toLowerCase(), c])
  );

  const rounds: Round[] = allScores.map((r) => {
    const matched = courseByName.get(r.course.toLowerCase());
    return {
      date: r.datePlayed,
      courseId: matched?.clubId ?? "",
      courseName: r.course,
      score: r.score,
      differential: r.score,
    };
  });

  const bestRoundsByCourse: Record<string, Round[]> = {};
  let totalScore = 0;

  for (const course of courses) {
    const courseRounds = rounds.filter((r) => r.courseId === course.clubId);
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
    const apiScores = await fetchRoundsForMember(loginData, member, YEAR);
    const playerScore = buildPlayerScore(member, apiScores, config.courses);
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
