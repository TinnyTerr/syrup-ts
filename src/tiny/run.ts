import type { TinyMachineProgram } from "./ast";
import { parseTinyMachine } from "./parser";

export function run(
    source: string,
    _input: string | string[] | number[],
): string {
    // TODO: add object based output, to better display the output, and to allow for better testing
    const obj = parseTinyMachine(source);



    return "";
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

function machineLoop(condition: TinyMachineProgram, inputs: string[]): { condition: TinyMachineProgram, operands: { code: string, opr?: number, in?: number, out?: number } } {

}

function stringifyStep(condition: TinyMachineProgram): string {
    return `${condition.registers.ip.toString(16).toUpperCase()} ${condition.registers.li.toString(16).toUpperCase()} ${Number(`0b${condition.registers.fr.hf ? 1 : 0}${condition.registers.fr.of ? 1 : 0}${condition.registers.fr.zf ? 1 : 0}${condition.registers.fr.cf ? 1 : 0}`).toString(16).toUpperCase()} ${condition.registers.ac.toString(16).toUpperCase()}  ${condition.memory.map((v) => v.toString(16).toUpperCase()).join("")}`;
}
