import { Grumpkin } from '@aztec/circuits.js/barretenberg';
import { CircuitsWasm } from '@aztec/circuits.js';
import { Point } from '@aztec/foundation/fields';
import { NoteSpendingInfo } from './note_spending_info.js';
import { randomBytes } from '@aztec/foundation/crypto';

describe('note_spending_info', () => {
  let grumpkin: Grumpkin;

  beforeAll(async () => {
    grumpkin = new Grumpkin(await CircuitsWasm.get());
  });

  it('convert to and from buffer', () => {
    const noteSpendingInfo = NoteSpendingInfo.random();
    const buf = noteSpendingInfo.toBuffer();
    expect(NoteSpendingInfo.fromBuffer(buf)).toEqual(noteSpendingInfo);
  });

  it('convert to and from encrypted buffer', () => {
    const noteSpendingInfo = NoteSpendingInfo.random();
    const ownerPrivKey = randomBytes(32);
    const ownerPubKey = Point.fromBuffer(grumpkin.mul(Grumpkin.generator, ownerPrivKey));
    const encrypted = noteSpendingInfo.toEncryptedBuffer(ownerPubKey, grumpkin);
    const decrypted = NoteSpendingInfo.fromEncryptedBuffer(encrypted, ownerPrivKey, grumpkin);
    expect(decrypted).not.toBeUndefined();
    expect(decrypted).toEqual(noteSpendingInfo);
  });

  it('return undefined if unable to decrypt the encrypted buffer', () => {
    const noteSpendingInfo = NoteSpendingInfo.random();
    const ownerPubKey = Point.random();
    const encrypted = noteSpendingInfo.toEncryptedBuffer(ownerPubKey, grumpkin);
    const randomPrivKey = randomBytes(32);
    const decrypted = NoteSpendingInfo.fromEncryptedBuffer(encrypted, randomPrivKey, grumpkin);
    expect(decrypted).toBeUndefined();
  });
});
