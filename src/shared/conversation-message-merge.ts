type ConversationMessage = {
  id: string;
  role: string;
  text: string;
  createdAt: number;
  progress?: unknown;
  requestId?: string;
};

export function mergeSessionMessages<T extends ConversationMessage>(hydratedMessages: T[], localMessages: T[]): T[] {
  const matchedIndexes = new Set<number>();
  const hydratedOverrides = new Map<number, T>();
  const localSignatures = new Set<string>();
  const insertions = new Map<number, T[]>();
  let nextIndex = hydratedMessages.length;

  // The backend array is already in turn/item order. Timestamps can be missing
  // (and fall back to the thread's creation time), and IDs are not sort keys.
  // Walk backwards to place local-only messages before their next known message.
  for (const message of [...localMessages].reverse()) {
    let index = hydratedMessages.findIndex((hydrated) => hydrated.id === message.id);
    if (index === -1) {
      // Match from the same end as the local walk, so repeated text anchors to
      // the corresponding occurrence rather than moving intervening notices.
      for (let candidateIndex = hydratedMessages.length - 1; candidateIndex >= 0; candidateIndex -= 1) {
        const hydrated = hydratedMessages[candidateIndex];
        if (!matchedIndexes.has(candidateIndex)
          && hydrated.role === message.role
          && hydrated.text === message.text) {
          index = candidateIndex;
          break;
        }
      }
    }
    if (index !== -1) {
      matchedIndexes.add(index);
      if (message.progress) {
        const hydrated = hydratedOverrides.get(index) ?? hydratedMessages[index];
        hydratedOverrides.set(index, {
          ...hydrated,
          progress: message.progress,
          requestId: message.requestId ?? hydrated.requestId
        });
      }
      // Even an already misordered local cache must not reorder backend history.
      nextIndex = Math.min(nextIndex, index);
      continue;
    }

    const signature = JSON.stringify([message.role, message.text, message.createdAt]);
    if (!localSignatures.has(signature)) {
      localSignatures.add(signature);
      const messages = insertions.get(nextIndex) ?? [];
      messages.push(message);
      insertions.set(nextIndex, messages);
    }
  }

  const merged: T[] = [];
  for (let index = 0; index <= hydratedMessages.length; index += 1) {
    merged.push(...(insertions.get(index) ?? []).reverse());
    if (index < hydratedMessages.length) {
      merged.push(hydratedOverrides.get(index) ?? hydratedMessages[index]);
    }
  }
  return merged;
}
