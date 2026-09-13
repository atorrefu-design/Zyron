import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const port = 3020;
const base = `http://127.0.0.1:${port}`;
process.env.NO_PROXY = 'localhost,127.0.0.1';
process.env.no_proxy = 'localhost,127.0.0.1';
const fetchWithTimeout = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
  detached: true,
  env: { ...process.env, ZYRON_OWNER_KEY:'local-verification-only', ZYRON_AUTH_SECRET:'local-verification-secret', DATABASE_URL:'', POSTGRES_URL:'', OPENAI_API_KEY:'', AI_GATEWAY_API_KEY:'', GEMINI_API_KEY:'', ZYRON_LOCAL_BASE_URL:'', ZYRON_LOCAL_MODEL:'', NEXT_TELEMETRY_DISABLED:'1' },
  stdio: ['ignore','pipe','pipe'],
});
let logs = '';
try {
  await new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(new Error('Development server did not start')), 30000);
    const collect = (d) => { logs += d; if (logs.includes('Ready in')) { clearTimeout(timer); resolve(); } };
    server.stdout.on('data',collect); server.stderr.on('data',collect);
    server.on('exit',code => { clearTimeout(timer); reject(new Error(`Development server exited ${code}`)); });
  });
  const unauth = await fetchWithTimeout(base+'/api/agent', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:'Hola'})});
  assert.equal(unauth.status,401);
  const login = await fetchWithTimeout(base+'/api/auth/login', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:'local-verification-only'})});
  assert.equal(login.status,200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = {'content-type':'application/json',cookie};
  for (const route of ['/api/agent','/api/act']) {
    const response = await fetchWithTimeout(base+route,{method:'POST',headers,body:JSON.stringify({text:'Explique la relatividad',allowAI:false})});
    const data = await response.json();
    assert.equal(response.status,200);assert.equal(data.action,'ai_disabled');assert.equal(data.creditsUsed,false);
    console.log(`${route}: refuses generative execution with no model credentials`);
  }
  const invalid = await fetchWithTimeout(base+'/api/memory',{method:'PATCH',headers,body:JSON.stringify({id:'test',expectedContent:'before',content:''})});
  assert.equal(invalid.status,400);
  for (const route of ['/','/connections','/memory']) {
    const response = await fetchWithTimeout(base+route,{headers});
    assert.equal(response.status,200); const html = await response.text(); assert.ok(html.includes('ZYRON'));
    if (route === '/' && process.env.ZYRON_VISUAL_SNAPSHOT) {
      const css = await readFile('app/globals.css','utf8');
      const staticHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'').replace('</head>',`<style>${css}</style></head>`);
      await writeFile(process.env.ZYRON_VISUAL_SNAPSHOT,staticHtml);
    }
    console.log(`${route}: authenticated server rendering passed`);
  }
  console.log('Anonymous access blocked; invalid memory edit rejected before storage. No production data used.');
} catch (error) {
  console.error(error); console.error(logs.slice(-4000)); process.exitCode=1;
} finally {
  try { process.kill(-server.pid,'SIGTERM'); } catch {}
}
