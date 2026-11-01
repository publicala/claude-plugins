/** A quoted string literal in code, its offsets including the quotes. */
export interface StringLiteral {
  start: number;
  end: number;
  value: string;
}

/**
 * Reads TypeScript the way the tokenizer does, as far as a path check
 * needs: comments, quoted strings and template literals with their `${}`
 * code. Returns the source with comments and the contents of quoted
 * strings blanked to spaces (every offset and line stays where it was),
 * and every quoted string found in code. A template's text stays as is.
 */
export function readTypeScript(source: string): {
  masked: string;
  strings: StringLiteral[];
} {
  const masked = source.split("");
  const strings: StringLiteral[] = [];
  // Each open template's brace depth when its `${` opened, innermost last.
  const templates: number[] = [];
  let depth = 0;
  let inTemplateText = false;
  let index = 0;

  const blank = (from: number, to: number): void => {
    for (let at = from; at < to; at++) {
      if (masked[at] !== "\n") {
        masked[at] = " ";
      }
    }
  };

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (inTemplateText) {
      if (char === "\\") {
        index += 2;
      } else if (char === "`") {
        inTemplateText = false;
        index++;
      } else if (char === "$" && next === "{") {
        templates.push(depth);
        depth++;
        inTemplateText = false;
        index += 2;
      } else {
        index++;
      }
    } else if (char === "/" && next === "/") {
      const end = source.indexOf("\n", index);
      const stop = end === -1 ? source.length : end;
      blank(index, stop);
      index = stop;
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(index, stop);
      index = stop;
    } else if (char === '"' || char === "'") {
      let end = index + 1;

      while (
        end < source.length &&
        source[end] !== char &&
        source[end] !== "\n"
      ) {
        end += source[end] === "\\" ? 2 : 1;
      }

      strings.push({
        start: index,
        end: end + 1,
        value: source.slice(index + 1, end),
      });
      blank(index + 1, end);
      index = end + 1;
    } else if (char === "`") {
      inTemplateText = true;
      index++;
    } else {
      if (char === "{") {
        depth++;
      } else if (char === "}") {
        depth--;

        if (templates.at(-1) === depth) {
          templates.pop();
          inTemplateText = true;
        }
      }

      index++;
    }
  }

  return { masked: masked.join(""), strings };
}
