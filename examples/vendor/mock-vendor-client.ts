import type { VendorClient } from "../../src/vendor/client.js";
import type { HealthStatus } from "../../src/vendor/types.js";
import type { VendorCredentials } from "../../src/auth/credential-provider.js";
import type { ResolvedTenant } from "../../src/auth/tenant-resolver.js";
import { VendorNotFoundError } from "../../src/vendor/errors.js";
import { fetchAllPages, type Page } from "../../src/vendor/pagination.js";

export interface MockTicket {
  id: number;
  tenantId: string;
  summary: string;
  priority: "low" | "medium" | "high" | "critical";
  status: "open" | "closed";
  boardId: number;
}

/**
 * Fake per-tenant data, in memory, seeded at module load. This is what
 * examples/read-tool.ts and examples/write-tool.ts actually run against —
 * it exists so `npm run dev` and the test suite work end to end without a
 * real vendor API, and so tests/tenant-isolation/ has two distinct
 * tenants' data to prove isolation against. Replace this whole file with a
 * real HTTP-backed VendorClient (see src/vendor/http-client.ts) for an
 * actual server — see docs/ADDING-A-TOOL.md.
 */
const TICKETS_BY_TENANT = new Map<string, MockTicket[]>([
  [
    "tenant-a",
    [
      {
        id: 1,
        tenantId: "tenant-a",
        summary: "Email down for VIP user",
        priority: "critical",
        status: "open",
        boardId: 1,
      },
      {
        id: 2,
        tenantId: "tenant-a",
        summary: "Printer offline",
        priority: "low",
        status: "open",
        boardId: 1,
      },
      {
        id: 3,
        tenantId: "tenant-a",
        summary: "VPN certificate expired",
        priority: "high",
        status: "open",
        boardId: 2,
      },
    ],
  ],
  [
    "tenant-b",
    [
      {
        id: 101,
        tenantId: "tenant-b",
        summary: "Server disk nearly full",
        priority: "high",
        status: "open",
        boardId: 1,
      },
      {
        id: 102,
        tenantId: "tenant-b",
        summary: "New hire onboarding",
        priority: "medium",
        status: "closed",
        boardId: 3,
      },
    ],
  ],
]);

export interface TicketService {
  searchOpenHighPriority(params: {
    boardIds?: number[];
    limit: number;
  }): Promise<MockTicket[]>;
  getTicket(id: number): Promise<MockTicket>;
  closeTicket(id: number, resolution: string): Promise<MockTicket>;
}

export class MockVendorClient implements VendorClient {
  readonly vendorId = "mockvendor";
  private readonly tickets: MockTicket[];

  constructor(
    private readonly credentials: VendorCredentials,
    private readonly tenant: ResolvedTenant,
  ) {
    if (!this.credentials.apiKey) {
      throw new Error("MockVendorClient requires an apiKey credential.");
    }
    // Tenant-scoped by construction: this client can only ever see the
    // slice of TICKETS_BY_TENANT for the tenant it was built for. There is
    // no parameter that lets a caller widen this after construction — that
    // is the property tests/tenant-isolation/ verifies.
    this.tickets = TICKETS_BY_TENANT.get(this.tenant.tenantId) ?? [];
  }

  healthCheck(): Promise<HealthStatus> {
    return Promise.resolve({ healthy: true, checkedAt: new Date().toISOString() });
  }

  readonly ticketsService: TicketService = {
    searchOpenHighPriority: async ({ boardIds, limit }) => {
      const matches = this.tickets.filter(
        (t) =>
          t.status === "open" &&
          (t.priority === "high" || t.priority === "critical") &&
          (!boardIds || boardIds.includes(t.boardId)),
      );
      const page = await fetchAllPages<MockTicket>(
        async (request) => {
          const start = request.cursor ? Number(request.cursor) : 0;
          const slice = matches.slice(start, start + request.limit);
          const nextCursor =
            start + request.limit < matches.length
              ? String(start + request.limit)
              : undefined;
          return await Promise.resolve<Page<MockTicket>>({ items: slice, nextCursor });
        },
        { pageSize: Math.min(limit, 100), maxItems: limit, maxPages: 10 },
      );
      return page;
    },

    getTicket: async (id) => {
      const ticket = this.tickets.find((t) => t.id === id);
      if (!ticket) {
        return await Promise.reject(
          new VendorNotFoundError(`Ticket ${id} not found`, "mockvendor"),
        );
      }
      return await Promise.resolve(ticket);
    },

    closeTicket: async (id, resolution) => {
      const ticket = this.tickets.find((t) => t.id === id);
      if (!ticket) {
        return await Promise.reject(
          new VendorNotFoundError(`Ticket ${id} not found`, "mockvendor"),
        );
      }
      ticket.status = "closed";
      void resolution;
      return await Promise.resolve(ticket);
    },
  };
}

export interface MockVendorCapableClient extends VendorClient {
  ticketsService: TicketService;
}
