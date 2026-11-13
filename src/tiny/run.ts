import {
	hasOperand,
	Instructions,
	memoryLocation,
	type TinyMachineProgram,
	TinyMachineRuntimeError,
} from "./ast";
import { parseTinyMachine } from "./parser";

/** Run the machine and return one object per trace row. */
export function runSteps(
	source: string,
	_input: string | string[] | number[],
): TinyMachineProgram[] {
	const obj = parseTinyMachine(source);
	// @ts-expect-error ts is unable to realise all the elements are made to string
	const inputs: string[] = Array.isArray(_input)
		? typeof _input[0] === "string"
			? _input
			: _input.map((v) => v.toString(16).toUpperCase())
		: [_input];

	const state = obj;
	const rows: TinyMachineProgram[] = [];
	// The machine is deterministic and finite, so seeing the exact same state
	// again with the same inputs left means it will repeat forever. A GET inside
	// the loop eats an input, so that state never repeats (it either escapes or
	// starves, which is a runtime error anyway).
	const seen = new Set<string>();
	while (true) {
		const key = `${inputs.length}|${JSON.stringify(state)}`;
		if (seen.has(key)) {
			rows.push({
				...structuredClone(state),
				error: "Infinite loop detected",
			});
			break;
		}
		seen.add(key);
		// the row shows the state *before* this instruction runs
		const before = structuredClone(state);
		try {
			const info = machineLoop(state, inputs);
			rows.push({
				...before,
				opr: { opera: info.code, oper: info.opr, in: info.in, out: info.out },
			});

			if (state.registers.fr.hf) {
				// final row: the halted machine, with ip stepped past the HLT
				rows.push({
					registers: {
						...state.registers,
						ip: memoryLocation(state.registers.ip + 1),
						fr: { ...state.registers.fr },
					},
					memory: [...state.memory],
				});
				break;
			}
		} catch (e) {
			if (e instanceof TinyMachineRuntimeError) {
				rows.push({ ...before, error: e.message });
				break;
			}
			throw e;
		}
	}

	return rows;
}

export function run(
	source: string,
	input: string | string[] | number[],
): string;
export function run(
	source: string,
	input: string | string[] | number[],
	options: { string: false },
): TinyMachineProgram[];
export function run(
	source: string,
	input: string | string[] | number[],
	options: { string: boolean } = { string: true },
): string | TinyMachineProgram[] {
	const rows = runSteps(source, input);
	if (!options.string) return rows;
	return rows.flatMap(stringifyStep).join("\n");
}

type StepInfo = { code: Instructions; opr?: number; in?: number; out?: number };

/**
 * Runs one fetch-execute cycle, mutating `m`, and returns what the executed
 * instruction looked like (opcode, operand, input read, output written).
 *
 * The trace row for a step is printed from the state *before* this runs, so
 * effects (e.g. STA changing memory) show up on the next row.
 */
function machineLoop(m: TinyMachineProgram, inputs: string[]): StepInfo {
	const r = m.registers;
	const ip = memoryLocation(r.ip);
	const code = (m.memory[ip] ?? 0) as Instructions;
	const opr = hasOperand(code)
		? (m.memory[memoryLocation(ip + 1)] ?? 0)
		: undefined;
	const info: StepInfo = { code, opr };

	let nextIp = memoryLocation(ip + (opr === undefined ? 1 : 2));
	const mem = (a: number) => m.memory[memoryLocation(a)] ?? 0;

	switch (code) {
		case Instructions.HLT:
			r.fr.hf = true;
			break;
		case Instructions.JMP:
			nextIp = memoryLocation(opr ?? 0);
			break;
		case Instructions.JZE:
			if (r.fr.zf) nextIp = memoryLocation(opr ?? 0);
			break;
		case Instructions.JNZ:
			if (!r.fr.zf) nextIp = memoryLocation(opr ?? 0);
			break;
		case Instructions.LDA:
			r.ac = mem(opr ?? 0);
			r.fr.zf = r.ac === 0;
			break;
		case Instructions.STA:
			m.memory[memoryLocation(opr ?? 0)] = r.ac;
			break;
		case Instructions.GET: {
			const input = inputs.shift();
			if (input === undefined)
				throw new TinyMachineRuntimeError("Starved of inputs");
			r.ac = Number(`0x${input}`) & 0x0f;
			r.fr.zf = r.ac === 0;
			info.in = r.ac;
			break;
		}
		case Instructions.PUT:
			info.out = r.ac;
			break;
		case Instructions.ROL:
			r.ac = ((r.ac << 1) | (r.ac >> 3)) & 0x0f;
			r.fr.zf = r.ac === 0;
			break;
		case Instructions.ROR:
			r.ac = ((r.ac >> 1) | (r.ac << 3)) & 0x0f;
			r.fr.zf = r.ac === 0;
			break;
		case Instructions.ADC: {
			const a = r.ac;
			const b = mem(opr ?? 0);
			const sum = a + b + (r.fr.cf ? 1 : 0);
			const res = sum & 0x0f;
			r.fr.cf = sum > 0x0f;
			// signed overflow: operands share a sign the result doesn't
			r.fr.of = ((a ^ res) & (b ^ res) & 0x08) !== 0;
			r.ac = res;
			r.fr.zf = r.ac === 0;
			break;
		}
		case Instructions.CCF:
			r.fr.cf = false;
			break;
		case Instructions.SCF:
			r.fr.cf = true;
			break;
		case Instructions.DEL:
			r.li = (r.li - 1) & 0x0f;
			break;
		case Instructions.LDL:
			r.li = opr ?? 0;
			break;
		case Instructions.FLA:
			r.ac = (15 - r.ac) & 0x0f;
			r.fr.zf = r.ac === 0;
			break;
	}

	if (!r.fr.hf) r.ip = nextIp;

	return info;
}

function stringifyStep(row: TinyMachineProgram): string[] {
	const { registers: r, memory, opr, error } = row;
	const fr = Number(
		`0b${r.fr.hf ? 1 : 0}${r.fr.of ? 1 : 0}${r.fr.zf ? 1 : 0}${r.fr.cf ? 1 : 0}`,
	);
	const hex = (n: number | undefined) =>
		n === undefined ? "-" : n.toString(16).toUpperCase();
	let line = `${hex(r.ip)} ${hex(r.li)} ${hex(fr)} ${hex(r.ac)}  ${memory.map(hex).join("")}`;
	if (opr) {
		line += `  ${Instructions[opr.opera]} ${hex(opr.oper)} ${hex(opr.in)} ${hex(opr.out)}`;
	}
	// an errored row is the state with no instruction, then the error line
	return error ? [line, `Runtime Error: ${error}`] : [line];
}
