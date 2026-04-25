import { ProjectContextService } from "../dist/src/service/project-context-service.js";

const result = await new ProjectContextService(process.cwd()).validateContext();
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
