/**
 * Extract @mention display names from comment content.
 * Matches "@John Smith" or "@john_doe" patterns.
 */
export function extractMentions(content: string): string[] {
  const matches = content.match(/@([\w\s.]+?)(?=\s|$|[,!?.])/g) ?? [];
  return matches.map((m) => m.slice(1).trim());
}
