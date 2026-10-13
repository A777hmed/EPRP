import {
  Board,
  Dimension,
  Dots,
  Ground,
  Note,
  OrgNode,
  Person,
  PipeRack,
  SoftSkyline,
  type Tone,
} from "./primitives";

/** Notes on the coordination board: [x, y, tone, turn°]. */
const NOTES: [number, number, Tone, number][] = [
  [156, 104, "sand", -4],
  [206, 102, "sky", 3],
  [256, 106, "warm", -2],
  [310, 102, "blue", 2],
  [162, 152, "blue", 2],
  [214, 154, "sand", -3],
  [266, 150, "sky", 4],
  [316, 156, "sand", -2],
  [178, 202, "sky", -1],
  [234, 200, "warm", 2],
  [288, 204, "blue", -3],
];

/** Report-sheet bar chart: [x, height, tone]. */
const BARS: [number, number, Tone][] = [
  [466, 36, "sky"],
  [486, 56, "blue"],
  [506, 30, "sky"],
  [526, 70, "blue"],
  [546, 46, "warm"],
];

const DONUT = 2 * Math.PI * 24;

/**
 * Reporting and collaboration — the coordination that becomes a report, and
 * the reporting lines it travels along.
 *
 * Left: a note board being worked (coordination), a report sheet with its
 * chart, and a colleague reviewing on a tablet. Centre: a summary card linked
 * onward. Right: a reporting-line diagram, with the plant only as horizon.
 * Reference: the sticky-note coordination board and the analytics card.
 */
export function ReportingCollaborationArt() {
  return (
    <>
      <Dots x1={60} x2={640} y1={44} y2={236} />
      <Ground x1={40} x2={1440} />
      <Dimension x1={960} x2={1420} y={310} />
      <SoftSkyline x={1196} />

      <Board x={140} y={92} width={236} height={164}>
        {NOTES.map(([x, y, tone, turn]) => (
          <Note key={`${x}-${y}`} x={x} y={y} tone={tone} turn={turn} />
        ))}
      </Board>
      <Person x={414} pose="raise" shirt="blue" hair="long" flip>
        <Note x={22} y={-178} tone="sand" turn={6} width={20} height={18} />
      </Person>

      <Board x={452} y={64} width={132} height={190}>
        <rect className="bd-blue" x={460} y={72} width={116} height={14} rx={2} />
        <rect className="bd-sky" x={462} y={94} width={96} height={5} rx={2} />
        <rect className="bd-sky" x={462} y={104} width={74} height={5} rx={2} />
        <rect className="bd-sky" x={462} y={114} width={86} height={5} rx={2} />
        {BARS.map(([x, height, tone]) => (
          <rect key={x} className={`bd-${tone}`} x={x} y={196 - height} width={14} height={height} rx={1} />
        ))}
        <path className="bd-line" d="M462 196H574" />
        <rect className="bd-sky" x={462} y={208} width={104} height={5} rx={2} />
        <rect className="bd-sky" x={462} y={218} width={70} height={5} rx={2} />
        <rect className="bd-sky" x={462} y={228} width={90} height={5} rx={2} />
      </Board>
      <Person x={626} pose="tablet" shirt="warm" hair="short" flip />

      <rect className="bd-ink" x={666} y={110} width={112} height={88} rx={6} />
      <rect className="bd-paper" x={671} y={115} width={102} height={78} rx={3} />
      <circle className="bd-ring bd-ring-sky" cx={700} cy={154} r={24} />
      <circle
        className="bd-ring bd-ring-blue"
        cx={700}
        cy={154}
        r={24}
        strokeDasharray={`${DONUT * 0.55} ${DONUT}`}
        transform="rotate(-90 700 154)"
      />
      <circle
        className="bd-ring bd-ring-warm"
        cx={700}
        cy={154}
        r={24}
        strokeDasharray={`${DONUT * 0.18} ${DONUT}`}
        strokeDashoffset={-DONUT * 0.58}
        transform="rotate(-90 700 154)"
      />
      <rect className="bd-sky" x={734} y={140} width={30} height={5} rx={2} />
      <rect className="bd-sky" x={734} y={151} width={22} height={5} rx={2} />
      <rect className="bd-sky" x={734} y={162} width={27} height={5} rx={2} />
      <path className="bd-line-soft" d="M778 154C900 154 1010 79 1150 79" />

      <PipeRack x1={790} x2={968} y={244} />

      <path
        className="bd-line"
        d="M1182 94V118M1062 118H1302M1062 118V140M1182 118V140M1302 118V140M1062 170V194M1012 194H1112M1012 194V216M1112 194V216M1302 170V194M1262 194H1362M1262 194V216M1362 194V216"
      />
      <OrgNode x={1150} y={64} level={1} />
      <OrgNode x={1030} y={140} level={2} />
      <OrgNode x={1150} y={140} level={2} />
      <OrgNode x={1270} y={140} level={2} />
      <OrgNode x={980} y={216} level={3} />
      <OrgNode x={1080} y={216} level={3} />
      <OrgNode x={1230} y={216} level={3} />
      <OrgNode x={1330} y={216} level={3} />
    </>
  );
}
