import { AcirSimulator } from '@aztec/acir-simulator';
import { AztecNode } from '@aztec/aztec-node';
import { CircuitsWasm, KERNEL_NEW_COMMITMENTS_LENGTH, PrivateHistoricTreeRoots } from '@aztec/circuits.js';
import { Grumpkin } from '@aztec/circuits.js/barretenberg';
import { FunctionType } from '@aztec/foundation/abi';
import { AztecAddress } from '@aztec/foundation/aztec-address';
import { Fr, Point } from '@aztec/foundation/fields';
import { createDebugLogger } from '@aztec/foundation/log';
import { ConstantKeyPair, KeyPair } from '@aztec/key-store';
import {
  EncodedContractFunction,
  ExecutionRequest,
  INITIAL_L2_BLOCK_NUM,
  L2BlockContext,
  MerkleTreeId,
  SignedTxExecutionRequest,
  Tx,
  NoteSpendingInfo,
  TxExecutionRequest,
  TxL2Logs,
  L2BlockL2Logs,
} from '@aztec/types';
import { KernelOracle } from '../kernel_oracle/index.js';
import { ContractDataOracle } from '../contract_data_oracle/index.js';
import { Database, NoteSpendingInfoDao, TxDao } from '../database/index.js';
import { generateFunctionSelector } from '../index.js';
import { KernelProver } from '../kernel_prover/index.js';
import { SimulatorOracle } from '../simulator_oracle/index.js';

/**
 * Contains all the decrypted data in this array so that we can later batch insert it all into the database.
 */
interface ProcessedData {
  /**
   * Holds L2 block data and associated context.
   */
  blockContext: L2BlockContext;
  /**
   * Indices of private transactions in the block that pertain to the user.
   */
  userPertainingPrivateTxIndices: number[];
  /**
   * A collection of data access objects for transaction auxiliary data.
   */
  noteSpendingInfoDaos: NoteSpendingInfoDao[];
}

/**
 * AccountState is responsible for managing the user's private state and interactions with the Aztec network.
 * It keeps track of the relevant L2 blocks, synchronizes with the network, simulates transactions, and proves them.
 * AccountState also stores the transactions related to the user in a local database and decrypts the sensitive data.
 * The class offers methods to simulate and prove transactions, both for constrained and unconstrained functions,
 * as well as the ability to process blocks and update the user's private state accordingly.
 */
export class AccountState {
  /**
   * The latest L2 block number that the account state has synchronized to.
   */
  public syncedToBlock = 0;
  private publicKey: Point;
  private keyPair: KeyPair;

  constructor(
    private readonly privKey: Buffer,
    private readonly address: AztecAddress,
    private db: Database,
    private node: AztecNode,
    private grumpkin: Grumpkin,
    private TXS_PER_BLOCK = 4,
    private log = createDebugLogger('aztec:aztec_rpc_account_state'),
  ) {
    if (privKey.length !== 32) {
      throw new Error(`Invalid private key length. Received ${privKey.length}, expected 32`);
    }
    this.publicKey = Point.fromBuffer(this.grumpkin.mul(Grumpkin.generator, this.privKey));
    this.keyPair = new ConstantKeyPair(this.publicKey, privKey);
  }

  /**
   * Check if the AccountState is synchronised with the remote block height.
   * The function queries the remote block height from the AztecNode and compares it with the syncedToBlock value in the AccountState.
   * If the values are equal, then the AccountState is considered to be synchronised, otherwise not.
   *
   * @returns A boolean indicating whether the AccountState is synchronised with the remote block height or not.
   */
  public async isSynchronised() {
    const remoteBlockHeight = await this.node.getBlockHeight();
    return this.syncedToBlock === remoteBlockHeight;
  }

  /**
   * Get the latest synced block number for this account state.
   * The synced block number represents the highest block number that has been processed successfully
   * by the `AccountState` instance, ensuring that all transactions and associated data is up-to-date.
   *
   * @returns The latest synced block number.
   */
  public getSyncedToBlock() {
    return this.syncedToBlock;
  }

  /**
   * Get the public key of the account associated with this AccountState instance.
   *
   * @returns A Point instance representing the public key.
   */
  public getPublicKey() {
    return this.publicKey;
  }

  /**
   * Get the address of the account associated with this AccountState instance.
   *
   * @returns An AztecAddress instance representing the account's address.
   */
  public getAddress() {
    return this.address;
  }

  /**
   * Retrieve all the transactions associated with the current account address.
   * This function fetches the transaction information from the database for the
   * specified Aztec address set in the AccountState instance.
   *
   * @returns An array of transaction objects related to the current account address.
   */
  public getTxs() {
    return this.db.getTxsByAddress(this.address);
  }

  /**
   * Retrieves the simulation parameters required to run an ACIR simulation.
   * This includes the contract address, function ABI, portal contract address, and historic tree roots.
   * The function uses the given 'contractDataOracle' to fetch the necessary data from the node and user's database.
   *
   * @param execRequest - The transaction request object containing details of the contract call.
   * @param contractDataOracle - An instance of ContractDataOracle used to fetch the necessary data.
   * @returns An object containing the contract address, function ABI, portal contract address, and historic tree roots.
   */
  private async getSimulationParameters(execRequest: ExecutionRequest, contractDataOracle: ContractDataOracle) {
    const contractAddress = execRequest.to;
    const functionAbi = await contractDataOracle.getFunctionAbi(
      contractAddress,
      execRequest.functionData.functionSelectorBuffer,
    );
    const portalContract = await contractDataOracle.getPortalContractAddress(contractAddress);

    const currentRoots = this.db.getTreeRoots();
    const historicRoots = PrivateHistoricTreeRoots.from({
      contractTreeRoot: currentRoots[MerkleTreeId.CONTRACT_TREE],
      nullifierTreeRoot: currentRoots[MerkleTreeId.NULLIFIER_TREE],
      privateDataTreeRoot: currentRoots[MerkleTreeId.PRIVATE_DATA_TREE],
      l1ToL2MessagesTreeRoot: currentRoots[MerkleTreeId.L1_TO_L2_MESSAGES_TREE],
      privateKernelVkTreeRoot: Fr.ZERO,
    });

    return {
      contractAddress,
      functionAbi,
      portalContract,
      historicRoots,
    };
  }

  /**
   * Simulate the execution of a transaction request on an Aztec account state.
   * This function computes the expected state changes resulting from the transaction
   * without actually submitting it to the blockchain. The result will be used for creating the kernel proofs,
   * as well as for estimating gas costs.
   *
   * @param txRequest - The transaction request object containing the necessary data for simulation.
   * @param contractDataOracle - Optional parameter, an instance of ContractDataOracle class for retrieving contract data.
   * @returns A promise that resolves to an object containing the simulation results, including expected output notes and any error messages.
   */
  public async simulate(txRequest: TxExecutionRequest, contractDataOracle?: ContractDataOracle) {
    // TODO - Pause syncing while simulating.
    if (!contractDataOracle) {
      contractDataOracle = new ContractDataOracle(this.db, this.node);
    }

    const { contractAddress, functionAbi, portalContract, historicRoots } = await this.getSimulationParameters(
      txRequest,
      contractDataOracle,
    );

    const simulator = this.getAcirSimulator(contractDataOracle);
    this.log('Executing simulator...');
    const result = await simulator.run(txRequest, functionAbi, contractAddress, portalContract, historicRoots);
    this.log('Simulation completed!');

    return result;
  }

  /**
   * Simulate an unconstrained transaction on the given contract, without considering constraints set by ACIR.
   * The simulation parameters are fetched using ContractDataOracle and executed using AcirSimulator.
   * Returns the simulation result containing the outputs of the unconstrained function.
   *
   * @param execRequest - The transaction request object containing the target contract and function data.
   * @param contractDataOracle - Optional instance of ContractDataOracle for fetching and caching contract information.
   * @returns The simulation result containing the outputs of the unconstrained function.
   */
  public async simulateUnconstrained(execRequest: ExecutionRequest, contractDataOracle?: ContractDataOracle) {
    if (!contractDataOracle) {
      contractDataOracle = new ContractDataOracle(this.db, this.node);
    }

    const { contractAddress, functionAbi, portalContract, historicRoots } = await this.getSimulationParameters(
      execRequest,
      contractDataOracle,
    );

    const simulator = this.getAcirSimulator(contractDataOracle);

    this.log('Executing unconstrained simulator...');
    const result = await simulator.runUnconstrained(
      execRequest,
      functionAbi,
      contractAddress,
      portalContract,
      historicRoots,
    );
    this.log('Unconstrained simulation completed!');

    return result;
  }

  /**
   * Simulate a transaction, generate a kernel proof, and create a private transaction object.
   * The function takes in a transaction request and an ECDSA signature. It simulates the transaction,
   * then generates a kernel proof using the simulation result. Finally, it creates a private
   * transaction object with the generated proof and public inputs. If a new contract address is provided,
   * the function will also include the new contract's public functions in the transaction object.
   *
   * @param txExecutionRequest - The transaction request to be simulated and proved.
   * @param signature - The ECDSA signature for the transaction request.
   * @param newContractAddress - Optional. The address of a new contract to be included in the transaction object.
   * @returns A private transaction object containing the proof, public inputs, and encrypted logs.
   */
  public async simulateAndProve(
    txExecutionRequest: SignedTxExecutionRequest,
    newContractAddress: AztecAddress | undefined,
  ) {
    // TODO - Pause syncing while simulating.

    const contractDataOracle = new ContractDataOracle(this.db, this.node);
    const kernelOracle = new KernelOracle(contractDataOracle, this.node);
    const executionResult = await this.simulate(txExecutionRequest.txRequest, contractDataOracle);

    const kernelProver = new KernelProver(kernelOracle);
    this.log('Executing Prover...');
    const { proof, publicInputs } = await kernelProver.prove(
      await txExecutionRequest.toSignedTxRequest(),
      executionResult,
    );
    this.log('Proof completed!');

    const newContractPublicFunctions = newContractAddress
      ? await this.getNewContractPublicFunctions(newContractAddress)
      : [];

    // 1 tx containing only 1 function invocation
    const encryptedLogs = new TxL2Logs([executionResult.encryptedLogs]);

    return Tx.createPrivate(
      publicInputs,
      proof,
      encryptedLogs,
      newContractPublicFunctions,
      executionResult.enqueuedPublicFunctionCalls,
    );
  }

  /**
   * Return public functions from the newly deployed contract to be injected into the tx object.
   * @param newContractAddress - Address of the new contract.
   * @returns List of EncodedContractFunction.
   */
  private async getNewContractPublicFunctions(newContractAddress: AztecAddress) {
    const newContract = await this.db.getContract(newContractAddress);
    if (!newContract) {
      throw new Error(`Invalid new contract address provided at ${newContractAddress}. Contract not found in DB.`);
    }

    return newContract.functions
      .filter(c => c.functionType === FunctionType.OPEN)
      .map(
        fn =>
          new EncodedContractFunction(
            generateFunctionSelector(fn.name, fn.parameters),
            Buffer.from(fn.bytecode, 'hex'),
          ),
      );
  }

  /**
   * Process the given L2 block contexts and encrypted logs to update the account state.
   * It synchronizes the user's account by decrypting the encrypted logs and processing
   * the transactions and auxiliary data associated with them.
   * Throws an error if the number of block contexts and encrypted logs do not match.
   *
   * @param l2BlockContexts - An array of L2 block contexts to be processed.
   * @param encryptedL2BlockLogs - An array of encrypted logs associated with the L2 block contexts.
   * @returns A promise that resolves once the processing is completed.
   */
  public async process(l2BlockContexts: L2BlockContext[], encryptedL2BlockLogs: L2BlockL2Logs[]): Promise<void> {
    if (l2BlockContexts.length !== encryptedL2BlockLogs.length) {
      throw new Error(
        `Number of blocks and EncryptedLogs is not equal. Received ${l2BlockContexts.length} blocks, ${encryptedL2BlockLogs.length} encrypted logs.`,
      );
    }
    if (!l2BlockContexts.length) {
      return;
    }

    // TODO(Maddiaa): this calculation is brittle.
    // https://github.com/AztecProtocol/aztec-packages/issues/788
    let dataStartIndex =
      (l2BlockContexts[0].block.number - INITIAL_L2_BLOCK_NUM) * this.TXS_PER_BLOCK * KERNEL_NEW_COMMITMENTS_LENGTH;
    const blocksAndNoteSpendingInfo: ProcessedData[] = [];

    // Iterate over both blocks and encrypted logs.
    for (let blockIndex = 0; blockIndex < encryptedL2BlockLogs.length; ++blockIndex) {
      const { txLogs } = encryptedL2BlockLogs[blockIndex];
      let logIndexWithinBlock = 0;

      // Try decrypting the encrypted logs.
      // Note: Public txs don't generate commitments and encrypted logs and for this reason we can ignore them here.
      const privateTxIndices: Set<number> = new Set();
      const noteSpendingInfoDaos: NoteSpendingInfoDao[] = [];
      for (let txIndex = 0; txIndex < txLogs.length; ++txIndex) {
        const txFunctionLogs = txLogs[txIndex].functionLogs;
        for (const functionLogs of txFunctionLogs) {
          for (const logs of functionLogs.logs) {
            const noteSpendingInfo = NoteSpendingInfo.fromEncryptedBuffer(logs, this.privKey, this.grumpkin);
            if (noteSpendingInfo) {
              // We have successfully decrypted the data.
              const privateTxIndex = Math.floor(txIndex / KERNEL_NEW_COMMITMENTS_LENGTH);
              privateTxIndices.add(privateTxIndex);
              noteSpendingInfoDaos.push({
                ...noteSpendingInfo,
                nullifier: await this.computeNullifier(noteSpendingInfo),
                index: BigInt(dataStartIndex + logIndexWithinBlock),
                account: this.publicKey,
              });
            }
            logIndexWithinBlock += 1;
          }
        }
      }

      blocksAndNoteSpendingInfo.push({
        blockContext: l2BlockContexts[blockIndex],
        userPertainingPrivateTxIndices: [...privateTxIndices],
        noteSpendingInfoDaos,
      });
      dataStartIndex += txLogs.length;
    }

    await this.processBlocksAndNoteSpendingInfo(blocksAndNoteSpendingInfo);

    this.syncedToBlock = l2BlockContexts[l2BlockContexts.length - 1].block.number;
    this.log(`Synched block ${this.syncedToBlock}`);
  }

  /**
   * Compute the nullifier for a given transaction auxiliary data.
   * The nullifier is calculated using the private key of the account,
   * contract address, and note preimage associated with the noteSpendingInfo.
   * This method assists in identifying spent commitments in the private state.
   *
   * @param noteSpendingInfo - An instance of NoteSpendingInfo containing transaction details.
   * @returns A Fr instance representing the computed nullifier.
   */
  private async computeNullifier(noteSpendingInfo: NoteSpendingInfo) {
    const simulator = this.getAcirSimulator();
    // TODO In the future, we'll need to simulate an unconstrained fn associated with the contract ABI and slot
    return Fr.fromBuffer(
      simulator.computeSiloedNullifier(
        noteSpendingInfo.contractAddress,
        noteSpendingInfo.notePreimage.items,
        this.privKey,
        await CircuitsWasm.get(),
      ),
    );
  }

  /**
   * Process the given blocks and their associated transaction auxiliary data.
   * This function updates the database with information about new transactions,
   * user-pertaining transaction indices, and auxiliary data. It also removes nullified
   * transaction auxiliary data from the database. This function keeps track of new nullifiers
   * and ensures all other transactions are updated with newly settled block information.
   *
   * @param blocksAndNoteSpendingInfo - Array of objects containing L2BlockContexts, user-pertaining transaction indices, and NoteSpendingInfoDaos.
   */
  private async processBlocksAndNoteSpendingInfo(blocksAndNoteSpendingInfo: ProcessedData[]) {
    const noteSpendingInfoDaosBatch: NoteSpendingInfoDao[] = [];
    const txDaos: TxDao[] = [];
    let newNullifiers: Fr[] = [];

    for (let i = 0; i < blocksAndNoteSpendingInfo.length; ++i) {
      const { blockContext, userPertainingPrivateTxIndices, noteSpendingInfoDaos } = blocksAndNoteSpendingInfo[i];

      // Process all the user pertaining private txs.
      userPertainingPrivateTxIndices.map((txIndex, j) => {
        const txHash = blockContext.getTxHash(txIndex);
        this.log(`Processing tx ${txHash!.toString()} from block ${blockContext.block.number}`);
        const { newContractData } = blockContext.block.getTx(txIndex);
        const isContractDeployment = !newContractData[0].contractAddress.isZero();
        const noteSpendingInfo = noteSpendingInfoDaos[j];
        const [to, contractAddress] = isContractDeployment
          ? [undefined, noteSpendingInfo.contractAddress]
          : [noteSpendingInfo.contractAddress, undefined];
        txDaos.push({
          txHash,
          blockHash: blockContext.getBlockHash(),
          blockNumber: blockContext.block.number,
          from: this.address,
          to,
          contractAddress,
          error: '',
        });
      });
      noteSpendingInfoDaosBatch.push(...noteSpendingInfoDaos);

      newNullifiers = newNullifiers.concat(blockContext.block.newNullifiers);

      // Ensure all the other txs are updated with newly settled block info.
      await this.updateBlockInfoInBlockTxs(blockContext);
    }
    if (noteSpendingInfoDaosBatch.length) {
      await this.db.addNoteSpendingInfoBatch(noteSpendingInfoDaosBatch);
      noteSpendingInfoDaosBatch.forEach(noteSpendingInfo => {
        this.log(`Added tx aux data with nullifier ${noteSpendingInfo.nullifier.toString()}}`);
      });
    }
    if (txDaos.length) await this.db.addTxs(txDaos);
    const removedNoteSpendingInfo = await this.db.removeNullifiedNoteSpendingInfo(newNullifiers, this.publicKey);
    removedNoteSpendingInfo.forEach(noteSpendingInfo => {
      this.log(`Removed tx aux data with nullifier ${noteSpendingInfo.nullifier.toString()}}`);
    });
  }

  /**
   * Updates the block information for all transactions in a given block context.
   * The function retrieves transaction data objects from the database using their hashes,
   * sets the block hash and block number to the corresponding values, and saves the updated
   * transaction data back to the database. If a transaction is not found in the database,
   * an informational message is logged.
   *
   * @param blockContext - The L2BlockContext object containing the block information and related data.
   */
  private async updateBlockInfoInBlockTxs(blockContext: L2BlockContext) {
    for (const txHash of blockContext.getTxHashes()) {
      const txDao: TxDao | undefined = await this.db.getTx(txHash);
      if (txDao !== undefined) {
        txDao.blockHash = blockContext.getBlockHash();
        txDao.blockNumber = blockContext.block.number;
        await this.db.addTx(txDao);
        this.log(`Added tx with hash ${txHash.toString()} from block ${blockContext.block.number}`);
      } else {
        this.log(`Tx with hash ${txHash.toString()} from block ${blockContext.block.number} not found in db`);
      }
    }
  }

  private getAcirSimulator(contractDataOracle?: ContractDataOracle) {
    const simulatorOracle = new SimulatorOracle(
      contractDataOracle ?? new ContractDataOracle(this.db, this.node),
      this.db,
      this.keyPair,
      this.address,
      this.node,
    );
    return new AcirSimulator(simulatorOracle);
  }
}
