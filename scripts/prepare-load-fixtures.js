const fs = require('fs');
const path = require('path');

function intFromEnv(key, defaultValue) {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? defaultValue : value;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFile(filePath, buffer) {
  fs.writeFileSync(filePath, buffer);
  return fs.statSync(filePath).size;
}

function createPdfBuffer(targetSize, label) {
  const minimumSize = 1024;
  const size = Math.max(targetSize, minimumSize);
  const header = Buffer.from(
    `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 5 0 R >>
stream
BT
/F1 18 Tf
72 780 Td
(${label}) Tj
0 -24 Td
`,
    'utf8',
  );
  const footer = Buffer.from(
    `ET
endstream
endobj
5 0 obj
${Math.max(64, size - header.length)} 
endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000070 00000 n 
0000000135 00000 n 
0000000221 00000 n 
0000000000 00000 n 
trailer
<< /Root 1 0 R /Size 6 >>
startxref
0
%%EOF
`,
    'utf8',
  );

  const bodySize = Math.max(size - header.length - footer.length, 0);
  const line = Buffer.from(`${label} load test content line 0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ\n`, 'utf8');
  const chunks = [header];
  let written = 0;

  while (written < bodySize) {
    const remaining = bodySize - written;
    chunks.push(remaining >= line.length ? line : line.subarray(0, remaining));
    written += Math.min(line.length, remaining);
  }

  chunks.push(footer);
  return Buffer.concat(chunks);
}

function createMp4Buffer(targetSize) {
  const minimumSize = 2048;
  const size = Math.max(targetSize, minimumSize);
  const buffer = Buffer.alloc(size, 0);
  const ftyp = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
    0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31,
  ]);
  const free = Buffer.from([
    0x00, 0x00, 0x00, 0x08, 0x66, 0x72, 0x65, 0x65,
  ]);
  const mdatHeader = Buffer.from([
    0x00, 0x00, 0x00, 0x08, 0x6d, 0x64, 0x61, 0x74,
  ]);

  ftyp.copy(buffer, 0);
  free.copy(buffer, ftyp.length);
  mdatHeader.copy(buffer, ftyp.length + free.length);

  const pattern = Buffer.from('LOADTEST-MP4-FRAME-DATA-', 'utf8');
  for (let offset = ftyp.length + free.length + mdatHeader.length; offset < size; offset += pattern.length) {
    pattern.copy(buffer, offset, 0, Math.min(pattern.length, size - offset));
  }

  return buffer;
}

function formatBytes(value) {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(2)} KB`;
  return `${value} B`;
}

function main() {
  const fixtureDir = process.env.LOAD_FIXTURE_DIR
    || path.join(process.cwd(), 'tests', 'load', 'fixtures');

  const sizes = {
    report: intFromEnv('LOAD_FIXTURE_REPORT_BYTES', 512 * 1024),
    proof1: intFromEnv('LOAD_FIXTURE_PROOF1_BYTES', 256 * 1024),
    integrity: intFromEnv('LOAD_FIXTURE_INTEGRITY_BYTES', 256 * 1024),
    video: intFromEnv('LOAD_FIXTURE_VIDEO_BYTES', 2 * 1024 * 1024),
  };

  ensureDir(fixtureDir);

  const files = [
    {
      path: path.join(fixtureDir, 'load-test-report.pdf'),
      buffer: createPdfBuffer(sizes.report, 'Innovation Report Fixture'),
    },
    {
      path: path.join(fixtureDir, 'load-test-proof1.pdf'),
      buffer: createPdfBuffer(sizes.proof1, 'Proof Material Fixture'),
    },
    {
      path: path.join(fixtureDir, 'load-test-integrity.pdf'),
      buffer: createPdfBuffer(sizes.integrity, 'Integrity Commitment Fixture'),
    },
    {
      path: path.join(fixtureDir, 'load-test-proof2.mp4'),
      buffer: createMp4Buffer(sizes.video),
    },
  ];

  console.log(`准备压测素材目录: ${fixtureDir}`);
  for (const file of files) {
    const written = writeFile(file.path, file.buffer);
    console.log(`已生成 ${path.basename(file.path)} (${formatBytes(written)})`);
  }
}

main();
