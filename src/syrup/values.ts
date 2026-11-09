import { type Ty, tyWidth } from "./ast";

// A signal is 0, 1, or 'X' for "unknown" (undriven, or a conflicting
// set/reset). A Value is either a single signal or, for a cable, a
// (possibly nested) array of Values whose shape mirrors the cable's type.
export type Bit = 0 | 1 | "X";
export type Value = Bit | Value[];

export function reshape(flat: Bit[], ty: Ty): { value: Value; rest: Bit[] } {
  if (ty.k === "bit") {
    if (flat.length === 0) throw new Error("ran out of bits while reshaping");
    return { value: flat[0]!, rest: flat.slice(1) };
  }
  let rest = flat;
  const items: Value[] = [];
  for (const t of ty.items) {
    const r = reshape(rest, t);
    items.push(r.value);
    rest = r.rest;
  }
  return { value: items, rest };
}

export function reshapeList(flat: Bit[], tys: Ty[]): Value[] {
  let rest = flat;
  const out: Value[] = [];
  for (const t of tys) {
    const r = reshape(rest, t);
    out.push(r.value);
    rest = r.rest;
  }
  return out;
}

export function flattenValue(v: Value): Bit[] {
  return Array.isArray(v) ? v.flatMap(flattenValue) : [v];
}

export function flattenValues(vs: Value[]): Bit[] {
  return vs.flatMap(flattenValue);
}

// All 2^width bit combinations, in ascending numeric order.
export function* allBitCombos(width: number): Generator<Bit[]> {
  const total = 1 << width;
  for (let n = 0; n < total; n++) {
    const bits: Bit[] = [];
    for (let i = width - 1; i >= 0; i--) bits.push(((n >> i) & 1) as Bit);
    yield bits;
  }
}

export function formatValue(v: Value): string {
  if (Array.isArray(v)) return "[" + v.map(formatValue).join("") + "]";
  return String(v);
}

export function formatValues(vs: Value[]): string {
  return vs.map(formatValue).join("");
}

export function widthOfTys(tys: Ty[]): number {
  return tys.reduce((n, t) => n + tyWidth(t), 0);
}
