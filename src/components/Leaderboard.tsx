import type { Course, PlayerScore, Round, YearlyScores } from "../types/index.js";
import { toSlug } from "../utils/slug.js";

interface LeaderboardProps {
  scores: YearlyScores;
  courses: Course[];
  bonusRoundsCount?: number;
  showNames?: boolean;
}

function formatScore(value: number): string {
  return String(value);
}

function getRequiredAndBonusRounds(
  player: PlayerScore,
  requiredCourses: Course[],
  allCourses: Course[]
): { requiredRoundsByCourse: Map<string, Round | undefined>; bonusRounds: Round[] } {
  const requiredRoundsByCourse = new Map<string, Round | undefined>();

  for (const course of requiredCourses) {
    const rounds = player.bestRoundsByCourse[course.clubId] ?? [];
    requiredRoundsByCourse.set(course.clubId, rounds[0]);
  }

  const bonusRounds = allCourses
    .flatMap((course) => {
      const rounds = player.bestRoundsByCourse[course.clubId] ?? [];
      return rounds.slice(course.roundsCount);
    })
    .sort((a, b) => a.score - b.score);

  return { requiredRoundsByCourse, bonusRounds };
}

const RANK_COL_W = 44;
const PLAYER_COL_W = 200;
const TOTAL_COL_W = 72;

export function Leaderboard({
  scores,
  courses,
  bonusRoundsCount = 3,
  showNames = true,
}: LeaderboardProps) {
  const { players } = scores;
  const requiredCourses = courses.filter((course) => course.roundsCount > 0);
  const totalScoreCols = requiredCourses.length + bonusRoundsCount;
  const totalColLeft = RANK_COL_W + (showNames ? PLAYER_COL_W : 0);

  return (
    <div>
      <div className="md:hidden space-y-3">
        {players.map((player, index) => (
          <MobilePlayerCard
            key={player.member.individualId}
            rank={index + 1}
            player={player}
            requiredCourses={requiredCourses}
            allCourses={courses}
            bonusRoundsCount={bonusRoundsCount}
            year={scores.year}
          />
        ))}
        {players.length === 0 && (
          <div className="rounded-xl shadow ring-1 ring-gray-200 bg-white">
            <p className="px-4 py-12 text-center text-gray-400">
              No scores available yet for this season.
            </p>
          </div>
        )}
      </div>

      <div className="hidden md:block overflow-x-auto rounded-xl shadow ring-1 ring-gray-200">
        <table
          className="w-full divide-y divide-gray-200 bg-white"
          style={{ tableLayout: "fixed" }}
        >
          <colgroup>
            <col style={{ width: `${RANK_COL_W}px` }} />
            {showNames && <col style={{ width: `${PLAYER_COL_W}px` }} />}
            <col style={{ width: `${TOTAL_COL_W}px` }} />
          </colgroup>
          <thead>
            <tr className="bg-green-900 text-white">
              <th
                scope="col"
                className="sticky z-20 bg-green-900 px-2 py-3 text-center text-xs font-semibold uppercase tracking-wider"
                style={{ left: 0 }}
              >
                #
              </th>
              {showNames && (
                <th
                  scope="col"
                  className="sticky z-20 bg-green-900 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                  style={{ left: RANK_COL_W }}
                >
                  Player
                </th>
              )}
              <th
                scope="col"
                className="sticky z-20 bg-green-900 px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider border-l border-green-700 border-r-2 border-r-green-700"
                style={{ left: totalColLeft }}
              >
                Total
              </th>
              {requiredCourses.map((course) => (
                <th
                  key={course.clubId}
                  scope="col"
                  className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider border-l border-green-700"
                >
                  <span className="block truncate" title={course.name}>
                    {course.name}
                  </span>
                </th>
              ))}
              {Array.from({ length: bonusRoundsCount }, (_, i) => (
                <th
                  key={`bonus-${i + 1}`}
                  scope="col"
                  className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider border-l border-green-700"
                >
                  Bonus {i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {players.map((player, index) => (
              <PlayerRow
                key={player.member.individualId}
                rank={index + 1}
                player={player}
                requiredCourses={requiredCourses}
                allCourses={courses}
                bonusRoundsCount={bonusRoundsCount}
                year={scores.year}
                showNames={showNames}
                totalColLeft={totalColLeft}
              />
            ))}
            {players.length === 0 && (
              <tr>
                <td
                  colSpan={1 + (showNames ? 1 : 0) + 1 + totalScoreCols}
                  className="px-4 py-12 text-center text-gray-400"
                >
                  No scores available yet for this season.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-4 px-4 sm:px-6 lg:px-0 text-xs text-gray-400 text-right">
        Last updated: {new Date(scores.generatedAt).toLocaleString()}
      </p>
    </div>
  );
}

interface PlayerRowProps {
  rank: number;
  player: PlayerScore;
  requiredCourses: Course[];
  allCourses: Course[];
  bonusRoundsCount: number;
  year: number;
  showNames: boolean;
  totalColLeft: number;
}

function PlayerRow({
  rank,
  player,
  requiredCourses,
  allCourses,
  bonusRoundsCount,
  year,
  showNames,
  totalColLeft,
}: PlayerRowProps) {
  const isLeader = rank === 1;
  const rowBg = isLeader ? "bg-yellow-50" : rank % 2 === 0 ? "bg-gray-50" : "bg-white";

  const { requiredRoundsByCourse, bonusRounds } = getRequiredAndBonusRounds(
    player,
    requiredCourses,
    allCourses
  );

  return (
    <tr
      className={`group transition-colors ${rowBg} ${
        isLeader ? "font-semibold ring-1 ring-inset ring-yellow-300" : ""
      } hover:bg-green-50`}
    >
      <td
        className={`sticky z-10 ${rowBg} group-hover:bg-green-50 px-2 py-3 text-sm text-gray-500 text-center`}
        style={{ left: 0 }}
      >
        {isLeader ? (
          <span title="Leader" aria-label="Leader">
            🏆
          </span>
        ) : (
          rank
        )}
      </td>

      {showNames && (
        <td
          className={`sticky z-10 ${rowBg} group-hover:bg-green-50 px-3 py-3 text-sm font-medium text-gray-900`}
          style={{ left: RANK_COL_W }}
        >
          <a
            href={`${import.meta.env.BASE_URL}${year}/${toSlug(player.member.name)}`}
            className="hover:text-green-700 hover:underline"
          >
            {player.member.name}
          </a>
          {!player.member.paid && (
            <span
              className="ml-1.5 text-red-500 font-bold"
              title="Dues not yet paid"
              aria-label="Dues not yet paid"
            >
              $
            </span>
          )}
        </td>
      )}

      <td
        className={`sticky z-10 ${rowBg} group-hover:bg-green-50 px-3 py-3 text-sm text-center font-semibold text-yellow-700 border-l border-r-2 border-gray-200 tabular-nums`}
        style={{ left: totalColLeft }}
      >
        {player.totalScore > 0 ? formatScore(player.totalScore) : "–"}
      </td>

      {requiredCourses.map((course) => {
        const round = requiredRoundsByCourse.get(course.clubId);
        return (
          <td
            key={course.clubId}
            className={`px-3 py-3 text-sm text-center tabular-nums border-l border-gray-100 ${
              round ? "text-gray-700" : "text-gray-300"
            }`}
            title={round ? `${round.courseName} – ${round.date}` : undefined}
          >
            {round ? round.score : "–"}
          </td>
        );
      })}

      {Array.from({ length: bonusRoundsCount }, (_, i) => {
        const round = bonusRounds[i];
        return (
          <td
            key={`bonus-${i + 1}`}
            className={`px-3 py-3 text-sm text-center tabular-nums border-l border-gray-100 ${
              round ? "text-yellow-700" : "text-gray-300"
            }`}
            title={round ? `${round.courseName} – ${round.date}` : undefined}
          >
            {round ? (
              <>
                <span>{round.score}</span>
                <span className="block text-[10px] leading-tight text-gray-500 truncate" title={round.courseName}>
                  ({round.courseName})
                </span>
              </>
            ) : (
              "–"
            )}
          </td>
        );
      })}
    </tr>
  );
}

interface MobilePlayerCardProps {
  rank: number;
  player: PlayerScore;
  requiredCourses: Course[];
  allCourses: Course[];
  bonusRoundsCount: number;
  year: number;
}

function MobilePlayerCard({
  rank,
  player,
  requiredCourses,
  allCourses,
  bonusRoundsCount,
  year,
}: MobilePlayerCardProps) {
  const isLeader = rank === 1;
  const { requiredRoundsByCourse, bonusRounds } = getRequiredAndBonusRounds(
    player,
    requiredCourses,
    allCourses
  );

  const hasScores =
    Array.from(requiredRoundsByCourse.values()).some(Boolean) || bonusRounds.length > 0;

  return (
    <div
      className={`rounded-xl overflow-hidden shadow ring-1 ${
        isLeader ? "ring-yellow-300" : "ring-gray-200"
      } bg-white`}
    >
      <div
        className={`flex items-center justify-between px-4 py-3 ${
          isLeader ? "bg-yellow-50" : ""
        }`}
      >
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500 w-6 text-center shrink-0 tabular-nums">
            {isLeader ? (
              <span title="Leader" aria-label="Leader">
                🏆
              </span>
            ) : (
              rank
            )}
          </span>
          <div>
            <a
              href={`${import.meta.env.BASE_URL}${year}/${toSlug(player.member.name)}`}
              className="text-sm font-semibold text-gray-900 hover:text-green-700 hover:underline"
            >
              {player.member.name}
            </a>
            {!player.member.paid && (
              <span
                className="ml-1.5 text-red-500 font-bold text-xs"
                title="Dues not yet paid"
                aria-label="Dues not yet paid"
              >
                $
              </span>
            )}
          </div>
        </div>
        <span className="text-sm font-semibold text-yellow-700 tabular-nums">
          {player.totalScore > 0 ? formatScore(player.totalScore) : "–"}
        </span>
      </div>

      {hasScores && (
        <div className="border-t border-gray-100 bg-gray-50 divide-y divide-gray-100">
          {requiredCourses.map((course) => {
            const round = requiredRoundsByCourse.get(course.clubId);
            return (
              <div
                key={course.clubId}
                className="px-4 py-2 flex items-center justify-between gap-4"
              >
                <span
                  className="text-xs text-gray-500 flex-1 min-w-0 truncate"
                  title={course.name}
                >
                  {course.name}
                </span>
                <span
                  className={`text-sm tabular-nums shrink-0 ${
                    round ? "text-gray-700" : "text-gray-300"
                  }`}
                  title={round ? `${round.courseName} – ${round.date}` : undefined}
                >
                  {round ? round.score : "–"}
                </span>
              </div>
            );
          })}

          {Array.from({ length: bonusRoundsCount }, (_, i) => {
            const round = bonusRounds[i];
            return (
              <div
                key={`bonus-${i + 1}`}
                className="px-4 py-2 flex items-center justify-between gap-4"
              >
                <span className="text-xs text-gray-500">Bonus {i + 1}</span>
                <span
                  className={`text-sm tabular-nums shrink-0 ${
                    round ? "text-yellow-700" : "text-gray-300"
                  }`}
                  title={round ? `${round.courseName} – ${round.date}` : undefined}
                >
                  {round ? `${round.score} (${round.courseName})` : "–"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
