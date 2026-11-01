// GitHub Actions workflow commands, escaped as GitHub documents, so a path or
// message never splits the command or adds a property of its own:
// https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands

/** A problem at one site of a file, line and column counted from 1 when known. */
export interface Annotation {
  file: string;
  line?: number | undefined;
  col?: number | undefined;
  message: string;
}

/** A problem a check finds in one file, before it names the file. */
export type Finding = Omit<Annotation, "file">;

function escapeData(value: string): string {
  return value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

function escapeProperty(value: string): string {
  return escapeData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

/** Leaves out the line or column when it is unknown. */
export function errorAnnotation({
  file,
  line,
  col,
  message,
}: Annotation): string {
  const properties = [
    `file=${escapeProperty(file)}`,
    ...(line === undefined ? [] : [`line=${line}`]),
    ...(col === undefined ? [] : [`col=${col}`]),
  ].join(",");

  return `::error ${properties}::${escapeData(message)}`;
}

/** The 1-based line that holds the character at this index. */
export function lineAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}
