// A friendly Java subset: compiled to real JVM bytecode, run by a
// step-by-step bytecode interpreter. Pure logic, no rendering.

export { compile, type CompileError, type CompileResult } from './compiler';
export { type ClassInfo, type Instr, type MethodInfo, type Program } from './bytecode';
export { Vm, formatValue, objectSize, arraySize, type Value, type VmArray, type VmError, type VmFrame, type VmHooks, type VmObject, type VmRef, type VmState } from './vm';
export { SAMPLES, type Sample } from './samples';
