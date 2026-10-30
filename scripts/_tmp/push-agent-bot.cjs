/**
 * 通过密码 SSH 更新机器人服务器上的 Agent
 * 用法：node push-agent-bot.cjs <host> <port> <password> <localAgentPath>
 */
const fs = require('node:fs');
const { Client } = require('ssh2');

const [host, portArg, password, localPath] = process.argv.slice(2);
const port = Number(portArg || 22);
if (!host || !password || !localPath) {
    console.error('用法: node push-agent-bot.cjs <host> <port> <password> <localAgentPath>');
    process.exit(2);
}
const content = fs.readFileSync(localPath, 'utf8');

const conn = new Client();
conn.on('ready', () => {
    conn.sftp((err, sftp) => {
        if (err) {
            console.error('SFTP 失败:', err.message);
            return conn.end();
        }
        const ws = sftp.createWriteStream('/opt/xuanjian-agent/agent.js');
        ws.on('close', () => {
            console.log('文件已上传，正在重启服务…');
            conn.exec('node --check /opt/xuanjian-agent/agent.js && systemctl restart xuanjian-agent && sleep 2 && systemctl is-active xuanjian-agent && tail -3 /var/log/xuanjian-agent.log', (e2, stream) => {
                if (e2) {
                    console.error('执行失败:', e2.message);
                    conn.end();
                    return;
                }
                stream
                    .on('close', () => conn.end())
                    .on('data', (d) => process.stdout.write(d.toString()))
                    .stderr.on('data', (d) => process.stderr.write(d.toString()));
            });
        });
        ws.on('error', (e) => {
            console.error('写入失败:', e.message);
            conn.end();
        });
        ws.end(content);
    });
});
conn.on('error', (e) => {
    console.error('连接失败:', e.message);
    process.exit(1);
});
conn.connect({ host, port, username: 'root', password, readyTimeout: 20000 });
