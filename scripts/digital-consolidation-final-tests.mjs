import {readdir,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const selected=[...(await readdir('tests/digital')).filter(f=>f.endsWith('.test.ts')).map(f=>`tests/digital/${f}`),
  'tests/media/storage.test.ts','tests/billing/domain.test.ts','tests/billing/address-presentation.test.ts',
  'tests/auth/login-hydration-security.test.ts','tests/auth/origin.test.ts','tests/auth/roles.test.ts','tests/auth/redirect.test.ts',
  'tests/support/disabled-release.test.ts','tests/support/live-boundaries.test.ts','tests/shop/legal.test.ts','tests/shop/payment-domain.test.ts',
  'tests/shop/external-products.test.ts','tests/security/csp-nonce.test.ts','tests/rights/security.test.ts'];
const result=spawnSync(process.execPath,['--conditions=react-server','--import','tsx','--test','--test-reporter=tap',...selected],{encoding:'utf8',maxBuffer:4*1024*1024,timeout:120000});
await mkdir('output/dcn-consolidation',{recursive:true});await writeFile('output/dcn-consolidation/targeted-tests.tap',result.stdout+result.stderr);
const count=label=>Number((result.stdout.match(new RegExp(`^# ${label} (\\d+)$`,'m'))??[])[1]??0);
const proof={environment:'LOCAL_UNIT_PGLITE_FFMPEG_PROVIDER_DOUBLES_NOT_EXTERNAL_RECIPES',command:'node --conditions=react-server --import tsx --test --test-reporter=tap <selected files>',files:selected,tests:count('tests'),pass:count('pass'),fail:count('fail'),skipped:count('skipped'),exitCode:result.status};
await writeFile('output/dcn-consolidation/targeted-tests.json',JSON.stringify(proof,null,2));console.log(JSON.stringify({...proof,files:selected.length}));process.exitCode=result.status??1;
