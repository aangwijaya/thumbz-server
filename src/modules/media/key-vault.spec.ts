import { ConfigService } from '@nestjs/config';
import { KeyVault } from './key-vault';

const vault = (master: string) =>
  new KeyVault(new ConfigService({ drmMasterKey: master }));

describe('KeyVault', () => {
  const key = '00112233445566778899aabbccddeeff';
  const kid = '03d30f20566b61fd54795e20bb5d0596';

  it('round-trips a content key', () => {
    const v = vault('a'.repeat(64));
    expect(v.open(v.seal(key, kid), kid).toString('hex')).toBe(key);
  });

  it('never stores the key in clear and uses a fresh IV each time', () => {
    const v = vault('a'.repeat(64));
    const one = v.seal(key, kid);
    const two = v.seal(key, kid);
    expect(one.ciphertext).not.toContain(key);
    expect(one.iv).not.toBe(two.iv);
  });

  it('rejects a sealed key moved to another kid or a wrong master key', () => {
    const sealed = vault('a'.repeat(64)).seal(key, kid);
    expect(() => vault('a'.repeat(64)).open(sealed, 'f'.repeat(32))).toThrow();
    expect(() => vault('b'.repeat(64)).open(sealed, kid)).toThrow();
  });
});
