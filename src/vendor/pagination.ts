export interface PageRequest {
  cursor?: string;
  limit: number;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export class PaginationBoundExceededError extends Error {
  constructor(maxPages: number) {
    super(
      `Pagination exceeded the configured maximum of ${maxPages} pages for a single tool call. ` +
        `No tool may request an unbounded result set — narrow the query instead of raising this limit.`,
    );
    this.name = "PaginationBoundExceededError";
  }
}

/**
 * Drives a cursor-paginated vendor endpoint to completion, bounded by both
 * a max item count and a max page count so a single tool call can never
 * fan out into an unbounded number of upstream requests (SPEC.md §8).
 * Reaching the bound is a hard error, not a silent truncation — a tool
 * author who hits it needs to narrow the query or explicitly paginate
 * across multiple calls, not get quietly incomplete data.
 */
export async function fetchAllPages<T>(
  fetchPage: (request: PageRequest) => Promise<Page<T>>,
  options: { pageSize: number; maxItems: number; maxPages: number; signal?: AbortSignal },
): Promise<T[]> {
  const results: T[] = [];
  let cursor: string | undefined;
  let pageCount = 0;

  do {
    if (options.signal?.aborted) {
      throw new DOMException("Pagination aborted", "AbortError");
    }
    if (pageCount >= options.maxPages) {
      throw new PaginationBoundExceededError(options.maxPages);
    }
    const page = await fetchPage({ cursor, limit: options.pageSize });
    results.push(...page.items);
    cursor = page.nextCursor;
    pageCount += 1;
  } while (cursor && results.length < options.maxItems);

  return results.slice(0, options.maxItems);
}
