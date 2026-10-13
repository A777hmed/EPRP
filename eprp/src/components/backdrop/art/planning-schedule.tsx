import {
  Board,
  Diamond,
  Dimension,
  Dots,
  Ground,
  Person,
  PipeRack,
  SoftSkyline,
  type Tone,
} from "./primitives";

/** Gantt rows: [row y, bar start, bar end, tone]. */
const BARS: [number, number, number, Tone][] = [
  [114, 236, 316, "blue"],
  [142, 316, 388, "sky"],
  [170, 340, 452, "blue"],
  [198, 466, 520, "warm"],
  [226, 404, 536, "sky"],
];

/** Calendar cells that carry a planned item: [column, row, tone]. */
const MARKED: [number, number, Tone][] = [
  [4, 0, "blue"],
  [2, 1, "warm"],
  [3, 2, "blue"],
  [0, 2, "warm"],
  [1, 3, "sand"],
];

const RING = 2 * Math.PI * 24;

/**
 * Planning, schedule and dependencies — the language the Milestones and Tasks
 * work will use, prepared here without building either.
 *
 * Left: a schedule board with dependent bars, a "today" line and milestone
 * diamonds; a planner places the next milestone. Centre: the timeline runs on
 * over the pipe rack. Right: a calendar, a progress ring, and the plant only as
 * a distant horizon. Reference: the planning / scheduling desk scene.
 */
export function PlanningScheduleArt() {
  return (
    <>
      <Dots x1={60} x2={640} y1={44} y2={236} />
      <Ground x1={40} x2={1440} />
      <Dimension x1={960} x2={1420} y={310} />
      <SoftSkyline x={1196} />

      <Board x={150} y={78} width={410} height={184}>
        <rect className="bd-sky" x={162} y={90} width={386} height={10} rx={3} />
        <path className="bd-line-soft" d="M228 106V252M292 106V252M356 106V252M484 106V252" />
        {BARS.map(([y, x1, x2, tone]) => (
          <g key={y}>
            <rect className="bd-sky" x={164} y={y + 3} width={44} height={6} rx={3} />
            <rect className={`bd-${tone}`} x={x1} y={y} width={x2 - x1} height={12} rx={3} />
          </g>
        ))}
        <path className="bd-line" d="M316 120H328V176H336M388 148H396V232H400M452 176H458V204H462" />
        <path className="bd-ink" d="M336 172L342 176L336 180ZM400 228L406 232L400 236ZM462 200L468 204L462 208Z" />
        <rect className="bd-warm" x={419} y={104} width={2} height={150} />
        <circle className="bd-warm" cx={420} cy={104} r={4} />
        <Diamond cx={526} cy={204} />
        <Diamond cx={542} cy={232} />
      </Board>
      <Person x={600} pose="raise" shirt="warm" hair="short" flip>
        <Diamond cx={34} cy={-166} size={10} tone="warm" />
      </Person>

      <PipeRack x1={630} x2={930} y={240} />
      <path className="bd-line" d="M624 176H934M660 171V181M750 171V181M840 171V181" />
      <Diamond cx={705} cy={176} size={6} tone="blue" />
      <Diamond cx={795} cy={176} size={6} tone="blue" />
      <Diamond cx={885} cy={176} size={7} />

      <Board x={950} y={92} width={172} height={170}>
        <path className="bd-blue" d="M955 121V101Q955 97 959 97H1113Q1117 97 1117 101V121Z" />
        {[0, 1, 2, 3].map((row) =>
          [0, 1, 2, 3, 4].map((col) => {
            const marked = MARKED.find(([c, r]) => c === col && r === row);
            return (
              <rect
                key={`${col}-${row}`}
                className={`bd-${marked ? marked[2] : "sky"}`}
                x={962 + col * 31}
                y={130 + row * 31}
                width={24}
                height={24}
                rx={3}
              />
            );
          })
        )}
      </Board>
      <rect className="bd-ink" x={984} y={84} width={6} height={16} rx={3} />
      <rect className="bd-ink" x={1082} y={84} width={6} height={16} rx={3} />

      <circle className="bd-ring bd-ring-sky" cx={1170} cy={112} r={24} />
      <circle
        className="bd-ring bd-ring-warm"
        cx={1170}
        cy={112}
        r={24}
        strokeDasharray={`${RING * 0.62} ${RING}`}
        transform="rotate(-90 1170 112)"
      />
    </>
  );
}
