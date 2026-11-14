// 產生組員登入密碼雜湊，供 .env 的 ADMIN_PASSWORD_HASH 使用。
// 用法：node backend/scripts/hash-password.mjs "你的密碼"
import { hashPassword } from '../src/password.js';

const plain = process.argv[2];

if (!plain) {
  console.error('用法：node backend/scripts/hash-password.mjs "你的密碼"');
  process.exit(1);
}

console.log(hashPassword(plain));
