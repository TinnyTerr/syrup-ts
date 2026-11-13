import type { TinyMachineProgram } from "./ast";
import { parseTinyMachine } from "./parser";
import { run } from "./run";

export function testRun(
	source: string,
	input: string | string[] | number[],
	attempt: string, // ! This is DIRECT user input
): string {
	const computed = run(source, input)
		.split("\n")
		.filter((v) => !v.startsWith("Runtime Error:"))
		.map((v) => parseTinyMachine(v.trim()));
	const user = attempt
		.split("\n")
		.filter((v) => !v.startsWith("Runtime Error:"))
		.map((v) => parseTinyMachine(v.trim()));

	let message = "";

	// TODO: add faithful error lines compared to the original implementation, albeit less informative
	for (let i = 0; i < Math.max(computed.length, user.length); i++) {
		const line = user[i];
		const computedLine = computed[i];

		if (!line) {
			message = `What next?`;
			break;
		}

		if (!computedLine) {
			// This should never be reached, in normal circumstances, as the loop should have detected an error and broke off before it got here
			// However, the user can unintentionally or maliciously provide lines and that need to guard against
			message = `Something went wrong`;
			break;
		}
		message +=
			compareMemory(computedLine.memory, line.memory) ||
			compareRegisters(computedLine.registers, line.registers);
		if (message) break;
	}

	return message;
}

function compareMemory(
	computed: TinyMachineProgram["memory"],
	user: TinyMachineProgram["memory"],
): string {
	computed.forEach((v, i) => {
		if (v !== user[i]) {
			return `Memory mismatch at index ${i}: expected ${v}, got ${user[i]}`;
		}
	});

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
