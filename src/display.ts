// `display`: Graphviz output, plus the graphical 7-segment / braille cells.
import type { Ctx } from "./ctx";
import type { Message, TCell } from "./doc";
import type { Display, Ty } from "./ast";
import type { Value } from "./values";

export function runDisplay(_c: Ctx, s: Display): Message[] {
  return [{ level: "internal", doc: "display is not implemented yet" }];
}

/** A graphical table cell for a value of a graphical type (<7Segments>, <Braille>), if it is one. */
export function graphicalCell(_ty: Ty, _value: Value[], _html: boolean): TCell | undefined {
  return undefined;
}
