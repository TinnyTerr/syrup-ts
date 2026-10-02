export type Format =
  | "plain" // the CLI's default, compact plaintext
  | "syrup" // upstream's plaintext (ascii-bordered tables, grouped notices)
  | "html"; // the markup the original playground page uses

export interface Options {
  format: Format;
  /** hide "is defined" notices */
  quiet: boolean;
  /** with html output, print Graphviz source for `display` instead of rendering it */
  sourceDot: boolean;
}

export const defaultOptions: Options = { format: "plain", quiet: false, sourceDot: false };

/** Parse upstream-style flags (`--html`, `-q`, `--source-dot`, `--format X`). */
export function parseOptions(base: Options, flags: string[]): Options | string {
  const o = { ...base };
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i]!;
    if (f === "--html") o.format = "html";
    else if (f === "--plain") o.format = "plain";
    else if (f === "--syrup" || f === "--text") o.format = "syrup";
    else if (f === "-q" || f === "--quiet") o.quiet = true;
    else if (f === "--source-dot") o.sourceDot = true;
    else if (f === "--format" || f.startsWith("--format=")) {
      const v = f.includes("=") ? f.slice(f.indexOf("=") + 1) : flags[++i];
      if (v !== "plain" && v !== "syrup" && v !== "html") return `unknown format '${v}' (plain, syrup, html)`;
      o.format = v;
    } else return `unknown option '${f}'`;
  }
  return o;
}
