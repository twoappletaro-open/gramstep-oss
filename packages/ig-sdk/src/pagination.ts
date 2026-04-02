import type { Result } from "@gramstep/shared";
import { ok, err, isErr } from "@gramstep/shared";
import type { PagedResponse } from "./types.js";

export type PaginationError = {
  code: "PAGINATION_ERROR";
  message: string;
};

export async function fetchAllPages<T>(
  fetcher: (cursor?: string) => Promise<Result<PagedResponse<T>, PaginationError>>,
  maxPages: number = 100,
): Promise<Result<T[], PaginationError>> {
  const allItems: T[] = [];
  let cursor: string | undefined;
  let pageCount = 0;

  while (pageCount < maxPages) {
    const result = await fetcher(cursor);
    if (isErr(result)) {
      return err(result.error);
    }

    allItems.push(...result.value.data);
    pageCount++;

    const nextCursor = result.value.paging?.cursors?.after;
    if (!nextCursor || !result.value.paging?.next) {
      break;
    }
    cursor = nextCursor;
  }

  return ok(allItems);
}
