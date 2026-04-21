import { Router } from "express";
import { listStyleProfiles } from "../../lib/styleProfiles";

export const stylesRouter = Router();

stylesRouter.get("/", (_req, res) => {
  res.json(listStyleProfiles());
});
