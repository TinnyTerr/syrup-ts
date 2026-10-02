import type { Registry } from "./eval";
import type { TypeAliases } from "./parser";
import type { Options } from "./options";

/** What every statement handler gets to work with. */
export interface Ctx {
  reg: Registry;
  aliases: TypeAliases;
  opts: Options;
}
