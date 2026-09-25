// The standard boolean connectives, defined in Syrup itself from the single
// `nand` primitive, exactly as the manual's "How to Turn Hardware Into
// Syrup" section walks through. Loaded before every user program.
export const PRELUDE = `
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
`;
