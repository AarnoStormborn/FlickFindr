import pino from "pino";
import { config } from "./config.js";

/** Shared application logger (service layer + scripts). */
export const logger = pino({
  level: config.logLevel,
  base: { service: "flickfindr-backend" },
});