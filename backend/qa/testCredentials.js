const { randomBytes } = require('node:crypto');

function temporaryPassword() {
  return randomBytes(24).toString('base64url');
}

const studentPassword = temporaryPassword();
const adminPassword = temporaryPassword();
process.env.SEED_STUDENT_PASSWORD = studentPassword;
process.env.SEED_ADMIN_PASSWORD = adminPassword;

module.exports = { studentPassword, adminPassword, temporaryPassword };
