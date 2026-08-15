/**
 * Calendar feature barrel.
 *
 * Only the client entry points are re-exported. `calendar-access.ts` is
 * `server-only` and is imported directly by the route, and the services and
 * hooks are imported by path — a route file is a SERVER module, so anything
 * re-exported here is evaluated in the server graph.
 */

export { CalendarWorkspace, type CalendarWorkspaceProps } from "./calendar-workspace";
export { CalendarPreview } from "./calendar-preview";
export {
  EVENT_TYPE_META,
  EVENT_TYPE_ORDER,
  type CalendarEvent,
  type CalendarEventType,
} from "./calendar-types";
