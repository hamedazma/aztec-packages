import { IWasmModule } from '@aztec/foundation/wasm';
import { Buffer } from 'buffer';
import chunk from 'lodash.chunk';
import { abisComputeContractAddress, abisSiloCommitment } from '../cbind/circuits.gen.js';
import {
  AztecAddress,
  FUNCTION_SELECTOR_NUM_BYTES,
  Fr,
  FunctionData,
  FunctionLeafPreimage,
  NewContractData,
  Point,
  PublicCallStackItem,
  SignedTxRequest,
  TxRequest,
  Vector,
} from '../index.js';
import { serializeBufferArrayToVector } from '../utils/serialize.js';

/**
 * Synchronously calls a wasm function.
 * @param wasm - The wasm wrapper.
 * @param fnName - The name of the function to call.
 * @param input - The input buffer or object serializable to a buffer.
 * @param expectedOutputLength - The expected length of the output buffer.
 * @returns The output buffer.
 */
export function wasmSyncCall(
  wasm: IWasmModule,
  fnName: string,
  input:
    | Buffer
    | {
        /**
         * Signature of the target serialization function.
         */
        toBuffer: () => Buffer;
      },
  expectedOutputLength: number,
): Buffer {
  const inputData: Buffer = input instanceof Buffer ? input : input.toBuffer();
  const outputBuf = wasm.call('bbmalloc', expectedOutputLength);
  const inputBuf = wasm.call('bbmalloc', inputData.length);
  wasm.writeMemory(inputBuf, inputData);
  wasm.call(fnName, inputBuf, outputBuf);
  const buf = Buffer.from(wasm.getMemorySlice(outputBuf, outputBuf + expectedOutputLength));
  wasm.call('bbfree', outputBuf);
  wasm.call('bbfree', inputBuf);
  return buf;
}

/**
 * Writes input buffers to wasm memory, calls a wasm function, and returns the output buffer.
 * @param wasm - A module providing low-level wasm access.
 * @param fnName - The name of the function to call.
 * @param inputBuffers - Buffers to write to wasm memory.
 * @param expectedOutputLength - The expected length of the output buffer.
 * @returns The output buffer.
 */
export function inputBuffersToOutputBuffer(
  wasm: IWasmModule,
  fnName: string,
  inputBuffers: Buffer[],
  expectedOutputLength: number,
) {
  const offsets: number[] = [];
  const totalLength = inputBuffers.reduce((total, cur) => {
    offsets.push(total);
    return total + cur.length;
  }, 0);

  const outputBuf = wasm.call('bbmalloc', expectedOutputLength);
  const inputBuf = wasm.call('bbmalloc', totalLength);
  wasm.writeMemory(inputBuf, Buffer.concat(inputBuffers));
  const args = offsets.map(offset => inputBuf + offset);
  wasm.call(fnName, ...args, outputBuf);
  const output = Buffer.from(wasm.getMemorySlice(outputBuf, outputBuf + expectedOutputLength));
  wasm.call('bbfree', inputBuf);
  wasm.call('bbfree', outputBuf);
  return output;
}

/**
 * Computes a hash of a transaction request.
 * @param wasm - A module providing low-level wasm access.
 * @param txRequest - The transaction request.
 * @returns The hash of the transaction request.
 */
export function hashTxRequest(wasm: IWasmModule, txRequest: TxRequest): Buffer {
  wasm.call('pedersen__init');
  return wasmSyncCall(wasm, 'abis__hash_tx_request', txRequest, 32);
}

/**
 * Computes a function selector from a given function signature.
 * @param wasm - A module providing low-level wasm access.
 * @param funcSig - The function signature.
 * @returns The function selector.
 */
export function computeFunctionSelector(wasm: IWasmModule, funcSig: string): Buffer {
  return wasmSyncCall(
    wasm,
    'abis__compute_function_selector',
    // Important - explicit C-string compatibility with a null terminator!
    // In the future we want to move away from this fiddly C-string processing.
    Buffer.from(funcSig + '\0'),
    FUNCTION_SELECTOR_NUM_BYTES,
  );
}

/**
 * Computes a hash of a given verification key.
 * @param wasm - A module providing low-level wasm access.
 * @param vkBuf - The verification key.
 * @returns The hash of the verification key.
 */
export function hashVK(wasm: IWasmModule, vkBuf: Buffer) {
  wasm.call('pedersen__init');
  return wasmSyncCall(wasm, 'abis__hash_vk', vkBuf, 32);
}

/**
 * Computes a function leaf from a given preimage.
 * @param wasm - A module providing low-level wasm access.
 * @param fnLeaf - The function leaf preimage.
 * @returns The function leaf.
 */
export function computeFunctionLeaf(wasm: IWasmModule, fnLeaf: FunctionLeafPreimage): Fr {
  wasm.call('pedersen__init');
  return Fr.fromBuffer(wasmSyncCall(wasm, 'abis__compute_function_leaf', fnLeaf, 32));
}

/**
 * Computes a function tree root from function leaves.
 * @param wasm - A module providing low-level wasm access.
 * @param fnLeves - The function leaves to be included in the contract function tree.
 * @returns The function tree root.
 */
export function computeFunctionTreeRoot(wasm: IWasmModule, fnLeves: Fr[]) {
  const inputVector = serializeBufferArrayToVector(fnLeves.map(fr => fr.toBuffer()));
  wasm.call('pedersen__init');
  const result = wasmSyncCall(wasm, 'abis__compute_function_tree_root', inputVector, 32);
  return Fr.fromBuffer(result);
}

/**
 * Computes a constructor hash.
 * @param wasm - A module providing low-level wasm access.
 * @param functionData - Constructor's function data.
 * @param argsHash - Constructor's arguments hashed.
 * @param constructorVKHash - Hash of the constructor's verification key.
 * @returns The constructor hash.
 */
export function hashConstructor(
  wasm: IWasmModule,
  functionData: FunctionData,
  argsHash: Fr,
  constructorVKHash: Buffer,
): Buffer {
  wasm.call('pedersen__init');
  const result = inputBuffersToOutputBuffer(
    wasm,
    'abis__hash_constructor',
    [functionData.toBuffer(), argsHash.toBuffer(), constructorVKHash],
    32,
  );
  return result;
}

/**
 * Computes a contract address.
 * @param wasm - A module providing low-level wasm access.
 * @param deployerAddr - The address of the contract deployer.
 * @param contractAddrSalt - The salt used as 1 one of the inputs of the contract address computation.
 * @param fnTreeRoot - The function tree root of the contract being deployed.
 * @param constructorHash - The hash of the constructor.
 * @returns The contract address.
 */
export function computeContractAddress(
  wasm: IWasmModule,
  deployerPubKey: Point,
  contractAddrSalt: Fr,
  fnTreeRoot: Fr,
  constructorHash: Buffer,
): AztecAddress {
  wasm.call('pedersen__init');
  return abisComputeContractAddress(
    wasm,
    [deployerPubKey.x, deployerPubKey.y],
    contractAddrSalt,
    fnTreeRoot,
    Fr.fromBuffer(constructorHash),
  );
}

/**
 * Computes a siloed commitment, given the contract address and the commitment itself.
 * @param wasm - A module providing low-level wasm access.
 * @param contract - The contract address
 * @param commitment - The commitment to silo.
 * @returns A siloed commitment.
 */
export function siloCommitment(wasm: IWasmModule, contract: AztecAddress, commitment: Fr): Fr {
  wasm.call('pedersen__init');
  return abisSiloCommitment(wasm, contract, commitment);
}

/**
 * Computes the hash of a list of arguments.
 * @param wasm - A module providing low-level wasm access.
 * @param args - Arguments to hash.
 * @returns Pedersen hash of the arguments.
 */
export function computeVarArgsHash(wasm: IWasmModule, args: Fr[]): Promise<Fr> {
  if (args.length === 0) return Promise.resolve(Fr.ZERO);
  if (args.length > 32 ** 2) throw new Error(`Cannot hash more than 1024 arguments`);
  wasm.call('pedersen__init');

  const wasmComputeVarArgs = (args: Fr[]) =>
    Fr.fromBuffer(wasmSyncCall(wasm, 'abis__compute_var_args_hash', new Vector(args), 32));

  if (args.length > 32) {
    const chunksHashes = chunk(args, 32).map(c => wasmComputeVarArgs(c));
    return Promise.resolve(wasmComputeVarArgs(chunksHashes));
  } else {
    return Promise.resolve(wasmComputeVarArgs(args));
  }
}

/**
 * Computes a contract leaf of the given contract.
 * @param wasm - Relevant WASM wrapper.
 * @param cd - The contract data of the deployed contract.
 * @returns The contract leaf.
 */
export function computeContractLeaf(wasm: IWasmModule, cd: NewContractData): Fr {
  wasm.call('pedersen__init');
  const value = wasmSyncCall(wasm, 'abis__compute_contract_leaf', cd, 32);
  return Fr.fromBuffer(value);
}

/**
 * Computes tx hash of a given transaction request.
 * @param wasm - Relevant WASM wrapper.
 * @param txRequest - The signed transaction request.
 * @returns The transaction hash.
 */
export function computeTxHash(wasm: IWasmModule, txRequest: SignedTxRequest): Fr {
  wasm.call('pedersen__init');
  const value = wasmSyncCall(wasm, 'abis__compute_transaction_hash', txRequest, 32);
  return Fr.fromBuffer(value);
}

/**
 * Computes a call stack item hash.
 * @param wasm - Relevant WASM wrapper.
 * @param callStackItem - The call stack item.
 * @returns The call stack item hash.
 */
export function computeCallStackItemHash(wasm: IWasmModule, callStackItem: PublicCallStackItem): Fr {
  wasm.call('pedersen__init');
  const value = wasmSyncCall(wasm, 'abis__compute_call_stack_item_hash', callStackItem, 32);
  return Fr.fromBuffer(value);
}

/**
 * Computes a secret message hash for sending secret l1 to l2 messages.
 * @param secretMessage - The secret message.
 * @returns
 */
export function computeSecretMessageHash(wasm: IWasmModule, secretMessage: Fr) {
  wasm.call('pedersen__init');
  const value = wasmSyncCall(wasm, 'abis__compute_message_secret_hash', secretMessage, 32);
  return Fr.fromBuffer(value);
}
