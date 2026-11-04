// Cross-platform runner for `npm run sim:cantor` (Windows cmd / PowerShell, Linux, macOS).
// Sets CANTOR_REPORT so tests/cantorSim.test.ts prints the full fight report, then runs that
// test file through the Vitest Node API (no `VAR=1 cmd` shell syntax, no extra dependency).
import { startVitest } from 'vitest/node';

process.env.CANTOR_REPORT = '1';
const vitest = await startVitest('test', ['tests/cantorSim.test.ts'], { run: true, watch: false, silent: false });
const failed = !vitest || vitest.state.getCountOfFailedTests() > 0;
await vitest?.close();
process.exit(failed ? 1 : 0);
