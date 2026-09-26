import { fileURLToPath } from "node:url";
export const binaryPath = fileURLToPath(
  new URL("./bin/telegram-bot-api", import.meta.url),
);
export default binaryPath;
