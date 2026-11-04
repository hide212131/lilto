export type HistoryDirection = "older" | "newer";
export type HistoryPageRequest = { cursor?: string; direction?: HistoryDirection };
export type HistoryPageInfo = { olderCursor: string | null; newerCursor: string | null };

type Page<T> = { messages: T[]; historyPage?: HistoryPageInfo };

// Keep only nearby pages. Evicted ranges remain reachable with API cursors.
export class ConversationHistoryWindow<T extends { id: string }> {
  revision = 0;
  private pages: Page<T>[] = [];

  reset(page?: Page<T>) {
    this.revision += 1;
    this.pages = page ? [page] : [];
  }

  add(page: Page<T>, direction: HistoryDirection) {
    this.pages = direction === "older"
      ? [page, ...this.pages].slice(0, 3)
      : [...this.pages, page].slice(-3);
  }

  get messages(): T[] {
    const messages = new Map<string, T>();
    for (const page of this.pages) {
      for (const message of page.messages) messages.set(message.id, message);
    }
    return [...messages.values()];
  }

  cursor(direction: HistoryDirection): string | null {
    const page = direction === "older" ? this.pages[0] : this.pages.at(-1);
    return page?.historyPage?.[direction === "older" ? "olderCursor" : "newerCursor"] ?? null;
  }
}
