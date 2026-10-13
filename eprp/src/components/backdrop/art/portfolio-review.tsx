import {
  Board,
  Desk,
  Dimension,
  Dots,
  Ground,
  Person,
  PipeRack,
  SeatedPerson,
  SoftSkyline,
} from "./primitives";

/** Planned vs actual, one pair per project: [x, planned height, actual height]. */
const PAIRS: [number, number, number][] = [
  [172, 58, 52],
  [202, 70, 68],
  [232, 48, 36],
  [262, 78, 72],
  [292, 64, 56],
];

/** Schedule variance around zero: [row y, signed length]. */
const VARIANCE: [number, number][] = [
  [156, -24],
  [172, 16],
  [188, -34],
  [204, 10],
  [220, -14],
];

const DONUT = 2 * Math.PI * 24;

/**
 * Portfolio and management review — the Reporting family's quieter scene,
 * for the Executive register.
 *
 * Left: a portfolio screen in the platform's own chart forms (KPI tiles,
 * planned-vs-actual pairs, a status donut and variance bars around zero), with
 * a presenter pointing at it. Centre: the review table, a reviewer seated at
 * it and another reading on a tablet. Right: the plant only as horizon. Fewer
 * warm accents than the coordination scene, so it reads calmer.
 */
export function PortfolioReviewArt() {
  return (
    <>
      <Dots x1={60} x2={640} y1={44} y2={236} />
      <Ground x1={40} x2={1440} />
      <Dimension x1={960} x2={1420} y={310} />
      <SoftSkyline x={1196} />

      <Board x={150} y={72} width={360} height={172}>
        <rect className="bd-sky" x={164} y={86} width={150} height={9} rx={3} />
        {[164, 248, 332, 416].map((x) => (
          <g key={x}>
            <rect className="bd-paper bd-outline" x={x} y={104} width={76} height={28} rx={3} />
            <rect className="bd-blue" x={x + 8} y={114} width={28} height={8} rx={2} />
          </g>
        ))}
        {PAIRS.map(([x, planned, actual]) => (
          <g key={x}>
            <rect className="bd-sky" x={x} y={228 - planned} width={10} height={planned} rx={1} />
            <rect className="bd-blue" x={x + 11} y={228 - actual} width={10} height={actual} rx={1} />
          </g>
        ))}
        <path className="bd-line" d="M166 228H322" />
        <circle className="bd-ring bd-ring-sky" cx={376} cy={184} r={24} />
        <circle
          className="bd-ring bd-ring-blue"
          cx={376}
          cy={184}
          r={24}
          strokeDasharray={`${DONUT * 0.58} ${DONUT}`}
          transform="rotate(-90 376 184)"
        />
        <circle
          className="bd-ring bd-ring-warm"
          cx={376}
          cy={184}
          r={24}
          strokeDasharray={`${DONUT * 0.14} ${DONUT}`}
          strokeDashoffset={-DONUT * 0.6}
          transform="rotate(-90 376 184)"
        />
        {VARIANCE.map(([y, length]) => (
          <rect
            key={y}
            className={length < 0 ? "bd-sky" : "bd-blue"}
            x={length < 0 ? 458 + length : 458}
            y={y}
            width={Math.abs(length)}
            height={8}
            rx={1}
          />
        ))}
        <path className="bd-line" d="M458 148V234" />
      </Board>
      <Person x={550} pose="point" shirt="blue" hair="long" flip />

      <Desk x={640} width={200} />
      <rect className="bd-sky" x={724} y={205} width={40} height={5} rx={1} />
      <rect className="bd-blue" x={784} y={174} width={36} height={30} rx={2} />
      <path className="bd-ink" d="M776 210H832L828 205H780Z" />
      <SeatedPerson x={872} shirt="sky" hair="short" flip />
      <Person x={944} pose="tablet" shirt="sky" hair="bun" flip />

      <PipeRack x1={990} x2={1170} y={246} />
    </>
  );
}
