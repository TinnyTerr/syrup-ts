import type { Registry } from "./eval";
import type { Options } from "./options";
import type { TypeAliases } from "./parser";

/** What every statement handler gets to work with. */
export interface Ctx {
	reg: Registry;
	aliases: TypeAliases;
	opts: Options;
}
