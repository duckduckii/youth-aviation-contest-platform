const cluster = require('cluster');
const os = require('os');

const config = require('./config');

function resolveWorkerCount() {
  if (config.app.workers > 0) {
    return config.app.workers;
  }

  if (typeof os.availableParallelism === 'function') {
    return Math.max(1, Math.min(os.availableParallelism(), 8));
  }

  return Math.max(1, Math.min(os.cpus().length, 8));
}

async function startWorker() {
  const { startServer } = require('./server');
  await startServer();
}

if (cluster.isPrimary) {
  const workerCount = resolveWorkerCount();
  console.log(`主进程已启动，准备拉起 ${workerCount} 个 worker`);

  for (let index = 0; index < workerCount; index += 1) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.error(`worker 退出 pid=${worker.process.pid} code=${code} signal=${signal || '-'}`);
    cluster.fork();
  });
} else {
  startWorker().catch((error) => {
    console.error(`worker 启动失败 pid=${process.pid}：${error.message}`);
    process.exit(1);
  });
}
