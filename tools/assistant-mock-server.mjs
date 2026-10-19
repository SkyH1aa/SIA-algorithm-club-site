#!/usr/bin/env node
// Assistant-focused launcher for browser validation. It reuses the standalone offline mock.
import {createMockServer} from './chat-mock-server.mjs';
const portArgument = process.argv.indexOf('--port');
const port = portArgument < 0 ? 4193 : Number(process.argv[portArgument + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid --port (1024..65535)');
const server = createMockServer({assistantMode:true});
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Assistant mock port ${port} is already in use.` : error); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`ASSISTANT MOCK ONLY — http://localhost:${port}/assistant-fixtures\nLauncher: http://localhost:${port}/launcher-host.html\nWorkspace: http://localhost:${port}/assistant.html\nNo upstream calls or credentials. Ctrl+C to stop.`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
