/**
 * Joins a quoted `${CLAUDE_SKILL_DIR}` or `${CLAUDE_PLUGIN_ROOT}` to the
 * path written after it, as the shell does: `"${CLAUDE_PLUGIN_ROOT}"/a.ts`
 * reads `${CLAUDE_PLUGIN_ROOT}/a.ts`. Lines keep their numbers.
 */
export function unquoteSkillVariables(text: string): string {
  return text.replaceAll(
    /(["'])(\$\{CLAUDE_(?:SKILL_DIR|PLUGIN_ROOT)\})\1(?=\/)/g,
    "$2",
  );
}
