import { Instructions, type TinyMachineProgram } from "./ast";
import { parseTinyMachine } from "./parser";
import { runSteps } from "./run";

export function testRun(
	source: string,
	input: string | string[] | number[],
	attempt: string, // ! This is DIRECT user input
): string {
	const computed = runSteps(source, input);
	const user = attempt
		.split("\n")
		.map((v) => v.trim())
		.filter((v) => v.length > 0 && !v.startsWith("Runtime Error:"))
		.map((v) => parseTinyMachine(v));

	let message = "";

	// TODO: add faithful error lines compared to the original implementation, albeit less informative
	for (let i = 0; i < Math.max(computed.length, user.length); i++) {
		const line = user[i];
		const computedLine = computed[i];

		if (!line) {
			// the final halted row has no instruction; it's implied by the HLT row
			if (i === computed.length - 1 && !computedLine?.opr && !computedLine?.error) break;
			message = `What next?`;
			break;
		}

		if (!computedLine) {
			// This should never be reached, in normal circumstances, as the loop should have detected an error and broke off before it got here
			// However, the user can unintentionally or maliciously provide lines and that need to guard against
			message = `Something went wrong`;
			break;
		}
		message =
			compareMemory(computedLine.memory, line.memory) ||
			compareRegisters(computedLine.registers, line.registers) ||
			compareOpr(computedLine.opr, line.opr);
		if (message) break;
	}

	return message;
}

function compareMemory(
	computed: TinyMachineProgram["memory"],
	user: TinyMachineProgram["memory"],
): string {
	for (let i = 0; i < computed.length; i++) {
		if (computed[i] !== user[i]) {
			return `Memory mismatch at index ${i}: expected ${computed[i]}, got ${user[i]}`;
		}
	}

	return "";
}

function compareOpr(
	computed: TinyMachineProgram["opr"],
	user: TinyMachineProgram["opr"],
): string {
	// the user's row may omit the instruction columns entirely
	if (!computed || !user) return "";
	if (computed.opera !== user.opera) {
		return `Instruction mismatch: expected ${Instructions[computed.opera]}, got ${Instructions[user.opera]}`;
	}
	for (const k of ["oper", "in", "out"] as const) {
		if (computed[k] !== user[k]) {
			return `Operand ${k} mismatch: expected ${computed[k] ?? "-"}, got ${user[k] ?? "-"}`;
		}
	}
	return "";
}

function compareRegisters(
	computed: TinyMachineProgram["registers"],
	user: TinyMachineProgram["registers"],
): string {
	if (computed.ip !== user.ip) {
		return `Instruction pointer mismatch: expected ${computed.ip}, got ${user.ip}`;
	}
	if (computed.li !== user.li) {
		return `Line index mismatch: expected ${computed.li}, got ${user.li}`;
	}
	if (computed.ac !== user.ac) {
		return `Accumulator mismatch: expected ${computed.ac}, got ${user.ac}`;
	}
	if (JSON.stringify(computed.fr) !== JSON.stringify(user.fr)) {
		return `Flags mismatch: expected ${JSON.stringify(computed.fr)}, got ${JSON.stringify(user.fr)}`;
	}

	return "";
}
