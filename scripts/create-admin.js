'use strict';

// Usage: npm run create-admin -- you@example.com "Your Name" "SomePassword123"
// The new admin must change the password at first login.
require('dotenv').config();
const { openDb } = require('../src/db');
const { createAdmin, passwordProblem } = require('../src/auth');

async function main() {
  const [email, name, password] = process.argv.slice(2);
  if (!email || !name || !password) {
    console.error('Usage: npm run create-admin -- <email> "<name>" "<password>"');
    process.exit(1);
  }
  const problem = passwordProblem(password);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  const db = await openDb();
  try {
    await createAdmin(db, { email: email.trim(), name: name.trim(), password, mustChange: true });
    console.log(`Admin created: ${email}`);
  } catch (err) {
    console.error(err.code === '23505' ? 'An admin with that email already exists.' : err.message);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

main();
