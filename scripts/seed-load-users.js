const { query, pool } = require('../src/db');
const { hashPassword } = require('../src/utils/password');

function intFromEnv(key, defaultValue) {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? defaultValue : value;
}

const LOAD_USER_COUNT = intFromEnv('LOAD_USER_COUNT', 1000);
const LOAD_USER_START = process.env.LOAD_USER_START || '202699990001';
const PASSWORD_MODE = (process.env.LOAD_USER_PASSWORD_MODE || 'last8').toLowerCase();
const FIXED_PASSWORD = process.env.LOAD_USER_FIXED_PASSWORD || 'LoadTest@123';

function buildRegistrationNo(index) {
  return String(BigInt(LOAD_USER_START) + BigInt(index));
}

function resolvePlainPassword(registrationNo) {
  if (PASSWORD_MODE === 'fixed') {
    return FIXED_PASSWORD;
  }
  const value = String(registrationNo);
  return value.slice(-8);
}

async function createOrResetUser(registrationNo) {
  const rows = await query('SELECT id FROM users WHERE registration_no = :registrationNo LIMIT 1', {
    registrationNo,
  });

  const plainPassword = resolvePlainPassword(registrationNo);
  const passwordHash = await hashPassword(plainPassword);

  if (rows[0]) {
    await query(
      'UPDATE users SET password_hash = :passwordHash, direction = NULL WHERE registration_no = :registrationNo',
      {
        registrationNo,
        passwordHash,
      },
    );
  } else {
    await query(
      'INSERT INTO users (registration_no, password_hash, direction) VALUES (:registrationNo, :passwordHash, NULL)',
      {
        registrationNo,
        passwordHash,
      },
    );
  }

  await query(
    `DELETE s
     FROM submissions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE u.registration_no = :registrationNo`,
    { registrationNo },
  );

  return {
    registrationNo,
    plainPassword,
    existed: Boolean(rows[0]),
  };
}

async function main() {
  console.log(`开始准备压测账号，共 ${LOAD_USER_COUNT} 个`);
  console.log(`起始报名号：${LOAD_USER_START}`);
  console.log(`密码模式：${PASSWORD_MODE}`);

  let created = 0;
  let updated = 0;

  for (let index = 0; index < LOAD_USER_COUNT; index += 1) {
    const registrationNo = buildRegistrationNo(index);
    // eslint-disable-next-line no-await-in-loop
    const result = await createOrResetUser(registrationNo);
    if (result.existed) {
      updated += 1;
    } else {
      created += 1;
    }
  }

  console.log(`压测账号已准备完成：created=${created}, updated=${updated}`);
  const sampleRegistrationNo = buildRegistrationNo(0);
  console.log(`示例账号：${sampleRegistrationNo} / ${resolvePlainPassword(sampleRegistrationNo)}`);
}

main()
  .catch((error) => {
    console.error('压测账号准备失败：', error.message);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
