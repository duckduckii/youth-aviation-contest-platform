const { query, pool } = require('../src/db');
const { hashPassword } = require('../src/utils/password');

const DEMO_REGISTRATION_NOS = Array.from({ length: 100 }, (_, index) => {
  const suffix = `${index + 1}`.padStart(4, '0');
  return `20260001${suffix}`;
});
const ADMIN_ACCOUNT = {
  registrationNo: 'admin',
  plainPassword: 'admin',
};
const FLOW_TEST_ACCOUNT = {
  registrationNo: 'test',
  plainPassword: 'test',
};

function initialPassword(registrationNo) {
  const value = String(registrationNo);
  return value.slice(-8);
}

async function createOrUpdateUser(registrationNo, explicitPassword = null) {
  const rows = await query('SELECT id FROM users WHERE registration_no = :registrationNo LIMIT 1', {
    registrationNo,
  });

  const plainPassword = explicitPassword || initialPassword(registrationNo);
  const passwordHash = await hashPassword(plainPassword);

  if (rows[0]) {
    await query('UPDATE users SET password_hash = :passwordHash, direction = NULL WHERE registration_no = :registrationNo', {
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

async function resetSubmission(registrationNo) {
  await query(
    `DELETE s
     FROM submissions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE u.registration_no = :registrationNo`,
    { registrationNo },
  );
}

async function main() {
  const results = [];
  for (const registrationNo of DEMO_REGISTRATION_NOS) {
    // eslint-disable-next-line no-await-in-loop
    const row = await createOrUpdateUser(registrationNo);
    // eslint-disable-next-line no-await-in-loop
    await resetSubmission(registrationNo);
    results.push(row);
  }

  const adminRow = await createOrUpdateUser(ADMIN_ACCOUNT.registrationNo, ADMIN_ACCOUNT.plainPassword);
  await resetSubmission(ADMIN_ACCOUNT.registrationNo);
  results.push(adminRow);

  const testRow = await createOrUpdateUser(FLOW_TEST_ACCOUNT.registrationNo, FLOW_TEST_ACCOUNT.plainPassword);
  await resetSubmission(FLOW_TEST_ACCOUNT.registrationNo);
  results.push(testRow);

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
