const fs = require('fs');
const path = require('path');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function metricValue(metrics, metricName, key) {
  const metric = metrics[metricName];
  if (!metric) return undefined;
  if (metric[key] !== undefined) return metric[key];
  if (key === 'rate' && metric.value !== undefined) return metric.value;
  return undefined;
}

function formatNumber(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  if (Math.abs(value) >= 100) return value.toFixed(1);
  if (Math.abs(value) >= 10) return value.toFixed(2);
  return value.toFixed(3);
}

function formatMs(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return `${formatNumber(value)} ms`;
}

function formatPercent(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return `${(value * 100).toFixed(2)}%`;
}

function typeLabel(value) {
  switch (value) {
    case 'baseline':
      return '基线测试：登录、选赛道、进入创新页、签名，不真实上传 OSS';
    case 'oss-save':
      return '完整链路测试：登录、签名、上传 OSS、保存草稿';
    case 'oss-submit':
      return '完整链路测试：登录、签名、上传 OSS、最终提交';
    default:
      return value;
  }
}

function padRight(value, width) {
  return String(value).padEnd(width, ' ');
}

function padLeft(value, width) {
  return String(value).padStart(width, ' ');
}

function divider(width) {
  return `+${'-'.repeat(width - 2)}+`;
}

function boxLine(left, label, right, width) {
  const content = `${left}${label}${right}`;
  return `| ${padRight(content, width - 4)} |`;
}

function buildThresholdRows(metrics) {
  const rows = [];

  for (const [metricName, metric] of Object.entries(metrics)) {
    const thresholds = metric?.thresholds;
    if (!thresholds || typeof thresholds !== 'object') continue;

    for (const [rule, raw] of Object.entries(thresholds)) {
      const passed = evaluateThreshold(metric, rule, raw);
      rows.push([
        metricName,
        rule,
        passed ? 'PASS' : 'FAIL',
      ]);
    }
  }

  return rows;
}

function buildMetricRows(metrics) {
  const names = [
    'http_req_duration',
    'http_req_failed',
    'http_reqs',
    'iteration_duration',
    'iterations',
    'checks',
    'vus',
    'vus_max',
    'data_sent',
    'data_received',
  ];

  return names
    .filter((name) => metrics[name])
    .map((name) => {
      const values = Object.entries(metrics[name] || {})
        .filter(([key]) => key !== 'thresholds');
      const compact = values
        .map(([key, value]) => `${key}=${formatNumber(value)}`)
        .join(', ');
      return [name, '-', compact || '-'];
    });
}

function evaluateThreshold(metric, rule, raw) {
  const match = String(rule).match(/^(.+?)(<=|>=|<|>)(.+)$/);
  if (!match) {
    return typeof raw === 'boolean' ? raw : Boolean(raw?.ok);
  }

  const [, left, operator, rightRaw] = match;
  const leftKey = left.trim();
  const thresholdValue = Number(rightRaw.trim());
  let metricValueRaw = metric?.[leftKey];
  if (metricValueRaw === undefined && leftKey === 'rate' && metric?.value !== undefined) {
    metricValueRaw = metric.value;
  }

  if (typeof metricValueRaw !== 'number' || Number.isNaN(metricValueRaw) || Number.isNaN(thresholdValue)) {
    return typeof raw === 'boolean' ? raw : Boolean(raw?.ok);
  }

  switch (operator) {
    case '<':
      return metricValueRaw < thresholdValue;
    case '<=':
      return metricValueRaw <= thresholdValue;
    case '>':
      return metricValueRaw > thresholdValue;
    case '>=':
      return metricValueRaw >= thresholdValue;
    default:
      return false;
  }
}

function renderTable(headers, rows) {
  const widths = headers.map((header, index) => {
    const rowWidth = rows.reduce((max, row) => Math.max(max, String(row[index] || '').length), 0);
    return Math.max(String(header).length, rowWidth);
  });

  const border = `+${widths.map((width) => '-'.repeat(width + 2)).join('+')}+`;
  const headerLine = `|${headers.map((header, index) => ` ${padRight(header, widths[index])} `).join('|')}|`;
  const body = rows.map((row) => `|${row.map((cell, index) => ` ${padRight(cell, widths[index])} `).join('|')}|`).join('\n');

  return [border, headerLine, border, body || `| ${padRight('No data', widths.reduce((sum, width) => sum + width + 3, -3))} |`, border]
    .filter(Boolean)
    .join('\n');
}

function findThresholdLimit(metrics, metricName, leftKey) {
  const thresholds = metrics[metricName]?.thresholds;
  if (!thresholds) return undefined;
  const entry = Object.keys(thresholds).find((rule) => rule.startsWith(`${leftKey}<`));
  if (!entry) return undefined;
  const value = Number(entry.split('<').pop());
  return Number.isNaN(value) ? undefined : value;
}

function buildNarrative({ title, num, metrics, failedRate, checksPassRate, p95, iterationP95 }) {
  const reqP95Limit = findThresholdLimit(metrics, 'http_req_duration', 'p(95)');
  const failRateLimit = findThresholdLimit(metrics, 'http_req_failed', 'rate');
  const allChecksPassed = typeof checksPassRate === 'number' && checksPassRate >= 1;
  const noHttpErrors = typeof failedRate === 'number' && failedRate === 0;
  const reqDurationPass = typeof p95 === 'number' && typeof reqP95Limit === 'number' ? p95 < reqP95Limit : true;
  const failRatePass = typeof failedRate === 'number' && typeof failRateLimit === 'number' ? failedRate < failRateLimit : true;

  let verdict = '功能通过，性能达标';
  let plain = `这次模拟了 ${num} 个并发用户，功能和时延都在预期范围内。`;

  if ((!allChecksPassed || !noHttpErrors) && !reqDurationPass) {
    verdict = '功能和性能都存在风险';
    plain = `这次模拟了 ${num} 个并发用户，业务链路不是全部成功，同时响应时间也偏慢，不适合直接扩大流量。`;
  } else if (!allChecksPassed || !noHttpErrors || !failRatePass) {
    verdict = '功能存在风险';
    plain = `这次模拟了 ${num} 个并发用户，出现了业务失败或 HTTP 错误，需要先修复稳定性问题。`;
  } else if (!reqDurationPass) {
    verdict = '功能通过，但性能未达标';
    plain = `这次模拟了 ${num} 个并发用户，流程都能走通，但高位响应时间已经超过目标，继续放大并发前建议先优化。`;
  }

  const findings = [
    `测试类型：${typeLabel(title)}`,
    `并发用户数：${num}`,
    `HTTP 错误率：${formatPercent(failedRate)}${typeof failRateLimit === 'number' ? `，目标低于 ${(failRateLimit * 100).toFixed(2)}%` : ''}`,
    `请求 P95：${formatMs(p95)}${typeof reqP95Limit === 'number' ? `，目标低于 ${formatMs(reqP95Limit)}` : ''}`,
    `单个用户流程 P95：${formatMs(iterationP95)}`,
    `业务检查通过率：${formatPercent(checksPassRate)}`,
  ];

  const suggestions = [];
  if (!allChecksPassed || !noHttpErrors) {
    suggestions.push('先排查登录态、重定向、保存接口和 OSS 上传是否有业务失败。');
  }
  if (!reqDurationPass) {
    if (title === 'baseline') {
      suggestions.push('优先看 MySQL 连接池、Redis Session、登录和签名接口时延。');
    } else {
      suggestions.push('优先看 OSS PUT/HEAD、/innovation 保存提交、MySQL 更新和 Redis Session。');
    }
  }
  if (suggestions.length === 0) {
    suggestions.push('可以继续把并发从当前规模逐步提高，再观察 P95 和错误率。');
  }

  return { verdict, plain, findings, suggestions };
}

function buildTextReport({ title, num, summary }) {
  const metrics = summary.metrics || {};
  const failedRate = metricValue(metrics, 'http_req_failed', 'rate') || 0;
  const p95 = metricValue(metrics, 'http_req_duration', 'p(95)');
  const p90 = metricValue(metrics, 'http_req_duration', 'p(90)');
  const avg = metricValue(metrics, 'http_req_duration', 'avg');
  const reqs = metricValue(metrics, 'http_reqs', 'count');
  const iterations = metricValue(metrics, 'iterations', 'count');
  const vus = metricValue(metrics, 'vus_max', 'value') || metricValue(metrics, 'vus', 'max');
  const iterationP95 = metricValue(metrics, 'iteration_duration', 'p(95)');
  const checksPassRate = metricValue(metrics, 'checks', 'value');
  const narrative = buildNarrative({
    title,
    num,
    metrics,
    failedRate,
    checksPassRate,
    p95,
    iterationP95,
  });

  const width = 84;
  const lines = [];

  lines.push(divider(width));
  lines.push(boxLine('', `TEST REPORT: ${title}`, '', width));
  lines.push(divider(width));
  lines.push(boxLine('', `结论: ${narrative.verdict}`, '', width));
  lines.push(boxLine('', narrative.plain, '', width));
  lines.push(divider(width));
  lines.push('');
  lines.push('你最需要关注的结论');
  narrative.findings.forEach((item, index) => {
    lines.push(`${index + 1}. ${item}`);
  });
  lines.push('');
  lines.push('建议动作');
  narrative.suggestions.forEach((item, index) => {
    lines.push(`${index + 1}. ${item}`);
  });
  lines.push('');
  lines.push(divider(width));
  lines.push(boxLine('', `LOAD TEST DASHBOARD: ${title}`, '', width));
  lines.push(divider(width));
  lines.push(boxLine('', `HTTP Requests    : ${formatNumber(reqs)}`, '', width));
  lines.push(boxLine('', `Iterations       : ${formatNumber(iterations)}`, '', width));
  lines.push(boxLine('', `Peak VUs         : ${formatNumber(vus)}`, '', width));
  lines.push(boxLine('', `HTTP Failed Rate : ${formatPercent(failedRate)}`, '', width));
  lines.push(boxLine('', `HTTP Avg         : ${formatMs(avg)}`, '', width));
  lines.push(boxLine('', `HTTP P90         : ${formatMs(p90)}`, '', width));
  lines.push(boxLine('', `HTTP P95         : ${formatMs(p95)}`, '', width));
  lines.push(boxLine('', `Iteration P95    : ${formatMs(iterationP95)}`, '', width));
  lines.push(boxLine('', `Checks Pass Rate : ${formatPercent(checksPassRate)}`, '', width));
  lines.push(divider(width));
  lines.push('');
  lines.push('THRESHOLDS');
  lines.push(renderTable(
    ['Metric', 'Rule', 'Status'],
    buildThresholdRows(metrics),
  ));
  lines.push('');
  lines.push('KEY METRICS');
  lines.push(renderTable(
    ['Metric', 'Type', 'Values'],
    buildMetricRows(metrics),
  ));

  return `${lines.join('\n')}\n`;
}

function main() {
  const summaryPath = process.argv[2];
  const outputPath = process.argv[3];
  const title = process.argv[4] || 'Load Test';
  const num = process.argv[5] || '-';

  if (!summaryPath || !outputPath) {
    console.error('Usage: node scripts/generate-load-report-text.js <summary.json> <report.txt> [title] [num]');
    process.exit(1);
  }

  const summary = readJson(summaryPath);
  const report = buildTextReport({ title, num, summary });
  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, report, 'utf8');
  process.stdout.write(report);
}

main();
