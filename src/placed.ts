// Whether a group or item has a real place on the geographic map. Kept apart from geographic.ts (which pulls in
// Leaflet) so the details pane can offer "Locate on geographic map" before that page has loaded.
import type { Coalition, GraphNode, Organization } from "./types";
import { REGION } from "./region.config";

/** The point the data uses when it only knows the state (statewide, national, or no address yet): REGION.fallback. */
export const atFallback = (lat: number, lng: number) => Math.abs(lat - REGION.fallback.lat) < 1e-4 && Math.abs(lng - REGION.fallback.lng) < 1e-4;
const FALLBACK_TOWN = new RegExp(`\\b${REGION.fallback.town}\\b`, "i");
/** A real place for this group: not remote, and not the fallback point (unless the group really is in that town). */
export function orgPlaced(o: Organization): boolean {
  if (o.remote || !Number.isFinite(o.lat) || !Number.isFinite(o.lng) || (o.lat === 0 && o.lng === 0)) return false;
  return !(o.profile?.geo_precision !== "exact" && atFallback(o.lat, o.lng) && !FALLBACK_TOWN.test(o.geographic_focus || ""));
}
/** Coalitions are placed by their members; statewide and national ones have no one place, so they aren't pinned. */
export function coalitionPlaced(c: Coalition): boolean {
  return c.member_count > 0 && !/statewide|national/i.test(c.geographic_scope || "") && !atFallback(c.lat, c.lng);
}

/** Same answer as the geographic page's canLocate(): an item with a pin, a coalition, or a placed org. */
export function geoCanLocate(node: GraphNode, item?: { lat?: number; lng?: number }): boolean {
  if (item && item.lat !== undefined && item.lng !== undefined) return true;
  return node.kind === "coalition" ? true : orgPlaced(node as Organization);
}
