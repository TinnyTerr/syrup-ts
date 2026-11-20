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

export type RunOptions = {
	/** stringify the trace (default true) */
	string?: boolean;
	/** print register/memory values unchanged from the previous row as `.` */
	dots?: boolean;
};

export function run(
	source: string,
	input: string | string[] | number[],
	options?: RunOptions & { string?: true },
): string;
export function run(
	source: string,
	input: string | string[] | number[],
	options: RunOptions & { string: false },
): TinyMachineProgram[];
export function run(
	source: string,
	input: string | string[] | number[],
	{ string = true, dots = false }: RunOptions = {},
): string | TinyMachineProgram[] {
	const rows = runSteps(source, input);
	if (!string) return rows;
	return rows
		.flatMap((row, i) => stringifyStep(row, dots ? rows[i - 1] : undefined))
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
		{
			const a = r.ac;
			r.ac = ((a << 1) | (r.fr.cf ? 1 : 0)) & 0x0f;
			r.fr.cf = (a & 0x08) !== 0;
			// sign bit changed
			r.fr.of = ((a ^ r.ac) & 0x08) !== 0;
			r.fr.zf = r.ac === 0;
		}
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
		{
			const a = r.ac;
			r.ac = (a >> 1) | (r.fr.cf ? 0x08 : 0);
			r.fr.cf = (a & 0x01) !== 0;
			// sign bit changed
			r.fr.of = ((a ^ r.ac) & 0x08) !== 0;
			r.fr.zf = r.ac === 0;
		}
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
			r.fr.zf = r.li === 0;
			break;
		// Load loop index from address
		case Instructions.LDL:
			r.li = mem(opr ?? 0);
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

const hex = (n: number | undefined) =>
	n === undefined ? "-" : n.toString(16).toUpperCase();

const flagsOf = ({ registers: { fr } }: TinyMachineProgram) =>
	(fr.hf ? 8 : 0) | (fr.of ? 4 : 0) | (fr.zf ? 2 : 0) | (fr.cf ? 1 : 0);

/**
 * @param row State of the machine
 * @param prev Previous row; when given, registers and memory cells that are
 * unchanged from it print as `.`. The instruction columns are never dotted.
 */
function stringifyStep(
	row: TinyMachineProgram,
	prev?: TinyMachineProgram,
): string[] {
	const { registers: r, memory, opr, error } = row;
	const cell = (cur: number, old: number | undefined) =>
		prev && cur === old ? "." : hex(cur);

	let line = [
		cell(r.ip, prev?.registers.ip),
		cell(r.li, prev?.registers.li),
		cell(flagsOf(row), prev && flagsOf(prev)),
		cell(r.ac, prev?.registers.ac),
	].join(" ");
	line += `  ${memory.map((v, i) => cell(v, prev?.memory[i])).join("")}`;
	if (opr) {
		line += `  ${Instructions[opr.opera]} ${hex(opr.oper)} ${hex(opr.in)} ${hex(opr.out)}`;
	}
	// an errored row is the state with no instruction, then the error line
	return error ? [line, `Runtime Error: ${error}`] : [line];
}
