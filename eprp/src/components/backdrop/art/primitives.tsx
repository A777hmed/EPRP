import type * as React from "react";

/**
 * Drawing primitives shared by every backdrop variant.
 *
 * One construction system keeps the variants one family: a 1440 × 320 canvas,
 * a single ground line, the same faceless figure, the same plant geometry and
 * the same board frame. Nothing here carries a colour — every shape takes a
 * `bd-*` tone class, and the tones resolve to theme tokens in `globals.css`
 * (light and dark), so one drawing serves both themes.
 *
 * Tone roles: `ink` structure and the darkest accents · `blue` primary objects
 * · `sky` secondary surfaces · `warm` / `sand` the warm accent (never a status
 * colour) · `paper` occludes what sits behind a board, matching the ground.
 */

export const ART_WIDTH = 1440;
export const ART_HEIGHT = 320;
export const GROUND = 296;

export type Tone = "ink" | "blue" | "sky" | "warm" | "sand";

function place(x: number, y = GROUND, flip = false): string {
  return `translate(${x} ${y})${flip ? " scale(-1 1)" : ""}`;
}

/* ------------------------------- Technical -------------------------------- */

/** Blueprint dot grid — the drawing-office ground the scenes stand on. */
export function Dots({
  x1,
  x2,
  y1,
  y2,
  step = 24,
}: {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  step?: number;
}) {
  const rows: string[] = [];
  for (let y = y1; y <= y2; y += step) rows.push(`M${x1} ${y}H${x2}`);
  return <path className="bd-dots" d={rows.join("")} />;
}

export function Ground({ x1, x2 }: { x1: number; x2: number }) {
  return <path className="bd-line" d={`M${x1} ${GROUND}H${x2}`} />;
}

/** A drawing dimension line under the plant: the engineering cue, not a label. */
export function Dimension({ x1, x2, y }: { x1: number; x2: number; y: number }) {
  const mid = Math.round((x1 + x2) / 2);
  return (
    <path
      className="bd-line-soft"
      d={`M${x1} ${y}H${x2}M${x1} ${y - 5}V${y + 5}M${x2} ${y - 5}V${y + 5}M${mid} ${y - 3}V${y + 3}`}
    />
  );
}

export function Diamond({
  cx,
  cy,
  size = 7,
  tone = "ink",
}: {
  cx: number;
  cy: number;
  size?: number;
  tone?: Tone;
}) {
  return (
    <path
      className={`bd-${tone}`}
      d={`M${cx} ${cy - size}L${cx + size} ${cy}L${cx} ${cy + size}L${cx - size} ${cy}Z`}
    />
  );
}

/* --------------------------------- People --------------------------------- */

export type PersonPose = "rest" | "point" | "tablet" | "raise";
export type HairStyle = "short" | "long" | "bun";

function Hair({ kind, cx = 0 }: { kind: HairStyle; cx?: number }) {
  if (kind === "long") {
    return (
      <path
        className="bd-ink"
        transform={`translate(${cx} 0)`}
        d="M-12 -145A12 12 0 0 1 12 -145V-128Q8 -132 7 -142Q0 -150 -7 -142Q-8 -132 -12 -128Z"
      />
    );
  }
  return (
    <g transform={`translate(${cx} 0)`}>
      {kind === "bun" && <circle className="bd-ink" cx={0} cy={-160} r={5} />}
      <path
        className="bd-ink"
        d="M-11.5 -146A11.5 11.5 0 0 1 11.5 -146Q6 -151 0 -151Q-6 -151 -11.5 -146Z"
      />
    </g>
  );
}

/**
 * A standing, faceless figure. `x` is the point between the feet on the
 * ground line; `flip` turns the figure to face left. `children` render in the
 * figure's own coordinates after the arms, so a held item flips with it — the
 * raised hand is at (32, -154).
 */
export function Person({
  x,
  pose = "rest",
  shirt = "blue",
  hair = "short",
  flip = false,
  children,
}: {
  x: number;
  pose?: PersonPose;
  shirt?: Tone;
  hair?: HairStyle;
  flip?: boolean;
  children?: React.ReactNode;
}) {
  const limb = `bd-limb bd-limb-${shirt}`;
  return (
    <g transform={place(x, GROUND, flip)}>
      <rect className="bd-ink" x={-14} y={-6} width={12} height={6} rx={2} />
      <rect className="bd-ink" x={2} y={-6} width={12} height={6} rx={2} />
      <path className="bd-ink" d="M-12 -74H12L10 -6H2L0 -52L-2 -6H-10Z" />
      <path
        className={`bd-${shirt}`}
        d="M-17 -118Q-17 -129 -6 -130H6Q17 -129 17 -118L15 -70H-15Z"
      />
      <rect className="bd-sand" x={-4} y={-137} width={8} height={9} />
      <circle className="bd-sand" cx={0} cy={-146} r={11} />
      <Hair kind={hair} />

      {pose === "rest" && (
        <>
          <path className={limb} d="M-14 -122L-19 -82" />
          <path className={limb} d="M14 -122L19 -82" />
          <circle className="bd-sand" cx={-19} cy={-82} r={4} />
          <circle className="bd-sand" cx={19} cy={-82} r={4} />
        </>
      )}
      {pose === "point" && (
        <>
          <path className={limb} d="M-14 -122L-19 -82" />
          <path className={limb} d="M14 -122L36 -150" />
          <circle className="bd-sand" cx={-19} cy={-82} r={4} />
          <circle className="bd-sand" cx={36} cy={-150} r={4} />
        </>
      )}
      {pose === "raise" && (
        <>
          <path className={limb} d="M-14 -122L-19 -82" />
          <path className={limb} d="M14 -122L32 -154" />
          <circle className="bd-sand" cx={-19} cy={-82} r={4} />
          <circle className="bd-sand" cx={32} cy={-154} r={4} />
        </>
      )}
      {pose === "tablet" && (
        <>
          <path className={limb} d="M-14 -122L-17 -98L-6 -94" />
          <path className={limb} d="M14 -122L17 -98L6 -94" />
          <rect className="bd-ink" x={-15} y={-110} width={30} height={19} rx={2} />
          <circle className="bd-sand" cx={-11} cy={-92} r={4} />
          <circle className="bd-sand" cx={11} cy={-92} r={4} />
        </>
      )}
      {children}
    </g>
  );
}

/**
 * A seated figure facing right, working at a {@link Desk}; `flip` turns it to
 * face left, with the desk on its left.
 */
export function SeatedPerson({
  x,
  shirt = "blue",
  hair = "short",
  flip = false,
}: {
  x: number;
  shirt?: Tone;
  hair?: HairStyle;
  flip?: boolean;
}) {
  return (
    <g transform={place(x, GROUND, flip)}>
      <rect className="bd-ink" x={-36} y={-108} width={6} height={56} rx={2} />
      <rect className="bd-ink" x={-34} y={-58} width={36} height={6} rx={2} />
      <rect className="bd-ink" x={-18} y={-52} width={4} height={48} />
      <rect className="bd-ink" x={-32} y={-4} width={32} height={4} rx={2} />
      <path className="bd-ink" d="M-28 -72H6Q14 -72 14 -64V-6H4V-60H-28Z" />
      <rect className="bd-ink" x={2} y={-6} width={16} height={6} rx={2} />
      <path
        className={`bd-${shirt}`}
        d="M-30 -118Q-30 -129 -19 -130H-7Q4 -129 4 -118L2 -70H-28Z"
      />
      <rect className="bd-sand" x={-17} y={-137} width={8} height={9} />
      <circle className="bd-sand" cx={-13} cy={-146} r={11} />
      <Hair kind={hair} cx={-13} />
      <path className={`bd-limb bd-limb-${shirt}`} d="M0 -120L18 -98H34" />
      <circle className="bd-sand" cx={34} cy={-98} r={4} />
    </g>
  );
}

/** A work table with an open laptop; `x` is its left edge. */
export function Desk({ x, width = 120 }: { x: number; width?: number }) {
  const top = GROUND - 86;
  return (
    <g>
      <rect className="bd-ink" x={x + 20} y={top} width={4} height={86} />
      <rect className="bd-ink" x={x + width - 14} y={top} width={4} height={86} />
      <rect className="bd-ink" x={x} y={top} width={width} height={6} rx={2} />
      <rect className="bd-blue" x={x + 30} y={top - 36} width={40} height={30} rx={2} />
      <path className="bd-ink" d={`M${x + 22} ${top}H${x + 78}L${x + 74} ${top - 5}H${x + 26}Z`} />
    </g>
  );
}

/* ------------------------------ Boards / cards ----------------------------- */

/**
 * A framed board on a stand: the shared container for the planning board, the
 * schedule, the note board and the report sheet. Its inner surface is `paper`,
 * so the plant behind it is occluded rather than showing through.
 */
export function Board({
  x,
  y,
  width,
  height,
  stand = true,
  children,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  stand?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <g>
      {stand && (
        <>
          <rect className="bd-ink" x={x + 18} y={y + height} width={5} height={GROUND - y - height} />
          <rect className="bd-ink" x={x + width - 23} y={y + height} width={5} height={GROUND - y - height} />
        </>
      )}
      <rect className="bd-ink" x={x} y={y} width={width} height={height} rx={6} />
      <rect className="bd-paper" x={x + 5} y={y + 5} width={width - 10} height={height - 10} rx={3} />
      {children}
    </g>
  );
}

/** A sticky note, slightly turned, with its pin. */
export function Note({
  x,
  y,
  tone,
  turn = 0,
  width = 40,
  height = 36,
}: {
  x: number;
  y: number;
  tone: Tone;
  turn?: number;
  width?: number;
  height?: number;
}) {
  const cx = x + width / 2;
  const cy = y + height / 2;
  return (
    <g transform={`rotate(${turn} ${cx} ${cy})`}>
      <rect className={`bd-${tone}`} x={x} y={y} width={width} height={height} rx={2} />
      <circle className="bd-ink" cx={cx} cy={y + 5} r={2.5} />
    </g>
  );
}

/** One node of a reporting-line diagram: an avatar and two name bars, no text. */
export function OrgNode({
  x,
  y,
  level,
}: {
  x: number;
  y: number;
  level: 1 | 2 | 3;
}) {
  const fill = level === 1 ? "bd-ink" : level === 2 ? "bd-blue" : "bd-paper bd-outline";
  return (
    <g>
      <rect className={fill} x={x} y={y} width={64} height={30} rx={6} />
      <circle className="bd-sand" cx={x + 14} cy={y + 15} r={7} />
      <rect className="bd-sky" x={x + 26} y={y + 9} width={30} height={4} rx={2} />
      <rect className="bd-sky" x={x + 26} y={y + 17} width={22} height={4} rx={2} />
    </g>
  );
}

/* --------------------------------- Plant ---------------------------------- */

/** A distillation column: domed shell, shaded side and platforms. */
export function Column({ x, top, width }: { x: number; top: number; width: number }) {
  const shoulder = top + width / 2;
  const platforms: number[] = [];
  for (let y = shoulder + 30; y < GROUND - 24; y += 46) platforms.push(y);
  return (
    <g>
      <path className="bd-line" d={`M${x - 9} ${shoulder + 16}V${GROUND}`} />
      <path
        className="bd-blue"
        d={`M${x} ${GROUND}V${shoulder}A${width / 2} ${width / 2} 0 0 1 ${x + width} ${shoulder}V${GROUND}Z`}
      />
      <rect
        className="bd-ink"
        x={x + width * 0.68}
        y={shoulder}
        width={width * 0.32}
        height={GROUND - shoulder}
      />
      {platforms.map((y) => (
        <rect key={y} className="bd-ink" x={x - 6} y={y} width={width + 12} height={3} rx={1} />
      ))}
    </g>
  );
}

/** A spherical pressure vessel on legs. */
export function SphereTank({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const legs = [cx - r * 0.78, cx - r * 0.3, cx + r * 0.3 - 4, cx + r * 0.78 - 4];
  return (
    <g>
      {legs.map((lx) => (
        <rect key={lx} className="bd-ink" x={lx} y={cy} width={4} height={GROUND - cy} />
      ))}
      <path
        className="bd-line"
        d={`M${legs[0] + 2} ${cy + r * 0.55}L${legs[1] + 2} ${GROUND - 4}M${legs[2] + 2} ${GROUND - 4}L${legs[3] + 2} ${cy + r * 0.55}`}
      />
      <circle className="bd-sky" cx={cx} cy={cy} r={r} />
      <path
        className="bd-blue"
        d={`M${cx} ${cy - r}A${r} ${r} 0 0 1 ${cx} ${cy + r}A${r * 0.6} ${r} 0 0 0 ${cx} ${cy - r}Z`}
      />
      <path className="bd-line" d={`M${cx - r} ${cy}H${cx + r}`} />
    </g>
  );
}

/** A cylindrical storage tank with a shallow cone roof and a stair. */
export function StorageTank({ x, width, height }: { x: number; width: number; height: number }) {
  const top = GROUND - height;
  return (
    <g>
      <rect className="bd-sky" x={x} y={top} width={width} height={height} />
      <rect className="bd-blue" x={x + width * 0.72} y={top} width={width * 0.28} height={height} />
      <path className="bd-blue" d={`M${x} ${top}Q${x + width / 2} ${top - 12} ${x + width} ${top}Z`} />
      <path
        className="bd-line"
        d={`M${x} ${top + height * 0.36}H${x + width}M${x} ${top + height * 0.7}H${x + width}M${x + 6} ${GROUND}L${x + width * 0.6} ${top}`}
      />
    </g>
  );
}

/** A flare stack with guy wires. The flame is the one warm highlight. */
export function Flare({ x, top }: { x: number; top: number }) {
  return (
    <g>
      <path
        className="bd-line"
        d={`M${x} ${top + 40}L${x - 46} ${GROUND}M${x} ${top + 40}L${x + 46} ${GROUND}`}
      />
      <rect className="bd-ink" x={x - 3} y={top} width={6} height={GROUND - top} />
      <rect className="bd-ink" x={x - 6} y={top - 4} width={12} height={6} rx={2} />
      <path
        className="bd-warm"
        d={`M${x} ${top - 44}C${x + 10} ${top - 30} ${x + 15} ${top - 21} ${x + 15} ${top - 14}A15 15 0 0 1 ${x - 15} ${top - 14}C${x - 15} ${top - 21} ${x - 10} ${top - 30} ${x} ${top - 44}Z`}
      />
      <path
        className="bd-sand"
        d={`M${x} ${top - 30}C${x + 5} ${top - 22} ${x + 8} ${top - 17} ${x + 8} ${top - 12}A8 8 0 0 1 ${x - 8} ${top - 12}C${x - 8} ${top - 17} ${x - 5} ${top - 22} ${x} ${top - 30}Z`}
      />
    </g>
  );
}

/** A pipe rack: posts, a beam and two pipe runs. */
export function PipeRack({ x1, x2, y }: { x1: number; x2: number; y: number }) {
  const posts: number[] = [];
  for (let x = x1 + 8; x < x2 - 4; x += 52) posts.push(x);
  return (
    <g>
      {posts.map((px) => (
        <rect key={px} className="bd-ink" x={px} y={y} width={4} height={GROUND - y} />
      ))}
      <rect className="bd-ink" x={x1} y={y} width={x2 - x1} height={3} />
      <rect className="bd-blue" x={x1} y={y - 12} width={x2 - x1} height={6} rx={3} />
      <rect className="bd-sky" x={x1} y={y - 5} width={x2 - x1} height={5} rx={2.5} />
    </g>
  );
}

/**
 * A distant plant silhouette in one light tone — the refinery as horizon, for
 * variants where the plant must stay secondary. Spans `x` to `x + 230`.
 */
export function SoftSkyline({ x }: { x: number }) {
  return (
    <g>
      <path className="bd-sky" d={`M${x} ${GROUND}V${162}A12 12 0 0 1 ${x + 24} ${162}V${GROUND}Z`} />
      <path className="bd-sky" d={`M${x + 34} ${GROUND}V${204}A9 9 0 0 1 ${x + 52} ${204}V${GROUND}Z`} />
      <rect className="bd-sky" x={x + 80} y={262} width={3} height={34} />
      <rect className="bd-sky" x={x + 108} y={262} width={3} height={34} />
      <circle className="bd-sky" cx={x + 96} cy={262} r={24} />
      <rect className="bd-sky" x={x + 132} y={258} width={58} height={38} />
      <path className="bd-sky" d={`M${x + 132} 258Q${x + 161} 248 ${x + 190} 258Z`} />
      <rect className="bd-sky" x={x + 214} y={128} width={5} height={GROUND - 128} />
      <path
        className="bd-sand"
        d={`M${x + 216} ${98}C${x + 222} 106 ${x + 225} 112 ${x + 225} 116A9 9 0 0 1 ${x + 207} 116C${x + 207} 112 ${x + 210} 106 ${x + 216} 98Z`}
      />
    </g>
  );
}
