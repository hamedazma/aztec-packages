import { expectSerializeToMatchSnapshot } from '../../tests/expectSerialize.js';
import { makeSignedTxRequest } from '../../tests/factories.js';
import { makeEcdsaSignature } from '../../tests/factories.js';
import {
  makePreviousKernelData,
  makePrivateKernelInputsInner,
  makePrivateKernelInputsInit,
  makeKernelPublicInputs,
  makePublicKernelInputsNoKernelInput,
  makePublicKernelInputs,
  makeAccumulatedData,
} from '../../tests/factories.js';

describe('structs/kernel', () => {
  it(`serializes and prints previous_kernel_data`, async () => {
    const previousKernelData = makePreviousKernelData();
    await expectSerializeToMatchSnapshot(
      previousKernelData.toBuffer(),
      'abis__test_roundtrip_serialize_previous_kernel_data',
    );
  });

  it(`serializes and prints private_kernel_inputs_init`, async () => {
    const kernelInputs = makePrivateKernelInputsInit();
    await expectSerializeToMatchSnapshot(
      kernelInputs.toBuffer(),
      'abis__test_roundtrip_serialize_private_kernel_inputs_init',
    );
  });

  it(`serializes and prints private_kernel_inputs_inner`, async () => {
    const kernelInputs = makePrivateKernelInputsInner();
    await expectSerializeToMatchSnapshot(
      kernelInputs.toBuffer(),
      'abis__test_roundtrip_serialize_private_kernel_inputs_inner',
    );
  });

  it(`serializes and prints EcdsaSignature`, async () => {
    await expectSerializeToMatchSnapshot(makeEcdsaSignature().toBuffer(), 'abis__test_roundtrip_serialize_signature');
  });
  it(`serializes and prints SignedTxRequest`, async () => {
    await expectSerializeToMatchSnapshot(
      makeSignedTxRequest().toBuffer(),
      'abis__test_roundtrip_serialize_signed_tx_request',
    );
  });
  it(`serializes and prints CombinedAccumulatedData`, async (seed = 1) => {
    await expectSerializeToMatchSnapshot(
      makeAccumulatedData(seed, true).toBuffer(),
      'abis__test_roundtrip_serialize_combined_accumulated_data',
    );
  });
  it(`serializes and prints private_kernel_public_inputs`, async () => {
    const kernelInputs = makeKernelPublicInputs();
    await expectSerializeToMatchSnapshot(
      kernelInputs.toBuffer(),
      'abis__test_roundtrip_serialize_kernel_circuit_public_inputs',
    );
  });

  it(`serializes and prints public_kernel_inputs`, async () => {
    const kernelInputs = await makePublicKernelInputs();
    await expectSerializeToMatchSnapshot(
      kernelInputs.toBuffer(),
      'abis__test_roundtrip_serialize_public_kernel_inputs',
    );
  });

  it(`serializes and prints public_kernel_inputs_no_previous_kernel`, async () => {
    const kernelInputs = await makePublicKernelInputsNoKernelInput();
    await expectSerializeToMatchSnapshot(
      kernelInputs.toBuffer(),
      'abis__test_roundtrip_serialize_public_kernel_inputs_no_previous_kernel',
    );
  });
});
