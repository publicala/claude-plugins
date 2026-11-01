// GitHub Actions workflow commands, escaped as GitHub documents, so a path or
// message never splits the command or adds a property of its own:
// https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands

export interface Annotation {
  file: string;
  line: number;
  col: number;
  message: string;
}

function escapeData(value: string): string {
  return value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

function escapeProperty(value: string): string {
  return escapeData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

export function errorAnnotation({
  file,
  line,
  col,
  message,
}: Annotation): string {
  return `::error file=${escapeProperty(file)},line=${line},col=${col}::${escapeData(message)}`;
}
