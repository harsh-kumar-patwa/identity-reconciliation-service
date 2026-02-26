import { Router, Request, Response } from "express";
import { identify } from "../services/contact.service";
import { IdentifyRequest } from "../types/contact";

const router = Router();

router.post("/identify", async (req: Request, res: Response) => {
  try {
    const { email, phoneNumber } = req.body as IdentifyRequest;

    if (!email && !phoneNumber) {
      res.status(400).json({
        error: "At least one of email or phoneNumber must be provided",
      });
      return;
    }

    const result = await identify({ email, phoneNumber });
    res.status(200).json(result);
  } catch (error) {
    console.error("Error in /identify:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
