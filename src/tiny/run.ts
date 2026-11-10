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

	let previousCondition: TinyMachineProgram = obj;
	let output = "";
	while (true) {
		try {
			const { condition, operands } = machineLoop(obj, inputs);

			console.log("previousCondition", previousCondition, operands);

			output += `${stringifyStep(previousCondition, operands)}\n`;

			if (condition.registers.fr.hf) {
				break;
			}

			previousCondition = condition;

			hasOperand(operands.code)
				? condition.registers.ip++ && condition.registers.ip++
				: condition.registers.ip++;
		} catch (e) {
			if (e instanceof TinyMachineRuntimeError) {
				output += `Runtime Error: ${e.message}\n`;
				break;
			} else {
				throw e;
			}
		}
	}

	return output;
}

/**
 * This function completes a fetch-execute cycle of the Tiny Machine, and returns the new state of the machine.
 * When editing as the string representation, the path is:
 * - Either start with the initial state of the machine, or increase the instruction pointer
 * - Read instruction pointer
 * - Execute the instruction
 * - Return the CURRENT state of the machine
 * - The state of the machine is then observed as being changed on the NEXT step, for example
 * ```
 * 0 0 0 5  0000000000000000  STA 0 - - // pretend theres a STA instruction at 0, and the
 * 1 8 0 5  5000000000000000  HLT - - - // accumulator is this shows that STA modifies the
 *                                      // memory, but it is only visible on the next step,
 *                                      // when the instruction pointer is incremented to 1,
 *                                      // and the HLT instruction is executed
 *                                      // it is 1805, 8 represents the halt flag from HLT
 * ```
 *
 * This function takes in the flags of the previous step,
 * outputs the OPR & ? ! of the current step,
 * and shows the state of the machine of the current step.
 *
 * @param condition The previous state of the machine
 * @param inputs The inputs to the machine
 * @returns The new state of the machine
 */

function machineLoop(
	condition: TinyMachineProgram,
	inputs: string[],
): {
	condition: TinyMachineProgram;
	operands: { code: Instructions; opr?: number; in?: number; out?: number };
} {
	const instruction =
		condition.memory[memoryLocation(condition.registers.ip)] ?? 0;
	const operand = hasOperand(instruction)
		? condition.memory[memoryLocation(condition.registers.ip + 1)]
		: undefined;

	// @ts-expect-error this is fixed later
	const ret: {
		condition: TinyMachineProgram;
		operands: { code: Instructions; opr?: number; in?: number; out?: number };
	} = {
		operands: {
			code: instruction as Instructions,
			opr: operand,
		},
	};

	switch (instruction) {
		case Instructions.HLT: // HLT
			condition.registers.fr.hf = true;
			break;
		case Instructions.JMP: // JMP
			condition.registers.ip = operand ?? 0;
			break;
		case Instructions.JZE: // JZE
			if (condition.registers.fr.zf) {
				condition.registers.ip = operand ?? 0;
			}
			break;
		case Instructions.JNZ: // JNZ
			if (!condition.registers.fr.zf) {
				condition.registers.ip = operand ?? 0;
			}
			break;
		case Instructions.LDA: // LDA
			condition.registers.ac =
				condition.memory[memoryLocation(operand ?? 0)] ?? 0;
			break;
		case Instructions.STA: // STA
			condition.memory[memoryLocation(operand ?? 0)] = condition.registers.ac;
			break;
		case Instructions.GET: // GET
			if (inputs.length > 0) {
				const input = inputs.shift();
				condition.registers.ac = Number(`0x${input}`);
			} else throw new TinyMachineRuntimeError("Starved of inputs");
			break;
		case Instructions.PUT: // PUT
			ret.operands.out = condition.registers.ac;
			break;
		case Instructions.ROL: // ROL
			condition.registers.ac =
				((condition.registers.ac << 1) | (condition.registers.ac >> 3)) & 0x0f;
			break;
		case Instructions.ROR: // ROR
			condition.registers.ac =
				((condition.registers.ac >> 1) | (condition.registers.ac << 3)) & 0x0f;
			break;
		case Instructions.ADC: {
			// ADC
			const sum =
				condition.registers.ac +
				(condition.memory[memoryLocation(operand ?? 0)] ?? 0) +
				(condition.registers.fr.cf ? 1 : 0);
			condition.registers.fr.cf = sum > 0x0f;
			condition.registers.ac = sum & 0x0f;
			break;
		}
		case Instructions.CCF: // CCF
			condition.registers.fr.cf = false;
			break;
		case Instructions.SCF: // SCF
			condition.registers.fr.cf = true;
			break;
		case Instructions.DEL: // DEL
			condition.registers.li--;
			break;
		case Instructions.LDL: // LDL
			condition.registers.li = operand ?? 0;
			break;
		case Instructions.FLA: // FLA
			condition.registers.ac = 16 - condition.registers.ac;
	}

	if (condition.registers.ac === 0) {
		condition.registers.fr.zf = true;
	} else {
		condition.registers.fr.zf = false;
	}

	ret.condition = condition;

	return ret;
}

function stringifyStep(
	condition: TinyMachineProgram,
	operands?: { code: Instructions; opr?: number; in?: number; out?: number },
): string {
	return `${condition.registers.ip.toString(16).toUpperCase()} ${condition.registers.li.toString(16).toUpperCase()} ${Number(
		`0b${condition.registers.fr.hf ? 1 : 0}${condition.registers.fr.of ? 1 : 0}${condition.registers.fr.zf ? 1 : 0}${condition.registers.fr.cf ? 1 : 0}`,
	)
		.toString(16)
		.toUpperCase()} ${condition.registers.ac.toString(16).toUpperCase()}   ${condition.memory.map((v) => v.toString(16).toUpperCase()).join("")}  ${Instructions[operands?.code ?? 0]} ${operands?.opr !== undefined ? operands.opr.toString(16).toUpperCase() : "-"} ${operands?.in !== undefined ? operands.in.toString(16).toUpperCase() : "-"} ${operands?.out !== undefined ? operands.out.toString(16).toUpperCase() : "-"}`.trim();
}
