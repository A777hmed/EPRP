import {
  Board,
  Column,
  Desk,
  Dimension,
  Dots,
  Flare,
  Ground,
  Person,
  PipeRack,
  SeatedPerson,
  SphereTank,
  StorageTank,
  type Tone,
} from "./primitives";

/** Planning-board cards: [x, y, width, tone]. Heights are uniform. */
const CARDS: [number, number, number, Tone][] = [
  [270, 146, 28, "sky"],
  [304, 146, 28, "sand"],
  [270, 176, 28, "blue"],
  [288, 206, 28, "sand"],
  [356, 146, 28, "sand"],
  [390, 150, 24, "blue"],
  [360, 178, 28, "sky"],
  [374, 210, 28, "warm"],
  [440, 146, 28, "blue"],
  [474, 148, 26, "sand"],
  [446, 182, 28, "sky"],
];

/**
 * The main backdrop — project planning in front of the plant it serves.
 *
 * Left: a team at a planning board (two standing, pointing and reviewing).
 * Centre: a planner at a desk and the pipe rack that links office to plant.
 * Right: the refinery — two columns, a sphere, storage tanks and a flare.
 * Reference: the collaborative planning scene with the refinery horizon.
 */
export function RefineryPlanningArt() {
  return (
    <>
      <Dots x1={60} x2={640} y1={44} y2={236} />
      <Ground x1={40} x2={1440} />
      <Dimension x1={990} x2={1420} y={310} />

      <Board x={250} y={112} width={270} height={146}>
        <rect className="bd-warm" x={268} y={128} width={64} height={8} rx={4} />
        <rect className="bd-blue" x={352} y={128} width={64} height={8} rx={4} />
        <rect className="bd-sky" x={436} y={128} width={64} height={8} rx={4} />
        <path className="bd-line" d="M342 124V246M426 124V246" />
        {CARDS.map(([x, y, width, tone]) => (
          <rect key={`${x}-${y}`} className={`bd-${tone}`} x={x} y={y} width={width} height={22} rx={2} />
        ))}
        <path className="bd-line" d="M300 240H404M398 236L404 240L398 244" />
      </Board>
      <Person x={214} pose="point" shirt="warm" hair="long" />
      <Person x={566} pose="tablet" shirt="blue" hair="short" flip />

      <SeatedPerson x={662} shirt="sky" hair="bun" />
      <Desk x={664} width={124} />
      <PipeRack x1={800} x2={1004} y={232} />

      <Flare x={1346} top={56} />
      <Column x={1010} top={58} width={38} />
      <Column x={1064} top={118} width={26} />
      <path className="bd-line" d="M1048 168H1104V206M1090 214H1120" />
      <SphereTank cx={1152} cy={236} r={40} />
      <StorageTank x={1214} width={96} height={62} />
      <StorageTank x={1378} width={52} height={40} />
      <path className="bd-line" d="M1192 270H1214M1310 280H1378" />
    </>
  );
}
