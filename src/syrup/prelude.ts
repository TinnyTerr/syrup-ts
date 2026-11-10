// Presets: named bundles of Syrup definitions that are only loaded when
// switched on (`presets` option, `--preset` flag). Nothing is predefined by
// default, so you can build the gates from `nand` yourself. `gates` is the
// manual's "How to Turn Hardware Into Syrup" section, defined from `nand`.
export const BUILTIN_PRESETS: Record<string, string> = {
	gates: `
not(<Bit>) -> <Bit>
not(X) = nand(X,X)

and(<Bit>, <Bit>) -> <Bit>
and(X,Y) = !nand(X,Y)

or(<Bit>, <Bit>) -> <Bit>
or(X,Y) = nand(!X,!Y)

xor(<Bit>, <Bit>) -> <Bit>
xor(X,Y) = !X & Y | X & !Y

one() -> <Bit>
one() = !zero()
`,
};
