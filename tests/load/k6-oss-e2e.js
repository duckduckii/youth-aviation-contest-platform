import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const USER_START = __ENV.USER_START || '202699990001';
const USER_COUNT = Number(__ENV.USER_COUNT || 300);
const PASSWORD_MODE = (__ENV.PASSWORD_MODE || 'last8').toLowerCase();
const FIXED_PASSWORD = __ENV.FIXED_PASSWORD || 'LoadTest@123';
const THINK_TIME = Number(__ENV.THINK_TIME || 0.2);
const FINAL_SUBMIT = String(__ENV.FINAL_SUBMIT || 'false').toLowerCase() === 'true';
const INCLUDE_OPTIONAL_VIDEO = String(__ENV.INCLUDE_OPTIONAL_VIDEO || 'false').toLowerCase() === 'true';
const VUS = Number(__ENV.VUS || 50);
const PER_VU_ITERS = Number(__ENV.PER_VU_ITERS || 1);
const REPORT_PDF_BODY = open('./fixtures/load-test-report.pdf', 'b');
const PROOF1_PDF_BODY = open('./fixtures/load-test-proof1.pdf', 'b');
const INTEGRITY_PDF_BODY = open('./fixtures/load-test-integrity.pdf', 'b');
const PROOF2_VIDEO_BODY = open('./fixtures/load-test-proof2.mp4', 'b');

export const options = {
  scenarios: {
    default: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: PER_VU_ITERS,
      maxDuration: __ENV.MAX_DURATION || '10m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1500'],
  },
};

function buildRegistrationNo(index) {
  return String(BigInt(USER_START) + BigInt(index % USER_COUNT));
}

function passwordFor(registrationNo) {
  if (PASSWORD_MODE === 'fixed') {
    return FIXED_PASSWORD;
  }
  return String(registrationNo).slice(-8);
}

function pickUser() {
  const index = exec.vu.idInTest - 1;
  const registrationNo = buildRegistrationNo(index);
  return {
    registrationNo,
    password: passwordFor(registrationNo),
  };
}

function bodyIncludes(response, text) {
  return typeof response.body === 'string' && response.body.includes(text);
}

function bodySize(body) {
  if (body && typeof body.byteLength === 'number') return body.byteLength;
  if (body && typeof body.length === 'number') return body.length;
  return 0;
}

function signFile(fieldKey, fileName, contentType, size) {
  const response = http.post(
    `${BASE_URL}/api/uploads/sign`,
    JSON.stringify({
      fieldKey,
      fileName,
      contentType,
      size,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    },
  );

  const ok = check(response, {
    [`${fieldKey} sign status is 200`]: (res) => res.status === 200,
  });

  if (!ok) {
    return null;
  }

  return response.json();
}

function putToOss(signData, body, contentType, fieldKey) {
  const response = http.put(signData.uploadUrl, body, {
    headers: signData.headers || {
      'Content-Type': contentType,
    },
    redirects: 0,
  });

  const ok = check(response, {
    [`${fieldKey} upload success`]: (res) => res.status >= 200 && res.status < 300,
  });

  if (!ok) {
    return false;
  }

  return true;
}

export default function () {
  const user = pickUser();

  const loginResponse = http.post(
    `${BASE_URL}/login`,
    {
      registrationNo: user.registrationNo,
      password: user.password,
    },
    {
      redirects: 10,
    },
  );

  check(loginResponse, {
    'login success': (res) => res.status === 200
      && (bodyIncludes(res, '请选择比赛方向') || bodyIncludes(res, '创新设计类作品提交')),
  });

  sleep(THINK_TIME);

  const selectResponse = http.post(
    `${BASE_URL}/select-direction`,
    {
      direction: 'INNOVATION',
    },
    {
      redirects: 10,
    },
  );

  check(selectResponse, {
    'select-direction success': (res) => res.status === 200
      && bodyIncludes(res, '创新设计类作品提交'),
  });

  sleep(THINK_TIME);

  const innovationResponse = http.get(`${BASE_URL}/innovation`);
  check(innovationResponse, {
    'innovation page success': (res) => res.status === 200
      && bodyIncludes(res, '作品题目'),
  });

  const payload = {};
  const files = [
    {
      fieldKey: 'report',
      fileName: 'load-test-report.pdf',
      contentType: 'application/pdf',
      body: REPORT_PDF_BODY,
    },
    {
      fieldKey: 'proof1',
      fileName: 'load-test-proof1.pdf',
      contentType: 'application/pdf',
      body: PROOF1_PDF_BODY,
    },
    {
      fieldKey: 'integrity',
      fileName: 'load-test-integrity.pdf',
      contentType: 'application/pdf',
      body: INTEGRITY_PDF_BODY,
    },
  ];

  if (INCLUDE_OPTIONAL_VIDEO) {
    files.push({
      fieldKey: 'proof2',
      fileName: 'load-test-proof2.mp4',
      contentType: 'video/mp4',
      body: PROOF2_VIDEO_BODY,
    });
  }

  for (const file of files) {
    const fileSize = bodySize(file.body);
    const signData = signFile(file.fieldKey, file.fileName, file.contentType, fileSize);
    if (!signData) {
      return;
    }

    const uploaded = putToOss(signData, file.body, file.contentType, file.fieldKey);
    if (!uploaded) {
      return;
    }

    payload[file.fieldKey] = {
      objectKey: signData.objectKey,
      originalName: signData.originalName || file.fileName,
      storedName: signData.storedName,
      size: fileSize,
      contentType: file.contentType,
    };

    sleep(THINK_TIME);
  }

  const action = FINAL_SUBMIT ? 'submit' : 'save';
  const saveResponse = http.post(
    `${BASE_URL}/innovation`,
    {
      action,
      workTitle: `压测作品-${user.registrationNo}`,
      uploadedFilesPayload: JSON.stringify(payload),
    },
    {
      redirects: 10,
    },
  );

  check(saveResponse, {
    'innovation form submit success': (res) => res.status === 200
      && (FINAL_SUBMIT
        ? bodyIncludes(res, '材料已最终提交')
        : bodyIncludes(res, '草稿已保存')),
  });
}
