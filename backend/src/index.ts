import "dotenv/config";
import { createApp } from "./app";

const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:3000";
const { server } = createApp(FRONTEND_URL);

const PORT = Number(process.env.PORT ?? 4000);
server.listen(PORT, () => {
  console.log(`Fluxo backend rodando em http://localhost:${PORT}`);
});
