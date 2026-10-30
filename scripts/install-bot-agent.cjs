/**
 * 通过密码 SSH 在机器人服务器上安装监控 Agent
 * 用法：node install-bot-agent.cjs <host> <port> <password> <token>
 */
const { Client } = require('ssh2');

const host = process.argv[2];
const port = Number(process.argv[3] || 22);
const password = process.argv[4];
const token = process.argv[5];

if (!host || !password || !token) {
    console.error('用法: node install-bot-agent.cjs <host> <port> <password> <token>');
    process.exit(2);
}

const cmd = `curl -fsSL https://monitor.xuanjian.top/install/agent.sh -o /tmp/agent.sh && bash /tmp/agent.sh --master https://monitor.xuanjian.top --token ${token}`;

const conn = new Client();
conn.on('ready', () => {
    console.log('SSH 已连接，开始安装…');
    conn.exec(cmd, (err, stream) => {
        if (err) {
            console.error('执行失败:', err.message);
            conn.end();
            process.exit(1);
        }
        stream
            .on('close', (code) => {
                console.log(`\n退出码: ${code}`);
                conn.end();
                process.exit(code === 0 ? 0 : 1);
            })
            .on('data', (d) => process.stdout.write(d.toString()))
            .stderr.on('data', (d) => process.stderr.write(d.toString()));
    });
});
conn.on('error', (e) => {
    console.error('连接失败:', e.message);
    process.exit(1);
});
conn.connect({ host, port, username: 'root', password, readyTimeout: 20000 });
