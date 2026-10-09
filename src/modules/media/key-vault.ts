import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface SealedKey {
  ciphertext: string;
  iv: string;
  auth_tag: string;
}

/**
 * Envelope encryption for content keys: each 16-byte content key is sealed
 * with AES-256-GCM under DRM_MASTER_KEY, so a database dump alone never
 * decrypts any stream. Rotating the master key = re-sealing the rows.
 */
@Injectable()
export class KeyVault {
  private readonly master: Buffer;

  constructor(config: ConfigService) {
    this.master = Buffer.from(config.get<string>('drmMasterKey') ?? '', 'hex');
  }

  seal(keyHex: string, kid: string): SealedKey {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.master, iv);
    // The kid is authenticated data: a sealed key cannot be swapped onto another kid.
    cipher.setAAD(Buffer.from(kid));
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(keyHex, 'hex')),
      cipher.final(),
    ]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      auth_tag: cipher.getAuthTag().toString('base64'),
    };
  }

  open(sealed: SealedKey, kid: string): Buffer {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.master,
      Buffer.from(sealed.iv, 'base64'),
    );
    decipher.setAAD(Buffer.from(kid));
    decipher.setAuthTag(Buffer.from(sealed.auth_tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
      decipher.final(),
    ]);
  }
}
