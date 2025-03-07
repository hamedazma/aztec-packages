import { sha256 } from './index.js';
import { randomBytes, createHash } from 'crypto';

describe('sha256', () => {
  it('should correctly hash data using hash.js', () => {
    const data = randomBytes(67);

    const expected = createHash('sha256').update(data).digest();

    const result = sha256(data);
    expect(result).toEqual(expected);
  });
});
