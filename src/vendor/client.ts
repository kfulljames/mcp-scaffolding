import type { HealthStatus } from "./types.js";

/**
 * The only interface every vendor client shares. Deliberately thin — a
 * single generic interface spanning every possible vendor (ConnectWise,
 * NinjaOne, M365, ...) becomes either impossibly generic or effectively
 * untyped. Vendor-specific clients extend this or compose narrow
 * capability interfaces instead:
 *
 * ```ts
 * interface ConnectWiseClient extends VendorClient {
 *   tickets: TicketService;
 *   agreements: AgreementService;
 * }
 *
 * // or, for capabilities shared across vendors:
 * interface TicketProvider {
 *   searchTickets(...): Promise<...>;
 *   getTicket(...): Promise<...>;
 * }
 * ```
 *
 * Everything vendor-specific lives behind this boundary — src/vendor/ is
 * the only place vendor-isms belong. See SPEC.md §2, principle 3.
 */
export interface VendorClient {
  readonly vendorId: string;
  healthCheck(signal?: AbortSignal): Promise<HealthStatus>;
}
