// 獨立執行的 migration 腳本：node backend/src/migrate.js
import { openDb } from './db.js';

const path = process.env.DB_PATH || 'backend/data/game.db';
openDb(path);
console.log(`Migrations applied: ${path}`);
