const { query, pool } = require('../src/db');
const { hashPassword } = require('../src/utils/password');

const DEMO_REGISTRATION_NOS = [
  '202600010001',
  '202600010002',
  '202600010003',
];

function initialPassword(registrationNo) {
  const value = String(registrationNo);
  return value.slice(-8);
}

async function createOrUpdateUser(registrationNo) {
  const rows = await query('SELECT id FROM users WHERE registration_no = :registrationNo LIMIT 1', {
    registrationNo,
  });

  const plainPassword = initialPassword(registrationNo);
  const passwordHash = await hashPassword(plainPassword);

  if (rows[0]) {
    await query('UPDATE users SET password_hash = :passwordHash WHERE registration_no = :registrationNo', {
      registrationNo,
      passwordHash,
    });
    return {
      registrationNo,
      plainPassword,
      action: 'updated',
    };
  }

  await query(
    'INSERT INTO users (registration_no, password_hash) VALUES (:registrationNo, :passwordHash)',
    {
      registrationNo,
      passwordHash,
    },
  );

  return {
    registrationNo,
    plainPassword,
    action: 'created',
  };
}

async function main() {
  const results = [];
  for (const registrationNo of DEMO_REGISTRATION_NOS) {
    // eslint-disable-next-line no-await-in-loop
    const row = await createOrUpdateUser(registrationNo);
    results.push(row);
  }

  console.log('示例账号已准备：');
  for (const row of results) {
    console.log(`- ${row.registrationNo} / ${row.plainPassword} (${row.action})`);
  }
}

main()
  .catch((error) => {
    console.error('示例账号初始化失败：', error.message);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
