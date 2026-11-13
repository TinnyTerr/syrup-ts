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
		message = discrepancy(computedLine, line) || compareOpr(computedLine.opr, line.opr);
		if (message) break;
	}

	return message;
}

/**
 * Mirrors the original's less informative error: just names the cells that
 * differ, memory by index and registers by name, e.g.
 * `Configuration discrepancy: [14] and [15]`
 */
function discrepancy(
	computed: TinyMachineProgram,
	user: TinyMachineProgram,
): string {
	const bad: string[] = [];
	for (const k of ["ip", "li", "ac"] as const) {
		if (computed.registers[k] !== user.registers[k]) bad.push(k);
	}
	if (JSON.stringify(computed.registers.fr) !== JSON.stringify(user.registers.fr)) {
		bad.push("fr");
	}
	for (let i = 0; i < computed.memory.length; i++) {
		if (computed.memory[i] !== user.memory[i]) bad.push(String(i));
	}
	if (bad.length === 0) return "";

	const cells = bad.map((v) => `[${v}]`);
	const last = cells.pop();
	return `Configuration discrepancy: ${cells.length ? `${cells.join(", ")} and ` : ""}${last}`;
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
