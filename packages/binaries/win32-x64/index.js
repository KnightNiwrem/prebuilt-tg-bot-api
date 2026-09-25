import { fileURLToPath } from "node:url";
export const binaryPath = fileURLToPath(
  new URL("./bin/telegram-bot-api.exe", import.meta.url),
);
export default binaryPath;
