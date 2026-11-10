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
