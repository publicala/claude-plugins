// The quality rules a figure must pass before the renderer writes it. They
// judge a measurement of the rendered page (measure.ts), so each rule runs
// and tests without a browser.

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface MeasuredElement {
  parent: number;
  classes: string[];
  tag: string;
  text: string;
  box: Box;
  scrollWidth: number;
  clientWidth: number;
  fontSize: number;
  lineHeight: number;
}

export interface MeasuredText {
  element: number;
  text: string;
  uppercase: boolean;
  quoted: boolean;
}

/** Element 0 is the canvas. Every other element sits inside it. */
export interface Measurement {
  failedFonts: string[];
  overflow: { x: number; y: number };
  elements: MeasuredElement[];
  texts: MeasuredText[];
}

const MAX_NODES = 25;

const BOXED = ["node", "label", "tag", "spec", "gutter"];
const SOLID = ["node", "layer", "label", "tag", "callout", "spec", "stat"];

export function findFigureProblems(measurement: Measurement): string[] {
  const figure = new Figure(measurement);

  return [
    ...fontProblems(measurement),
    ...overflowProblems(figure),
    ...nodeProblems(figure),
    ...wireProblems(figure),
    ...splitProblems(figure),
    ...overlapProblems(figure),
    ...textProblems(figure),
  ];
}

class Figure {
  readonly elements: MeasuredElement[];
  readonly texts: MeasuredText[];
  readonly overflow: { x: number; y: number };

  constructor(measurement: Measurement) {
    this.elements = measurement.elements;
    this.texts = measurement.texts;
    this.overflow = measurement.overflow;
  }

  get canvas(): MeasuredElement {
    return this.at(0);
  }

  at(index: number): MeasuredElement {
    const element = this.elements[index];

    if (element === undefined) {
      throw new Error(`The measurement has no element ${index}.`);
    }

    return element;
  }

  indexesWith(className: string): number[] {
    return this.elements.flatMap((element, index) =>
      element.classes.includes(className) ? [index] : [],
    );
  }

  isInside(index: number, ancestor: number): boolean {
    for (
      let parent = this.at(index).parent;
      parent !== -1;
      parent = this.at(parent).parent
    ) {
      if (parent === ancestor) {
        return true;
      }
    }

    return false;
  }

  isWithin(index: number, className: string): boolean {
    for (
      let parent = this.at(index).parent;
      parent !== -1;
      parent = this.at(parent).parent
    ) {
      if (this.at(parent).classes.includes(className)) {
        return true;
      }
    }

    return false;
  }

  describe(index: number): string {
    const element = this.at(index);

    return `"${(element.text || element.classes.join(" ")).slice(0, 48)}"`;
  }
}

const width = (box: Box) => box.right - box.left;
const height = (box: Box) => box.bottom - box.top;

function fontProblems({ failedFonts }: Measurement): string[] {
  return failedFonts.length > 0
    ? [`Fonts failed to load: ${failedFonts.join(", ")}.`]
    : [];
}

function overflowProblems(figure: Figure): string[] {
  const problems: string[] = [];
  const { x, y } = figure.overflow;

  if (x > 0 || y > 0) {
    problems.push(
      `The content runs past the canvas by ${Math.max(x, 0)}px across and ${Math.max(y, 0)}px down. Shorten it or pick a larger data-size.`,
    );
  }

  const bounds = figure.canvas.box;

  figure.elements.forEach(({ box }, index) => {
    if (index === 0 || (width(box) === 0 && height(box) === 0)) {
      return;
    }

    const outside =
      box.left < bounds.left - 0.5 ||
      box.top < bounds.top - 0.5 ||
      box.right > bounds.right + 0.5 ||
      box.bottom > bounds.bottom + 0.5;

    if (outside) {
      problems.push(`${figure.describe(index)} sits outside the canvas.`);
    }
  });

  figure.elements.forEach((element, index) => {
    const boxed =
      BOXED.some((className) => element.classes.includes(className)) ||
      (["td", "th"].includes(element.tag) && figure.isWithin(index, "sheet"));

    if (boxed && element.scrollWidth > element.clientWidth + 1) {
      problems.push(`${figure.describe(index)} overflows its box.`);
    }
  });

  return problems;
}

function nodeProblems(figure: Figure): string[] {
  const problems: string[] = [];
  const nodes = figure.indexesWith("node");

  for (const index of figure.indexesWith("h")) {
    const title = figure.at(index);

    if (
      figure.isWithin(index, "node") &&
      height(title.box) > title.fontSize * 2
    ) {
      problems.push(
        `The node title ${figure.describe(index)} wraps to a second line.`,
      );
    }
  }

  for (const index of figure.indexesWith("d")) {
    const description = figure.at(index);
    const lines = Math.round(height(description.box) / description.lineHeight);

    if (figure.isWithin(index, "node") && lines > 2) {
      problems.push(
        `The node description ${figure.describe(index)} takes ${lines} lines. Keep it to two.`,
      );
    }
  }

  const accents = nodes.filter((index) =>
    figure.at(index).classes.includes("accent"),
  );

  if (accents.length > 1) {
    problems.push(
      `${accents.length} nodes are accented (${accents.map((index) => figure.describe(index)).join(", ")}). Accent one node at most.`,
    );
  }

  if (nodes.length > MAX_NODES) {
    problems.push(
      `The figure has ${nodes.length} nodes. Keep it to ${MAX_NODES} at most, or make two figures.`,
    );
  }

  return problems;
}

function wireProblems(figure: Figure): string[] {
  const labels = figure.indexesWith("label");
  const wires = [...figure.indexesWith("wire"), ...figure.indexesWith("hwire")];

  return wires
    .filter((wire) => !labels.some((label) => figure.isInside(label, wire)))
    .map(() => "A wire has no label. Say what crosses it, for example HTTPS.");
}

function splitProblems(figure: Figure): string[] {
  return figure.indexesWith("split").flatMap((split) => {
    const bottoms = figure.elements
      .flatMap((element, column) => (element.parent === split ? [column] : []))
      .map((column) =>
        figure.elements.reduce<number | null>(
          (bottom, element, index) =>
            element.classes.includes("layer") &&
            (index === column || figure.isInside(index, column))
              ? Math.max(bottom ?? -Infinity, element.box.bottom)
              : bottom,
          null,
        ),
      )
      .filter((bottom) => bottom !== null);

    const spread =
      bottoms.length > 1 ? Math.max(...bottoms) - Math.min(...bottoms) : 0;

    return spread > 1
      ? [
          `The columns of a split end ${Math.round(spread)}px apart. Add grow to the last layer of the shorter column, or move a node between columns.`,
        ]
      : [];
  });
}

function overlapProblems(figure: Figure): string[] {
  const solids = figure.elements.flatMap((element, index) =>
    SOLID.some((className) => element.classes.includes(className))
      ? [index]
      : [],
  );
  const problems: string[] = [];

  solids.forEach((first, position) => {
    for (const second of solids.slice(position + 1)) {
      if (figure.isInside(second, first) || figure.isInside(first, second)) {
        continue;
      }

      const a = figure.at(first).box;
      const b = figure.at(second).box;
      const across = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const down = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);

      if (across > 1 && down > 1) {
        problems.push(
          `${figure.describe(first)} overlaps ${figure.describe(second)}.`,
        );
      }
    }
  });

  return problems;
}

function textProblems(figure: Figure): string[] {
  return figure.texts.flatMap(({ element, text, uppercase, quoted }) => {
    const where = figure.describe(element);
    const problems: string[] = [];

    if (/publica\.la/i.test(text) && uppercase) {
      problems.push(
        `"publica.la" renders in uppercase in ${where}. Wrap it in <span class="verbatim">.`,
      );
    }

    if (quoted) {
      return problems;
    }

    if (text.includes("—")) {
      problems.push(
        `${where} has an em dash. Use parentheses or split the sentence.`,
      );
    }

    if (text.includes(";")) {
      problems.push(`${where} has a semicolon. Split it into two sentences.`);
    }

    if (/[‘’“”]/.test(text)) {
      problems.push(`${where} has a curly quote. Use straight quotes.`);
    }

    return problems;
  });
}
