import { Router, Request, Response } from "express";
import { identify } from "../services/contact.service";
import { IdentifyRequest } from "../types/contact";
import { config } from "../config";

const router = Router();

router.post("/identify", async (req: Request, res: Response) => {
  if (config.chaosErrorRate > 0 && Math.random() < config.chaosErrorRate) {
    req.log.error("chaos: injected failure");
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  try {
    const { email, phoneNumber } = (req.body ?? {}) as IdentifyRequest;

    if (!email && !phoneNumber) {
      res.status(400).json({
        error: "At least one of email or phoneNumber must be provided",
      });
      return;
    }

    const result = await identify({ email, phoneNumber });
    res.status(200).json(result);
  } catch (error) {
    req.log.error({ err: error }, "identify failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
