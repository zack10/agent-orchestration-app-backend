import dotenv from 'dotenv';
import { encrypt, decrypt } from '../src/utils/crypto';

dotenv.config({ path: '.env.local' });

const testSecret = 'sk-1234567890abcdefghijklmnopqrstuvwxyz';

try {
  console.log('Testing encryption...');
  const encrypted = encrypt(testSecret);
  console.log('Encrypted:', encrypted);

  console.log('Testing decryption...');
  const decrypted = decrypt(encrypted);
  console.log('Decrypted:', decrypted);

  if (decrypted === testSecret) {
    console.log('✅ SUCCESS: Encryption/Decryption works!');
  } else {
    console.error('❌ FAILURE: Decrypted text does not match original!');
  }
} catch (error) {
  console.error('❌ ERROR:', (error as Error).message);
}
