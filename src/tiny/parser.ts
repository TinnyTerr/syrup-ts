import {
	Instructions,
	TinyMachineParseError,
	type TinyMachineProgram,
} from "./ast";

export function parseTinyMachine(source: string): TinyMachineProgram {
	const parts = source
		.trim()
		.split(/\s+/)
		.map((v) => v.toUpperCase().trim())
		.filter((v) => v.length > 0);

	if (parts.length !== 5 && parts.length !== 9) {
		throw new TinyMachineParseError(
			`Expected 5 or 9 fields, got ${parts.length}`,
		);
	}

	const hex = (v: string) => Number(`0x${v}`);
	const optHex = (v: string | undefined) =>
		v === undefined || v === "-" ? undefined : hex(v);

	const [ipStr, liStr, frStr, acStr, memoryStr, opera, oper, inp, out] =
		parts as [string, string, string, string, string, string, string, string, string];
	const fr = hex(frStr);

	let opr: TinyMachineProgram["opr"];
	if (parts.length === 9) {
		const code = Instructions[opera as keyof typeof Instructions];
		if (code === undefined) {
			throw new TinyMachineParseError(`Unknown instruction ${opera}`);
		}
		opr = { opera: code, oper: optHex(oper), in: optHex(inp), out: optHex(out) };
	}

	const result: TinyMachineProgram = {
		registers: {
			ip: hex(ipStr),
			li: hex(liStr),
			// flags to bits is [hf, of , zf, cf]
			fr: {
				hf: ((fr >> 3) & 1) === 1,
				of: ((fr >> 2) & 1) === 1,
				zf: ((fr >> 1) & 1) === 1,
				cf: ((fr >> 0) & 1) === 1,
			},
			ac: hex(acStr),
		},
		memory: memoryStr.split("").map(hex),
		opr,
	};

	return result;
}
