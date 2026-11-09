export interface TinyMachineProgram {
  memory: [string, string, string, string];
  operation: string;
  operand: string;
  input: string[];
}
