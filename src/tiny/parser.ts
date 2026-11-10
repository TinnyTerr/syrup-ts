import type { TinyMachineProgram } from "./ast";

export class TinyMachineParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TinyMachineParseError";
	}
}

export function parseTinyMachine(source: string): TinyMachineProgram {
	const parts = source.trim().split(/\s+/);

	if (parts.length !== 5) {
		throw new TinyMachineParseError(`Expected 5 fields, got ${parts.length}`);
	}

	// @ts-expect-error this is checked previously
	const processedParts: [number, number, number, number, number[]] = parts.map(
		(v) =>
			v.length === 1
				? Number(`0x${v}`)
				: v.split("").map((v) => Number(`0x${v}`)),
	);

	const [ipStr, liStr, frStr, acStr, memoryStr] = processedParts;

	const result: TinyMachineProgram = {
		registers: {
			ip: ipStr,
			li: liStr,
			// flags to bits is [hf, of , zf, cf]
			fr: {
				hf: ((frStr >> 3) & 1) === 1,
				of: ((frStr >> 2) & 1) === 1,
				zf: ((frStr >> 1) & 1) === 1,
				cf: ((frStr >> 0) & 1) === 1,
			},
			ac: acStr,
		},
		memory: memoryStr,
	};

	return result;
}
