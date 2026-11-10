import { describe, expect, test } from "bun:test";
import { run } from "./run";

describe("tiny machine execution loop testing", () => {
    test("test the machine loop with a simple program", () => {
        expect(run("0 0 0 0  65F65E65D65C8F70", ["0", "0", "1", "C", "0", "7", "C", "A"])).toBe(
            [
                `0 0 0 0  65F65E65D65C8F70  GET - 0 -`,
                `1 0 2 0  65F65E65D65C8F70  STA F - -`,
                `3 0 2 0  65F65E65D65C8F70  GET - 0 -`,
                `4 0 2 0  65F65E65D65C8F70  STA E - -`,
                `6 0 2 0  65F65E65D65C8F00  GET - 1 -`,
                `7 0 0 1  65F65E65D65C8F00  STA D - -`,
                `9 0 0 1  65F65E65D65C8100  GET - C -`,
                `A 0 0 C  65F65E65D65C8100  STA C - -`,
                `C 0 0 C  65F65E65D65CC100  SCF - - -`,
                `D 0 1 C  65F65E65D65CC100  JMP 0 - -`,
                `0 0 1 C  65F65E65D65CC100  GET - 0 -`,
                `1 0 3 0  65F65E65D65CC100  STA F - -`,
                `3 0 3 0  65F65E65D65CC100  GET - 7 -`,
                `4 0 1 7  65F65E65D65CC100  STA E - -`,
                `6 0 1 7  65F65E65D65CC170  GET - C -`,
                `7 0 1 C  65F65E65D65CC170  STA D - -`,
                `9 0 1 C  65F65E65D65CCC70  GET - A -`,
                `A 0 1 A  65F65E65D65CCC70  STA C - -`,
                `C 0 1 A  65F65E65D65CAC70  ADC C - -`,
                `E 0 5 5  65F65E65D65CAC70  PUT - - 5`,
                `F 0 5 5  65F65E65D65CAC70  HLT - - -`
            ].join("\n")
        )
    })

    test("detects a loop with no way out", () => {
        // JMP 0 forever
        const out = run("0 0 0 0  1000000000000000", [])
        expect(out.split("\n").at(-1)).toBe("Runtime Error: Infinite loop detected")
    })

    test("a loop containing GET is not flagged", () => {
        // GET, JMP 0: runs until inputs are gone
        const out = run("0 0 0 0  6100000000000000", ["1", "1"])
        expect(out).toContain("Starved of inputs")
        expect(out).not.toContain("Infinite")
    })
})
