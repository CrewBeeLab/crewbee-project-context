import { validateContext } from "../dist/src/index.js";

const result = await validateContext(process.cwd());
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
