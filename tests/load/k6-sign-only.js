import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const USER_START = __ENV.USER_START || '202699990001';
const USER_COUNT = Number(__ENV.USER_COUNT || 1000);
const PASSWORD_MODE = (__ENV.PASSWORD_MODE || 'last8').toLowerCase();
const FIXED_PASSWORD = __ENV.FIXED_PASSWORD || 'LoadTest@123';
const THINK_TIME = Number(__ENV.THINK_TIME || 0.3);
const INCLUDE_OPTIONAL_VIDEO = String(__ENV.INCLUDE_OPTIONAL_VIDEO || 'false').toLowerCase() === 'true';
const VUS = Number(__ENV.VUS || 100);
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
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
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
      redirects: 0,
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

  sleep(THINK_TIME);

  signFile('report', 'load-test-report.pdf', 'application/pdf', bodySize(REPORT_PDF_BODY));
  signFile('proof1', 'load-test-proof1.pdf', 'application/pdf', bodySize(PROOF1_PDF_BODY));
  signFile('integrity', 'load-test-integrity.pdf', 'application/pdf', bodySize(INTEGRITY_PDF_BODY));

  if (INCLUDE_OPTIONAL_VIDEO) {
    signFile('proof2', 'load-test-proof2.mp4', 'video/mp4', bodySize(PROOF2_VIDEO_BODY));
  }
}
