export interface TinyMachineProgram {
	registers: {
		ip: number;
		li: number;
		fr: Flags;
		ac: number;
	};
	memory: number[];
}

export interface Flags {
	// halt flag
	hf: boolean;
	// overflow flag
	of: boolean;
	// zero flag
	zf: boolean;
	// carry flag
	cf: boolean;
}

export enum Instructions {
	HLT,
	JMP,
	JZE,
	JNZ,
	LDA,
	STA,
	GET,
	PUT,
	ROL,
	ROR,
	ADC,
	CCF,
	SCF,
	DEL,
	LDL,
	FLA,
}

export function hasOperand(instruction: Instructions): boolean {
	return (
		(instruction >= Instructions.JMP && instruction <= Instructions.STA) ||
		instruction === Instructions.ADC ||
		instruction === Instructions.LDL
	);
}

export function memoryLocation(location: number): number {
	return location & 0x0f;
}

export class TinyMachineParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TinyMachineParseError";
	}
}
export class TinyMachineRuntimeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TinyMachineRuntimeError";
	}
}
