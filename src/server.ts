import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { startJobs } from "./server/jobs/boss";

startJobs()?.catch((error) => console.error("[jobs] failed to start", error));

export default createServerEntry({
  fetch(request) {
    return handler.fetch(request);
  },
});
