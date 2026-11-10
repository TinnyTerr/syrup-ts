import {
	hasOperand,
	Instructions,
	memoryLocation,
	TinyMachineRuntimeError,
	type TinyMachineProgram,
} from "./ast";
import { parseTinyMachine } from "./parser";

export function run(
	source: string,
	_input: string | string[] | number[],
): string {
	// TODO: add object based output, to better display the output, and to allow for better testing
	const obj = parseTinyMachine(source);
	// @ts-expect-error ts is unable to realise all the elements are made to string
	const inputs: string[] = Array.isArray(_input)
		? typeof _input[0] === "string"
			? _input
			: _input.map((v) => v.toString(16).toUpperCase())
		: [_input];

	const state = obj;
	const lines: string[] = [];
	while (true) {
		// the row shows the state *before* this instruction runs
		const before = structuredClone(state);
		try {
			const operands = machineLoop(state, inputs);
			lines.push(stringifyStep(before, operands));

			if (state.registers.fr.hf) break;
		} catch (e) {
			if (e instanceof TinyMachineRuntimeError) {
				lines.push(stringifyStep(before));
				lines.push(`Runtime Error: ${e.message}`);
				break;
			}
			throw e;
		}
	}

	return lines.join("\n");
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
			break;
		case Instructions.STA:
			m.memory[memoryLocation(opr ?? 0)] = r.ac;
			break;
		case Instructions.GET: {
			const input = inputs.shift();
			if (input === undefined) throw new TinyMachineRuntimeError("Starved of inputs");
			r.ac = Number(`0x${input}`) & 0x0f;
			info.in = r.ac;
			break;
		}
		case Instructions.PUT:
			info.out = r.ac;
			break;
		case Instructions.ROL:
			r.ac = ((r.ac << 1) | (r.ac >> 3)) & 0x0f;
			break;
		case Instructions.ROR:
			r.ac = ((r.ac >> 1) | (r.ac << 3)) & 0x0f;
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
			r.ac = (16 - r.ac) & 0x0f;
			break;
	}

	r.fr.zf = r.ac === 0;
	if (!r.fr.hf) r.ip = nextIp;

	return info;
}

function stringifyStep(
	condition: TinyMachineProgram,
	operands?: StepInfo,
): string {
	return `${condition.registers.ip.toString(16).toUpperCase()} ${condition.registers.li.toString(16).toUpperCase()} ${Number(
		`0b${condition.registers.fr.hf ? 1 : 0}${condition.registers.fr.of ? 1 : 0}${condition.registers.fr.zf ? 1 : 0}${condition.registers.fr.cf ? 1 : 0}`,
	)
		.toString(16)
		.toUpperCase()} ${condition.registers.ac.toString(16).toUpperCase()}  ${condition.memory.map((v) => v.toString(16).toUpperCase()).join("")}  ${Instructions[operands?.code ?? 0]} ${operands?.opr !== undefined ? operands.opr.toString(16).toUpperCase() : "-"} ${operands?.in !== undefined ? operands.in.toString(16).toUpperCase() : "-"} ${operands?.out !== undefined ? operands.out.toString(16).toUpperCase() : "-"}`.trim();
}
