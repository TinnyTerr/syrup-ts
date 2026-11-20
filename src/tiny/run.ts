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

type RunInput = string | string[] | number[];

export function run(source: string, input: RunInput): string;
export function run(
	source: string,
	input: RunInput,
	opts: { string: true; dots?: boolean },
): string;
export function run(
	source: string,
	input: RunInput,
	opts: { string: false; dots: true },
): never;
export function run(
	source: string,
	input: RunInput,
	opts: { string: false; dots?: false },
): TinyMachineProgram[];
export function run(
	source: string,
	input: RunInput,
	opts?: { string?: boolean; dots?: boolean },
): string | TinyMachineProgram[];
export function run(
	source: string,
	input: RunInput,
	opts: { string?: boolean; dots?: boolean } = {},
): string | TinyMachineProgram[] {
	const rows = runSteps(source, input);
	if (opts.string === false) return rows;
	return rows
		.flatMap((v, i, arr) => stringifyStep(v, opts.dots ?? false, arr[i - 1]))
		.join("\n");
}

type StepInfo = { code: Instructions; opr?: number; in?: number; out?: number };

/**
 * Runs one fetch-execute cycle, mutating `m`, and returns what the executed
 * instruction looked like (opcode, operand, input read, output written).
 *
 * The trace row for a step is printed from the state *before* this runs, so
 * effects (e.g. STA changing memory) show up on the next row.
 *
 * Extract:
 * OF is set whenever an arithmetic operation (ROL, ROR, or ADC),
 * leaves a misleading AC, under a two’s complement interpretation—exactly
 * if the carry into the sign bit differs from the carry out.
 * E.g., if CF = 0, AC = 8, then the two’s complement meaning of AC is −8:
 * if we then execute ROR, we get AC = 4; CF = 0; OF = 1"
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
		// Halt
		case Instructions.HLT:
			r.fr.hf = true;
			break;
		// Jump to address
		case Instructions.JMP:
			nextIp = memoryLocation(opr ?? 0);
			break;
		// Jump if zero
		case Instructions.JZE:
			if (r.fr.zf) nextIp = memoryLocation(opr ?? 0);
			break;
		// Jump if not zero
		case Instructions.JNZ:
			if (!r.fr.zf) nextIp = memoryLocation(opr ?? 0);
			break;
		// Load accumulator from address
		case Instructions.LDA:
			r.ac = mem(opr ?? 0);
			r.fr.zf = r.ac === 0;
			break;
		// Store accumulator to address
		case Instructions.STA:
			m.memory[memoryLocation(opr ?? 0)] = r.ac;
			break;
		// Get input into accumulator
		case Instructions.GET: {
			const input = inputs.shift();
			if (input === undefined)
				throw new TinyMachineRuntimeError("Starved of inputs");
			r.ac = Number(`0x${input}`) & 0x0f;
			r.fr.zf = r.ac === 0;
			info.in = r.ac;
			break;
		}
		// Put accumulator to output
		case Instructions.PUT:
			info.out = r.ac;
			break;
		// Rotate left
		/**
		 * Double and carry-in
		 * Operation:
		 * ```
		 * CF|AC = AC|CF
		 * ZF = (AC == 0)
		 * OF = (AC[3] XOR AC[2])
		 * ```
		 */
		case Instructions.ROL:
			r.ac = ((r.ac << 1) | (r.ac >> 3)) & 0x0f;
			r.fr.of = !!(((r.ac & 0x08) >> 3) ^ ((r.ac & 0x04) >> 2));
			r.fr.zf = r.ac === 0;
			break;
		// Rotate right
		/**
		 * Halve and carry-out
		 * Operation:
		 * ```
		 * AC|CF = CF|AC
		 * ZF = (AC == 0)
		 * OF = (AC[3] XOR AC[2])
		 * ```
		 */
		case Instructions.ROR:
			r.ac = ((r.ac >> 1) | (r.ac << 3)) & 0x0f;
			r.fr.zf = r.ac === 0;
			break;
		// Add with carry
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
		// Clear carry flag
		case Instructions.CCF:
			r.fr.cf = false;
			break;
		// Set carry flag
		case Instructions.SCF:
			r.fr.cf = true;
			break;
		// Decrement loop index
		case Instructions.DEL:
			r.li = (r.li - 1) & 0x0f;
			break;
		// Load loop index
		case Instructions.LDL:
			r.li = opr ?? 0;
			break;
		// Flip accumulator
		case Instructions.FLA:
			r.ac = (15 - r.ac) & 0x0f;
			r.fr.zf = r.ac === 0;
			break;
	}

	if (!r.fr.hf) r.ip = nextIp;

	return info;
}

function stringifyStep(row: TinyMachineProgram): string[];
/**
 *
 * @param row State of the machine
 * @param dots Allows the machine to stringify values that don't change as dots, instead of their current values
 * @param pvSt Previous state of the machine to allow dots to be shown
 */
function stringifyStep(
	row: TinyMachineProgram,
	dots: boolean,
	pvSt?: TinyMachineProgram,
): string[];
function stringifyStep(
	row: TinyMachineProgram,
	dots: boolean = false,
	pvSt?: TinyMachineProgram,
): string[] {
	const { registers: r, memory, opr, error } = row;
	const fr = Number(
		`0b${r.fr.hf ? 1 : 0}${r.fr.of ? 1 : 0}${r.fr.zf ? 1 : 0}${r.fr.cf ? 1 : 0}`,
	);
	const hex = (n: number | undefined) =>
		n === undefined ? "-" : n.toString(16).toUpperCase();
	let line = `${dot(hex(r.ip), dots, Number(pvSt?.registers?.ip).toString(16).toUpperCase())} ${dot(hex(r.li), dots, Number(pvSt?.registers?.li).toString(16).toUpperCase())} ${dot(
		hex(fr),
		dots,
		Number(
			`0b${pvSt?.registers?.fr.hf ? 1 : 0}${pvSt?.registers?.fr.of ? 1 : 0}${pvSt?.registers?.fr.zf ? 1 : 0}${pvSt?.registers?.fr.cf ? 1 : 0}`,
		)
			.toString(16)
			.toUpperCase(),
	)} ${dot(hex(r.ac), dots, Number(pvSt?.registers?.ac).toString(16).toUpperCase())}  ${memory.map((v, i) => dot(hex(v), dots, Number(pvSt?.memory?.[i]).toString(16).toUpperCase())).join("")}`;
	if (opr) {
		line += `  ${Instructions[opr.opera]} ${dot(hex(opr.oper), dots, Number(pvSt?.opr?.oper).toString(16).toUpperCase())} ${dot(hex(opr.in), dots, Number(pvSt?.opr?.in).toString(16).toUpperCase())} ${dot(hex(opr.out), dots, Number(pvSt?.opr?.out).toString(16).toUpperCase())}`;
	}
	// an errored row is the state with no instruction, then the error line
	return error ? [line, `Runtime Error: ${error}`] : [line];
}

function dot(current: string, dots: boolean, previous?: string): string {
	// previous defaults to unreachable value
	return dots
		? current === (previous ?? "ewfwfwefwfwfwe")
			? "."
			: current
		: current;
}
