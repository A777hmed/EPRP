import type * as React from "react";

import { cn } from "@/lib/utils";
import { ART_HEIGHT, ART_WIDTH, BACKDROP_ART, type BackdropVariant } from "./art";

/**
 * How strongly the backdrop shows. Each step is a theme token
 * (`--bd-strength-*` in `globals.css`), so light and dark carry their own
 * values: light 10–16 %, dark 12–18 %, and `feature` a little clearer for an
 * empty state where the illustration is the main visual content.
 */
export type BackdropStrength = "subtle" | "standard" | "strong" | "feature";

/**
 * Where the art sits in its region.
 *
 * - `band`  — a page or section header. On a wide header, lower-right at the
 *   region's height, starting after the text column. On a narrower one
 *   (phones, and laptops with the project sidebars open) it moves to the
 *   top-right corner beside the title, ending above the description.
 * - `corner` — a header whose description runs unbounded on one line, or
 *   whose actions fill its lower right. The band's corner placement at every
 *   width: top-right, beside the title, ending above the description.
 * - `panel` — an empty / first-run state. Fitted to the panel and centred on
 *   the ground line, with a clear zone down the middle for the message.
 */
export type BackdropLayout = "band" | "corner" | "panel";

export interface BackdropProps {
  variant: BackdropVariant;
  strength?: BackdropStrength;
  layout?: BackdropLayout;
  className?: string;
}

/**
 * The decorative background layer: an inline SVG painted BEHIND the content
 * of its region.
 *
 * It is absolutely positioned at `z-index: -1` inside a region that creates a
 * stacking context ({@link BackdropRegion}, or an empty state), so it never
 * affects layout, never intercepts a click (`pointer-events: none`), and
 * clips its own overflow. It is hidden from assistive technology, from print
 * and from forced-colours mode — see the "Background illustrations" block in
 * `globals.css`.
 *
 * Do not place it behind dense forms, operational tables, org-chart nodes,
 * report workspaces, previews or anything printable; `backdrop.test.mjs`
 * holds the list of surfaces allowed to use it.
 */
export function Backdrop({
  variant,
  strength,
  layout = "band",
  className,
}: BackdropProps) {
  const Art = BACKDROP_ART[variant];
  return (
    <div
      aria-hidden="true"
      data-backdrop={variant}
      data-backdrop-layout={layout}
      data-backdrop-strength={strength ?? (layout === "panel" ? "feature" : "standard")}
      className={cn("epr-backdrop print:hidden", className)}
    >
      <svg
        className="epr-backdrop-art"
        viewBox={`0 0 ${ART_WIDTH} ${ART_HEIGHT}`}
        preserveAspectRatio={layout === "panel" ? "xMidYMax meet" : "xMaxYMax meet"}
        focusable="false"
        aria-hidden="true"
      >
        <Art />
      </svg>
    </div>
  );
}

export interface BackdropRegionProps
  extends React.ComponentProps<"div">,
    Pick<BackdropProps, "variant" | "strength" | "layout"> {}

/**
 * A region whose content sits in front of a {@link Backdrop}. It adds only
 * `position: relative` and a stacking context — no spacing, no size — so
 * wrapping an existing header leaves its layout unchanged.
 */
export function BackdropRegion({
  variant,
  strength,
  layout = "band",
  className,
  children,
  ...props
}: BackdropRegionProps) {
  return (
    <div
      data-slot="backdrop-region"
      className={cn("epr-backdrop-region", className)}
      {...props}
    >
      <Backdrop variant={variant} strength={strength} layout={layout} />
      {children}
    </div>
  );
}
