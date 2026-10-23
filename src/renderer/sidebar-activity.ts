import { marked } from "marked";
import type { Message, Session } from "./types.js";

export type ActivityPreview = {
  updatedAt: number;
  status: "loading" | "ready" | "empty" | "error";
  text: string;
};

export function extractActivityPreview(messages: Message[]): string {
  const latest = [...messages].reverse().find((message) =>
    !message.pending && message.text.trim() && ["user", "assistant", "system", "error"].includes(message.role)
  );
  if (!latest) return "";

  const tokens = marked.lexer(latest.text);
  const parts: string[] = [];
  const visit = (token: Record<string, unknown>) => {
    if (token.type === "space") {
      parts.push(" ");
      return;
    }
    if (token.type === "image") {
      parts.push(String(token.text ?? ""));
      return;
    }
    if (token.type === "html") {
      parts.push(String(token.text ?? "").replace(/<[^>]*>/g, " "));
      return;
    }
    if (Array.isArray(token.tokens)) {
      for (const child of token.tokens) visit(child as Record<string, unknown>);
      return;
    }
    if (Array.isArray(token.items)) {
      for (const child of token.items) visit(child as Record<string, unknown>);
      return;
    }
    if (typeof token.text === "string") {
      parts.push(token.text);
    }
  };
  for (const token of tokens) visit(token as unknown as Record<string, unknown>);
  return parts.join("").replace(/\s+/g, " ").trim();
}

type ReadConversation = (id: string) => Promise<
  | { ok: true; conversation: Session }
  | { ok: false; error: { code: string; message: string } }
>;

export class ActivityPreviewLoader {
  private readonly cache = new Map<string, ActivityPreview>();
  private readonly generations = new Map<string, number>();
  private readonly queued = new Map<string, Session>();
  private active = 0;

  constructor(
    private readonly read: ReadConversation,
    private readonly onChange: (id: string, preview: ActivityPreview | null) => void,
    private readonly concurrency = 4
  ) {}

  request(session: Session, retry = false) {
    const cached = this.cache.get(session.id);
    if (cached?.updatedAt === session.updatedAt && !(retry && cached.status === "error")) return;
    if (retry) this.cache.delete(session.id);
    if (this.queued.has(session.id)) {
      this.queued.set(session.id, session);
      return;
    }
    this.queued.set(session.id, session);
    this.cache.set(session.id, { updatedAt: session.updatedAt, status: "loading", text: "" });
    this.onChange(session.id, this.cache.get(session.id)!);
    this.drain();
  }

  invalidate(sessionId: string) {
    this.generations.set(sessionId, (this.generations.get(sessionId) ?? 0) + 1);
    this.queued.delete(sessionId);
    this.cache.delete(sessionId);
    this.onChange(sessionId, null);
  }

  private drain() {
    while (this.active < this.concurrency && this.queued.size) {
      const [id, session] = this.queued.entries().next().value as [string, Session];
      this.queued.delete(id);
      this.active += 1;
      const generation = this.generations.get(id) ?? 0;
      void this.read(id).then((result) => {
        if ((this.generations.get(id) ?? 0) !== generation) return;
        const text = result.ok ? extractActivityPreview(result.conversation.messages ?? []) : "";
        const preview: ActivityPreview = result.ok
          ? { updatedAt: session.updatedAt, status: text ? "ready" : "empty", text }
          : { updatedAt: session.updatedAt, status: "error", text: "" };
        this.cache.set(id, preview);
        this.onChange(id, preview);
      }).catch(() => {
        if ((this.generations.get(id) ?? 0) !== generation) return;
        const preview: ActivityPreview = { updatedAt: session.updatedAt, status: "error", text: "" };
        this.cache.set(id, preview);
        this.onChange(id, preview);
      }).finally(() => {
        this.active -= 1;
        this.drain();
      });
    }
  }
}
