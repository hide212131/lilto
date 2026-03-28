type PluginMentionCandidate = {
  id: string;
  name: string;
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compareMentionCandidates(a: PluginMentionCandidate, b: PluginMentionCandidate): number {
  return b.name.length - a.name.length;
}

export function normalizePluginMentionsForPrompt(
  text: string,
  plugins: PluginMentionCandidate[]
): string {
  if (!text.includes("@") || plugins.length === 0) {
    return text;
  }

  let normalized = text;
  const seenPluginIds = new Set<string>();
  const candidates = plugins
    .filter((plugin) => plugin.id.trim() && plugin.name.trim())
    .filter((plugin) => {
      if (seenPluginIds.has(plugin.id)) {
        return false;
      }
      seenPluginIds.add(plugin.id);
      return true;
    })
    .sort(compareMentionCandidates);

  for (const plugin of candidates) {
    const escapedName = escapeRegExp(plugin.name.trim());
    const pattern = new RegExp(
      `(^|[^A-Za-z0-9_@/\\[])(@${escapedName})(?=$|[^A-Za-z0-9_-])`,
      "g"
    );
    normalized = normalized.replace(pattern, (_match, prefix: string, mention: string) => {
      return `${prefix}[${mention}](plugin://${plugin.id})`;
    });
  }

  return normalized;
}